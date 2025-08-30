/**
 * Bootstrap and dependency injection
 * Wires all components together
 */

import { Container } from './core/container.js';
import { Config, Logger } from './core/interfaces.js';

// Implementations
import { PriorityTaskQueue } from './implementations/task-queue.js';
import { ClaudeProcessSpawner } from './implementations/process-spawner.js';
import { SystemResourceMonitor } from './implementations/resource-monitor.js';
import { AutoscalingWorkerPool } from './implementations/worker-pool.js';
import { BufferedOutputCapture } from './implementations/output-capture.js';
import { StructuredLogger, ConsoleLogger, LogLevel } from './implementations/logger.js';
import { Database } from './implementations/database.js';
import { SQLiteTaskRepository } from './implementations/task-repository.js';
import { SQLiteOutputRepository } from './implementations/output-repository.js';

// Services
import { TaskManagerService } from './services/task-manager.js';
import { AutoscalingManager } from './services/autoscaling-manager.js';
import { RecoveryManager } from './services/recovery-manager.js';

// Adapter
import { MCPAdapter } from './adapters/mcp-adapter.js';

// Environment configuration
const getConfig = (): Config => ({
  maxOutputBuffer: parseInt(process.env.MAX_OUTPUT_BUFFER || '10485760'), // 10MB
  taskTimeout: parseInt(process.env.TASK_TIMEOUT || '1800000'), // 30 minutes
  cpuThreshold: parseInt(process.env.CPU_THRESHOLD || '80'), // 80%
  memoryReserve: parseInt(process.env.MEMORY_RESERVE || '1000000000'), // 1GB
  logLevel: (process.env.LOG_LEVEL as any) || 'info',
});

/**
 * Bootstrap the application with all dependencies
 */
export async function bootstrap() {
  const container = new Container();
  const config = getConfig();

  // Register configuration
  container.registerValue('config', config);

  // Register logger
  const logLevel = config.logLevel === 'debug' ? LogLevel.DEBUG :
                   config.logLevel === 'warn' ? LogLevel.WARN :
                   config.logLevel === 'error' ? LogLevel.ERROR :
                   LogLevel.INFO;

  container.registerSingleton('logger', () => {
    if (process.env.NODE_ENV === 'production') {
      return new StructuredLogger({}, logLevel);
    } else {
      return new ConsoleLogger('[Claudine]', true);
    }
  });

  // Get logger for bootstrap
  const loggerResult = container.get<Logger>('logger');
  if (!loggerResult.ok) {
    console.error('Failed to create logger:', loggerResult.error);
    throw loggerResult.error;
  }
  const logger = loggerResult.value;

  logger.info('Bootstrapping Claudine', { config });

  // Register database
  container.registerSingleton('database', () => new Database());
  
  // Register repositories
  container.registerSingleton('taskRepository', () => {
    const dbResult = container.get<Database>('database');
    if (!dbResult.ok) throw new Error('Failed to get database');
    return new SQLiteTaskRepository(dbResult.value);
  });
  
  container.registerSingleton('outputRepository', () => {
    const dbResult = container.get<Database>('database');
    if (!dbResult.ok) throw new Error('Failed to get database');
    return new SQLiteOutputRepository(dbResult.value);
  });

  // Register core services
  container.registerSingleton('taskQueue', () => new PriorityTaskQueue());
  
  container.registerSingleton('processSpawner', () => 
    new ClaudeProcessSpawner('claude')
  );

  container.registerSingleton('resourceMonitor', () => 
    new SystemResourceMonitor(config.cpuThreshold, config.memoryReserve)
  );

  container.registerSingleton('outputCapture', () => 
    new BufferedOutputCapture(config.maxOutputBuffer)
  );

  // Register worker pool
  container.registerSingleton('workerPool', () => {
    const spawnerResult = container.get('processSpawner');
    const monitorResult = container.get('resourceMonitor');
    const loggerResult = container.get('logger');
    const outputResult = container.get('outputCapture');

    if (!spawnerResult.ok || !monitorResult.ok || !loggerResult.ok || !outputResult.ok) {
      throw new Error('Failed to resolve dependencies for WorkerPool');
    }

    const pool = new AutoscalingWorkerPool(
      spawnerResult.value as any,
      monitorResult.value as any,
      (loggerResult.value as Logger).child({ module: 'WorkerPool' }),
      outputResult.value as any
    );
    return pool;
  });

  // Register task manager
  container.registerSingleton('taskManager', () => {
    const queueResult = container.get('taskQueue');
    const workersResult = container.get('workerPool');
    const outputResult = container.get('outputCapture');
    const monitorResult = container.get('resourceMonitor');
    const loggerResult = container.get('logger');
    const repositoryResult = container.get('taskRepository');

    if (!queueResult.ok || !workersResult.ok || !outputResult.ok || 
        !monitorResult.ok || !loggerResult.ok) {
      throw new Error('Failed to resolve dependencies for TaskManager');
    }

    const taskManager = new TaskManagerService(
      queueResult.value as any,
      workersResult.value as any,
      outputResult.value as any,
      monitorResult.value as any,
      (loggerResult.value as Logger).child({ module: 'TaskManager' }),
      repositoryResult.ok ? repositoryResult.value as any : undefined
    );

    // Wire up task completion handler
    const workerPool = workersResult.value as any;
    if (workerPool.setTaskCompleteHandler) {
      workerPool.setTaskCompleteHandler((taskId: string, exitCode: number) => {
        taskManager.onTaskComplete(taskId as any, exitCode);
      });
    }

    return taskManager;
  });

  // Register autoscaling manager
  container.registerSingleton('autoscalingManager', () => {
    const queueResult = container.get('taskQueue');
    const workersResult = container.get('workerPool');
    const monitorResult = container.get('resourceMonitor');
    const loggerResult = container.get('logger');
    const taskManagerResult = container.get('taskManager');

    if (!queueResult.ok || !workersResult.ok || !monitorResult.ok || !loggerResult.ok) {
      throw new Error('Failed to resolve dependencies for AutoscalingManager');
    }

    const autoscaler = new AutoscalingManager(
      queueResult.value as any,
      workersResult.value as any,
      monitorResult.value as any,
      (loggerResult.value as Logger).child({ module: 'Autoscaler' }),
      1000 // Check every second
    );
    
    // Wire up scale event to task manager
    if (taskManagerResult.ok) {
      const taskManager = taskManagerResult.value as any;
      autoscaler.setOnScaleUp(() => {
        taskManager.tryProcessNext();
      });
    }
    
    return autoscaler;
  });

  // Register MCP adapter
  container.registerSingleton('mcpAdapter', () => {
    const taskManagerResult = container.get('taskManager');
    const loggerResult = container.get('logger');

    if (!taskManagerResult.ok || !loggerResult.ok) {
      throw new Error('Failed to resolve dependencies for MCPAdapter');
    }

    return new MCPAdapter(
      taskManagerResult.value as any,
      (loggerResult.value as Logger).child({ module: 'MCP' })
    );
  });

  // Register recovery manager
  container.registerSingleton('recoveryManager', () => {
    const repositoryResult = container.get('taskRepository');
    const queueResult = container.get('taskQueue');
    const loggerResult = container.get('logger');
    
    if (!repositoryResult.ok || !queueResult.ok || !loggerResult.ok) {
      throw new Error('Failed to resolve dependencies for RecoveryManager');
    }
    
    return new RecoveryManager(
      repositoryResult.value as any,
      queueResult.value as any,
      (loggerResult.value as Logger).child({ module: 'Recovery' })
    );
  });
  
  // Run recovery on startup
  const recoveryResult = container.get('recoveryManager');
  if (recoveryResult.ok) {
    const recovery = recoveryResult.value as RecoveryManager;
    recovery.recover().then(result => {
      if (!result.ok) {
        logger.error('Recovery failed', result.error);
      }
    });
  }

  logger.info('Bootstrap complete');

  return container;
}

