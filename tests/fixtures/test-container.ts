/**
 * Test container helper for dependency injection in tests
 */

import { Container } from '../../src/core/container';
import { InMemoryEventBus } from '../../src/core/events/event-bus';
import { TaskManagerService } from '../../src/services/task-manager';
import { SQLiteTaskRepository } from '../../src/implementations/task-repository';
import { EventDrivenWorkerPool } from '../../src/implementations/event-driven-worker-pool';
import { ClaudeProcessSpawner } from '../../src/implementations/process-spawner';
import { BufferedOutputCapture } from '../../src/implementations/output-capture';
import { ResourceMonitor } from '../../src/implementations/resource-monitor';
import { AutoscalingManager } from '../../src/services/autoscaling-manager';
import { RecoveryManager } from '../../src/services/recovery-manager';
import { ConsoleLogger } from '../../src/implementations/logger';
import { Configuration } from '../../src/core/configuration';
import { EventBus, Logger } from '../../src/core/interfaces';
import { Result, ok } from '../../src/core/result';
import { Database } from '../../src/implementations/database';
import { PriorityTaskQueue } from '../../src/implementations/task-queue';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestContainerOptions {
  testMode?: boolean;
  database?: string | ':memory:';
  maxWorkers?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  silent?: boolean;
}

export interface TestContainer {
  container: Container;
  eventBus: EventBus;
  taskManager: TaskManagerService;
  logger: Logger;
  cleanup: () => Promise<void>;
}

export async function createTestContainer(options: TestContainerOptions = {}): Promise<TestContainer> {
  const {
    testMode = true,
    database = ':memory:',
    maxWorkers = 2,
    logLevel = 'error',
    silent = true
  } = options;

  // Create test config
  const config: Configuration = {
    maxWorkers,
    timeout: 30000,
    maxOutputBuffer: 1024 * 1024, // 1MB for tests
    cpuThreshold: 80,
    memoryThreshold: 80,
    minWorkers: 1,
    scaleUpThreshold: 70,
    scaleDownThreshold: 30,
    scaleCheckInterval: 1000,
    recoveryCheckInterval: 5000,
    logLevel,
    logDirectory: path.join(__dirname, '..', '..', 'test-logs', randomUUID()),
    databasePath: database === ':memory:' ? ':memory:' : path.join(__dirname, '..', '..', 'test-db', `${randomUUID()}.db`),
    testMode
  };

  // Ensure directories exist for non-memory databases
  if (database !== ':memory:') {
    await fs.mkdir(path.dirname(config.databasePath), { recursive: true });
  }
  await fs.mkdir(config.logDirectory, { recursive: true });

  // Create container
  const container = new Container();

  // Register logger
  const logger = silent
    ? new SilentLogger()
    : new ConsoleLogger(logLevel);
  container.registerValue('logger', logger);

  // Register configuration
  container.registerValue('config', config);

  // Register EventBus
  const eventBus = new InMemoryEventBus(logger);
  container.registerValue('eventBus', eventBus);

  // Register database
  const db = new Database(config.databasePath);
  container.registerValue('database', db);

  // Register repositories
  container.registerSingleton('taskRepository', async () => {
    const dbResult = await container.resolve('database');
    const loggerResult = await container.resolve('logger');
    if (!dbResult.ok || !loggerResult.ok) {
      return undefined;
    }
    const repo = new SQLiteTaskRepository(
      dbResult.value as Database
    );
    return repo;
  });

  // Register task queue
  container.registerSingleton('taskQueue', () => {
    return new PriorityTaskQueue();
  });

  // Register services
  container.registerSingleton('processSpawner', async () => {
    const loggerResult = await container.resolve('logger');
    return loggerResult.ok
      ? new ClaudeProcessSpawner(loggerResult.value as Logger)
      : undefined;
  });

  container.registerSingleton('outputCapture', async () => {
    const loggerResult = await container.resolve('logger');
    const configResult = await container.resolve('config');
    if (!loggerResult.ok || !configResult.ok) {
      return undefined;
    }
    return new BufferedOutputCapture(
      loggerResult.value as Logger,
      configResult.value as Configuration
    );
  });

  container.registerSingleton('resourceMonitor', async () => {
    const loggerResult = await container.resolve('logger');
    return loggerResult.ok
      ? new ResourceMonitor(loggerResult.value as Logger)
      : undefined;
  });

  container.registerSingleton('workerPool', async () => {
    const results = await Promise.all([
      container.resolve('processSpawner'),
      container.resolve('logger'),
      container.resolve('eventBus'),
      container.resolve('outputCapture')
    ]);

    const [spawnerResult, loggerResult, eventBusResult, captureResult] = results;

    if (!spawnerResult.ok || !loggerResult.ok || !eventBusResult.ok || !captureResult.ok) {
      return undefined;
    }

    return new EventDrivenWorkerPool(
      spawnerResult.value as any,
      loggerResult.value as Logger,
      eventBusResult.value as EventBus,
      captureResult.value as any
    );
  });

  container.registerSingleton('taskManager', async () => {
    const results = await Promise.all([
      container.resolve('eventBus'),
      container.resolve('taskRepository'),
      container.resolve('logger'),
      container.resolve('config'),
      container.resolve('outputCapture')
    ]);

    const [eventBusResult, repoResult, loggerResult, configResult, captureResult] = results;

    if (!eventBusResult.ok || !loggerResult.ok || !configResult.ok) {
      return undefined;
    }

    return new TaskManagerService(
      eventBusResult.value as EventBus,
      repoResult.ok ? repoResult.value as any : undefined,
      loggerResult.value as Logger,
      configResult.value as Configuration,
      captureResult.ok ? captureResult.value as any : undefined
    );
  });

  // Don't start autoscaling in test mode unless explicitly requested
  if (!testMode) {
    container.registerSingleton('autoscalingManager', async () => {
      const results = await Promise.all([
        container.resolve('workerPool'),
        container.resolve('resourceMonitor'),
        container.resolve('logger'),
        container.resolve('config'),
        container.resolve('eventBus')
      ]);

      const [poolResult, monitorResult, loggerResult, configResult, eventBusResult] = results;

      if (!poolResult.ok || !monitorResult.ok || !loggerResult.ok || !configResult.ok || !eventBusResult.ok) {
        return undefined;
      }

      const manager = new AutoscalingManager(
        poolResult.value as any,
        monitorResult.value as any,
        loggerResult.value as Logger,
        configResult.value as Configuration,
        eventBusResult.value as EventBus
      );
      await manager.start();
      return manager;
    });
  }

  // Resolve key services
  const eventBusResult = await container.resolve('eventBus');
  const taskManagerResult = await container.resolve('taskManager');
  const loggerResult = await container.resolve('logger');

  if (!eventBusResult.ok || !taskManagerResult.ok || !loggerResult.ok) {
    throw new Error('Failed to initialize test container');
  }

  // Cleanup function
  const cleanup = async () => {
    // Stop all services
    const poolResult = await container.resolve('workerPool');
    if (poolResult.ok) {
      const pool = poolResult.value as EventDrivenWorkerPool;
      await pool.shutdown();
    }

    const autoscalingResult = await container.resolve('autoscalingManager');
    if (autoscalingResult.ok) {
      const manager = autoscalingResult.value as AutoscalingManager;
      await manager.stop();
    }

    // Close database
    const dbResult = await container.resolve('database');
    if (dbResult.ok) {
      const db = dbResult.value as Database;
      db.close();
    }

    // Clean up test directories
    try {
      await fs.rm(config.logDirectory, { recursive: true, force: true });
      if (config.databasePath !== ':memory:') {
        await fs.rm(config.databasePath, { force: true });
        await fs.rm(`${config.databasePath}-shm`, { force: true });
        await fs.rm(`${config.databasePath}-wal`, { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    container,
    eventBus: eventBusResult.value as EventBus,
    taskManager: taskManagerResult.value as TaskManagerService,
    logger: loggerResult.value as Logger,
    cleanup
  };
}

/**
 * Silent logger for tests
 */
class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}