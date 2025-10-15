/**
 * Bootstrap and dependency injection
 * Wires all components together
 */

import { Container } from './core/container.js';
import { Config, Logger, ProcessSpawner, ResourceMonitor, OutputCapture, TaskQueue, WorkerPool, TaskRepository, TaskManager, WorktreeManager } from './core/interfaces.js';
import { EventBus } from './core/events/event-bus.js';
import { Configuration, loadConfiguration } from './core/configuration.js';
import { InMemoryEventBus } from './core/events/event-bus.js';
import { validateConfiguration } from './core/config-validator.js';
import { Result, ok, err } from './core/result.js';
import { ClaudineError, ErrorCode } from './core/errors.js';

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
import { QueryHandler } from './services/handlers/query-handler.js';
import { WorkerHandler } from './services/handlers/worker-handler.js';
import { OutputHandler } from './services/handlers/output-handler.js';
import { WorktreeHandler } from './services/handlers/worktree-handler.js';

// Adapter
import { MCPAdapter } from './adapters/mcp-adapter.js';

// Convert new configuration format to existing Config interface
const getConfig = (): Config => {
  const config = loadConfiguration();
  return {
    maxOutputBuffer: config.maxOutputBuffer,
    taskTimeout: config.timeout, // Note: renamed from timeout to taskTimeout
    cpuCoresReserved: config.cpuCoresReserved,
    memoryReserve: config.memoryReserve,
    logLevel: config.logLevel,
    maxListenersPerEvent: config.maxListenersPerEvent,
    maxTotalSubscriptions: config.maxTotalSubscriptions
  };
};

/**
 * Helper for dependency injection in factory functions
 *
 * ARCHITECTURE NOTE: This function throws instead of returning Result
 * because it's used inside registerSingleton() factory callbacks.
 *
 * Factory functions execute LAZILY when a service is first resolved,
 * not during bootstrap. Throwing here is acceptable because:
 * 1. Errors are caught by the DI container's resolve() method
 * 2. The container.resolve() already returns Result<T>
 * 3. This keeps factory function code clean and synchronous
 *
 * For the main bootstrap flow, use getFromContainerSafe() instead.
 */
const getFromContainer = <T>(container: Container, key: string): T => {
  const result = container.get(key);
  if (!result.ok) {
    throw new Error(`Failed to get ${key} from container: ${result.error.message}`);
  }
  return result.value as T;
};

// Safe version for use in async bootstrap flow
const getFromContainerSafe = <T>(container: Container, key: string): Result<T> => {
  const result = container.get(key);
  if (!result.ok) {
    return err(new ClaudineError(
      ErrorCode.DEPENDENCY_INJECTION_FAILED,
      `Failed to get ${key} from container`,
      { key, error: result.error.message }
    ));
  }
  return ok(result.value as T);
};

/**
 * Bootstrap the application with all dependencies
 * ARCHITECTURE: Returns Result instead of throwing - follows Result pattern
 */
export async function bootstrap(): Promise<Result<Container>> {
  const container = new Container();
  const config = loadConfiguration();

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

  // Validate configuration against system (component-level validation)
  const bootstrapLoggerResult = getFromContainerSafe<Logger>(container, 'logger');
  if (!bootstrapLoggerResult.ok) {
    return bootstrapLoggerResult;
  }
  const bootstrapLogger = bootstrapLoggerResult.value;

  const validationWarnings = validateConfiguration(config, bootstrapLogger);

  // Log summary if warnings exist
  if (validationWarnings.length > 0) {
    const warningCount = validationWarnings.filter(w => w.severity === 'warning').length;
    const infoCount = validationWarnings.filter(w => w.severity === 'info').length;
    bootstrapLogger.warn('Configuration validation complete', {
      warnings: warningCount,
      info: infoCount,
      total: validationWarnings.length,
    });
  } else {
    bootstrapLogger.debug('Configuration validation passed - no warnings');
  }

  // Register EventBus as singleton - ALL components must use this shared instance
  container.registerSingleton('eventBus', () => {
    const loggerResult = container.get('logger');
    const configResult = container.get('config');

    // These should always succeed since we registered them above
    if (!loggerResult.ok || !configResult.ok) {
      throw new Error('FATAL: Logger or Config not found in container during EventBus creation');
    }

    const cfg = configResult.value as Configuration;
    return new InMemoryEventBus(
      cfg,
      (loggerResult.value as Logger).child({ module: 'SharedEventBus' })
    );
  });

  // Get logger for bootstrap
  const loggerResult = container.get<Logger>('logger');
  if (!loggerResult.ok) {
    return err(new ClaudineError(
      ErrorCode.DEPENDENCY_INJECTION_FAILED,
      'Failed to create logger',
      { error: loggerResult.error.message }
    ));
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
    const configResult = container.get<Configuration>('config');
    const dbResult = container.get<Database>('database');
    if (!configResult.ok) throw new Error('Config required for OutputRepository');
    if (!dbResult.ok) throw new Error('Failed to get database');
    return new SQLiteOutputRepository(configResult.value, dbResult.value);
  });

  // Register core services
  container.registerSingleton('taskQueue', () => new PriorityTaskQueue());
  
  container.registerSingleton('processSpawner', () => {
    const configResult = container.get<Configuration>('config');
    if (!configResult.ok) throw new Error('Config required for ProcessSpawner');
    return new ClaudeProcessSpawner(configResult.value, 'claude');
  });

  container.registerSingleton('resourceMonitor', () => {
    const configResult = container.get<Configuration>('config');
    const loggerResult = container.get('logger');
    const eventBusResult = container.get('eventBus');

    if (!configResult.ok || !loggerResult.ok || !eventBusResult.ok) {
      throw new Error('Config, Logger and EventBus required for ResourceMonitor');
    }

    const monitor = new SystemResourceMonitor(
      configResult.value,
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
    // ARCHITECTURE: Pure event-driven TaskManager - no direct repository or outputCapture access
    const taskManager = new TaskManagerService(
      getFromContainer<EventBus>(container, 'eventBus'),
      getFromContainer<Logger>(container, 'logger').child({ module: 'TaskManager' }),
      config // Pass complete config - no partial objects needed
    );

    // Wire up event handlers - this is critical for event-driven architecture
    const loggerResult2 = getFromContainerSafe<Logger>(container, 'logger');
    if (!loggerResult2.ok) return loggerResult2;
    const logger = loggerResult2.value;

    const eventBusResult = getFromContainerSafe<EventBus>(container, 'eventBus');
    if (!eventBusResult.ok) return eventBusResult;
    const eventBus = eventBusResult.value;

    // Get repository for handlers
    const repositoryResult = getFromContainerSafe<TaskRepository>(container, 'taskRepository');
    if (!repositoryResult.ok) return repositoryResult;
    const repository = repositoryResult.value;

    // 1. Persistence Handler - manages database operations
    const persistenceHandler = new PersistenceHandler(
      repository,
      logger.child({ module: 'PersistenceHandler' })
    );
    const persistenceSetup = await persistenceHandler.setup(eventBus);
    if (!persistenceSetup.ok) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to setup PersistenceHandler: ${persistenceSetup.error.message}`,
        { error: persistenceSetup.error }
      ));
    }

    // 2. Query Handler - handles read operations for pure event-driven architecture
    // ARCHITECTURE: Critical for pure event-driven pattern - processes all queries
    const outputCaptureResult = getFromContainerSafe<OutputCapture>(container, 'outputCapture');
    if (!outputCaptureResult.ok) return outputCaptureResult;

    const queryHandler = new QueryHandler(
      repository,
      outputCaptureResult.value,
      eventBus,
      logger.child({ module: 'QueryHandler' })
    );
    const querySetup = await queryHandler.setup(eventBus);
    if (!querySetup.ok) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to setup QueryHandler: ${querySetup.error.message}`,
        { error: querySetup.error }
      ));
    }

    // 3. Queue Handler - manages task queue operations
    const taskQueueResult = getFromContainerSafe<TaskQueue>(container, 'taskQueue');
    if (!taskQueueResult.ok) return taskQueueResult;

    const queueHandler = new QueueHandler(
      taskQueueResult.value,
      logger.child({ module: 'QueueHandler' })
    );
    const queueSetup = await queueHandler.setup(eventBus);
    if (!queueSetup.ok) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to setup QueueHandler: ${queueSetup.error.message}`,
        { error: queueSetup.error }
      ));
    }

    // 4. Worker Handler - manages worker lifecycle
    // ARCHITECTURE: Pure event-driven - uses events for queue and repository access
    const workerPoolResult = getFromContainerSafe<WorkerPool>(container, 'workerPool');
    if (!workerPoolResult.ok) return workerPoolResult;

    const resourceMonitorResult = getFromContainerSafe<ResourceMonitor>(container, 'resourceMonitor');
    if (!resourceMonitorResult.ok) return resourceMonitorResult;

    const workerHandler = new WorkerHandler(
      config,
      workerPoolResult.value,
      resourceMonitorResult.value,
      eventBus,
      logger.child({ module: 'WorkerHandler' })
    );
    const workerSetup = await workerHandler.setup(eventBus);
    if (!workerSetup.ok) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to setup WorkerHandler: ${workerSetup.error.message}`,
        { error: workerSetup.error }
      ));
    }

    // 5. Output Handler - manages output and logs
    const outputCapture2Result = getFromContainerSafe<OutputCapture>(container, 'outputCapture');
    if (!outputCapture2Result.ok) return outputCapture2Result;

    const outputHandler = new OutputHandler(
      outputCapture2Result.value,
      logger.child({ module: 'OutputHandler' })
    );
    const outputSetup = await outputHandler.setup(eventBus);
    if (!outputSetup.ok) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to setup OutputHandler: ${outputSetup.error.message}`,
        { error: outputSetup.error }
      ));
    }

    // 6. Worktree Handler - manages git worktree operations
    // ARCHITECTURE: Completes event-driven refactor for worktree management
    const worktreeManagerResult = getFromContainerSafe<WorktreeManager>(container, 'worktreeManager');
    if (!worktreeManagerResult.ok) return worktreeManagerResult;

    const worktreeHandler = new WorktreeHandler(
      worktreeManagerResult.value,
      eventBus,
      logger.child({ module: 'WorktreeHandler' })
    );
    const worktreeSetup = await worktreeHandler.setup(eventBus);
    if (!worktreeSetup.ok) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to setup WorktreeHandler: ${worktreeSetup.error.message}`,
        { error: worktreeSetup.error }
      ));
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

  return ok(container);
}

