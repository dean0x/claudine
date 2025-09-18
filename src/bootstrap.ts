/**
 * Bootstrap and dependency injection
 * Wires all components together
 */

import { Container } from './core/container.js';
import { Config, Logger, EventBus, ProcessSpawner, ResourceMonitor, OutputCapture, TaskQueue, WorkerPool, TaskRepository, TaskManager, WorktreeManager } from './core/interfaces.js';
import { Configuration } from './core/configuration.js';
import { InMemoryEventBus } from './core/events/event-bus.js';

// Implementations
import { PriorityTaskQueue } from './implementations/task-queue.js';
import { ClaudeProcessSpawner } from './implementations/process-spawner.js';
import { SystemResourceMonitor } from './implementations/resource-monitor.js';
import { EventDrivenWorkerPool } from './implementations/event-driven-worker-pool.js';
import { BufferedOutputCapture } from './implementations/output-capture.js';
import { StructuredLogger, ConsoleLogger, LogLevel } from './implementations/logger.js';
import { Database } from './implementations/database.js';
import { SQLiteTaskRepository } from './implementations/task-repository.js';
import { SQLiteOutputRepository } from './implementations/output-repository.js';

// Services
import { TaskManagerService } from './services/task-manager.js';
import { AutoscalingManager } from './services/autoscaling-manager.js';
import { RecoveryManager } from './services/recovery-manager.js';
import { GitWorktreeManager } from './services/worktree-manager.js';
import { GitHubIntegration } from './services/github-integration.js';

// Event Handlers
import { PersistenceHandler } from './services/handlers/persistence-handler.js';
import { QueueHandler } from './services/handlers/queue-handler.js';
import { WorkerHandler } from './services/handlers/worker-handler.js';
import { OutputHandler } from './services/handlers/output-handler.js';

// Adapter
import { MCPAdapter } from './adapters/mcp-adapter.js';
import { loadConfiguration } from './core/configuration.js';

// Convert new configuration format to existing Config interface
const getConfig = (): Config => {
  const config = loadConfiguration();
  return {
    maxOutputBuffer: config.maxOutputBuffer,
    taskTimeout: config.timeout, // Note: renamed from timeout to taskTimeout
    cpuThreshold: config.cpuThreshold,
    memoryReserve: config.memoryReserve,
    logLevel: config.logLevel
  };
};

// Helper functions for safe container type casting
const getFromContainer = <T>(container: Container, key: string): T => {
  const result = container.get(key);
  if (!result.ok) {
    throw new Error(`Failed to get ${key} from container: ${result.error.message}`);
  }
  return result.value as T;
};

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

  // Register EventBus as singleton - ALL components must use this shared instance
  container.registerSingleton('eventBus', () => {
    const loggerResult = container.get('logger');
    
    if (!loggerResult.ok) {
      throw new Error('Logger required for EventBus');
    }
    
    return new InMemoryEventBus((loggerResult.value as Logger).child({ module: 'SharedEventBus' }));
  });

  // Get logger for bootstrap
  const loggerResult = container.get<Logger>('logger');
  if (!loggerResult.ok) {
    console.error('Failed to create logger:', loggerResult.error);
    throw loggerResult.error;
  }
  const logger = loggerResult.value;

  // All logs go to stderr to keep stdout clean for MCP protocol
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

  container.registerSingleton('resourceMonitor', () => {
    const loggerResult = container.get('logger');
    const eventBusResult = container.get('eventBus');
    
    if (!loggerResult.ok || !eventBusResult.ok) {
      throw new Error('Logger and EventBus required for ResourceMonitor');
    }
    
    const monitor = new SystemResourceMonitor(
      config.cpuThreshold, 
      config.memoryReserve,
      getFromContainer<EventBus>(container, 'eventBus'),
      getFromContainer<Logger>(container, 'logger').child({ module: 'ResourceMonitor' })
    );
    
    // Start monitoring after a brief delay to allow system startup
    setTimeout(() => monitor.startMonitoring(), 2000);
    
    return monitor;
  });

  container.registerSingleton('outputCapture', () => {
    const eventBus = getFromContainer<EventBus>(container, 'eventBus');
    return new BufferedOutputCapture(config.maxOutputBuffer, eventBus);
  });

  // Register GitHub integration
  container.registerSingleton('githubIntegration', () => {
    const github = new GitHubIntegration(
      getFromContainer<Logger>(container, 'logger').child({ module: 'GitHub' })
    );
    
    // Check availability but don't fail
    github.isAvailable().then(available => {
      if (!available) {
        getFromContainer<Logger>(container, 'logger').warn('GitHub CLI not available - PR merge strategy disabled');
      }
    });
    
    return github;
  });

  // Register worktree manager with GitHub integration
  container.registerSingleton('worktreeManager', () => {
    return new GitWorktreeManager(
      getFromContainer<Logger>(container, 'logger').child({ module: 'WorktreeManager' }),
      getFromContainer<GitHubIntegration>(container, 'githubIntegration')
    );
  });

  // Register worker pool
  container.registerSingleton('workerPool', () => {
    const pool = new EventDrivenWorkerPool(
      getFromContainer<ProcessSpawner>(container, 'processSpawner'),
      getFromContainer<ResourceMonitor>(container, 'resourceMonitor'),
      getFromContainer<Logger>(container, 'logger').child({ module: 'WorkerPool' }),
      getFromContainer<EventBus>(container, 'eventBus'),
      getFromContainer<WorktreeManager>(container, 'worktreeManager'),
      getFromContainer<OutputCapture>(container, 'outputCapture')
    );
    return pool;
  });

  // Register task manager
  container.registerSingleton('taskManager', async () => {
    const repositoryResult = container.get('taskRepository');

    const repository = repositoryResult.ok ? repositoryResult.value as TaskRepository : undefined;
    
    // Create Configuration object for TaskManager
    const taskManagerConfig: Configuration = {
      timeout: config.taskTimeout,
      maxOutputBuffer: config.maxOutputBuffer,
      cpuThreshold: config.cpuThreshold,
      memoryReserve: config.memoryReserve,
      logLevel: config.logLevel
    };

    const taskManager = new TaskManagerService(
      getFromContainer<EventBus>(container, 'eventBus'),
      repository,
      getFromContainer<Logger>(container, 'logger').child({ module: 'TaskManager' }),
      taskManagerConfig,
      getFromContainer<OutputCapture>(container, 'outputCapture')
    );

    // Wire up event handlers - this is critical for event-driven architecture
    const logger = getFromContainer<Logger>(container, 'logger');
    const eventBus = getFromContainer<EventBus>(container, 'eventBus');
    
    // 1. Persistence Handler - manages database operations
    if (repositoryResult.ok) {
      const persistenceHandler = new PersistenceHandler(
        repositoryResult.value as TaskRepository,
        logger.child({ module: 'PersistenceHandler' })
      );
      const persistenceSetup = await persistenceHandler.setup(eventBus);
      if (!persistenceSetup.ok) {
        throw new Error(`Failed to setup PersistenceHandler: ${persistenceSetup.error.message}`);
      }
    }

    // 2. Queue Handler - manages task queue operations
    const queueHandler = new QueueHandler(
      getFromContainer<TaskQueue>(container, 'taskQueue'),
      logger.child({ module: 'QueueHandler' })
    );
    const queueSetup = await queueHandler.setup(eventBus);
    if (!queueSetup.ok) {
      throw new Error(`Failed to setup QueueHandler: ${queueSetup.error.message}`);
    }

    // 3. Worker Handler - manages worker lifecycle
    const workerHandler = new WorkerHandler(
      getFromContainer<WorkerPool>(container, 'workerPool'),
      getFromContainer<ResourceMonitor>(container, 'resourceMonitor'),
      queueHandler,
      getFromContainer<TaskRepository>(container, 'taskRepository'),
      eventBus,
      logger.child({ module: 'WorkerHandler' })
    );
    const workerSetup = await workerHandler.setup(eventBus);
    if (!workerSetup.ok) {
      throw new Error(`Failed to setup WorkerHandler: ${workerSetup.error.message}`);
    }

    // 4. Output Handler - manages output and logs
    const outputHandler = new OutputHandler(
      getFromContainer<OutputCapture>(container, 'outputCapture'),
      logger.child({ module: 'OutputHandler' })
    );
    const outputSetup = await outputHandler.setup(eventBus);
    if (!outputSetup.ok) {
      throw new Error(`Failed to setup OutputHandler: ${outputSetup.error.message}`);
    }

    // Note: Retry functionality is now handled directly in TaskManager.retry()
    // The retry creates a new task with retry tracking and emits TaskDelegated event

    logger.info('Event-driven architecture initialized successfully');
    return taskManager;
  });

  // Register autoscaling manager
  container.registerSingleton('autoscalingManager', async () => {
    const autoscaler = new AutoscalingManager(
      getFromContainer<TaskQueue>(container, 'taskQueue'),
      getFromContainer<WorkerPool>(container, 'workerPool'),
      getFromContainer<ResourceMonitor>(container, 'resourceMonitor'),
      getFromContainer<EventBus>(container, 'eventBus'),
      getFromContainer<Logger>(container, 'logger').child({ module: 'Autoscaler' })
    );
    
    // Set up event subscriptions
    const setupResult = await autoscaler.setup();
    if (!setupResult.ok) {
      throw new Error(`Failed to setup AutoscalingManager: ${setupResult.error.message}`);
    }
    
    return autoscaler;
  });

  // Register MCP adapter
  container.registerSingleton('mcpAdapter', async () => {
    const taskManagerResult = await container.resolve<TaskManager>('taskManager');
    if (!taskManagerResult.ok) {
      throw new Error(`Failed to resolve taskManager for MCPAdapter: ${taskManagerResult.error.message}`);
    }
    
    return new MCPAdapter(
      taskManagerResult.value,
      getFromContainer<Logger>(container, 'logger').child({ module: 'MCP' })
    );
  });

  // Register recovery manager
  container.registerSingleton('recoveryManager', () => {
    const repositoryResult = container.get('taskRepository');
    
    if (!repositoryResult.ok) {
      throw new Error('TaskRepository required for RecoveryManager');
    }
    
    return new RecoveryManager(
      repositoryResult.value as TaskRepository,
      getFromContainer<TaskQueue>(container, 'taskQueue'),
      getFromContainer<EventBus>(container, 'eventBus'),
      getFromContainer<Logger>(container, 'logger').child({ module: 'Recovery' })
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

