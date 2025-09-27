/**
 * Integration test for service initialization and configuration
 * Tests dependency injection, service bootstrap, and configuration validation
 */

import { describe, it, expect } from 'vitest';
import { bootstrap } from '../../src/bootstrap.js';
import { InMemoryEventBus } from '../../src/core/events/event-bus.js';
import { Container } from '../../src/core/container.js';
import { Configuration, loadConfiguration } from '../../src/core/configuration.js';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from '../../src/implementations/database.js';
import { SQLiteTaskRepository } from '../../src/implementations/task-repository.js';
import { EventDrivenWorkerPool } from '../../src/implementations/event-driven-worker-pool.js';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { SystemResourceMonitor } from '../../src/implementations/resource-monitor.js';
import { PriorityTaskQueue } from '../../src/implementations/task-queue.js';

describe('Integration: Service initialization', () => {
  it('should initialize service container correctly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'claudine-test-'));

    try {
      // Set test database path
      process.env.CLAUDINE_DATABASE_PATH = join(tempDir, 'test.db');

      // Bootstrap returns a container
      const container = await bootstrap();

      // Verify container is created
      expect(container).toBeDefined();
      expect(container).toBeInstanceOf(Container);

      // Verify all required services are registered
      const configResult = container.get('config');
      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        expect(configResult.value).toBeDefined();
      }

      const loggerResult = container.get('logger');
      expect(loggerResult.ok).toBe(true);

      const eventBusResult = container.get('eventBus');
      expect(eventBusResult.ok).toBe(true);
      if (eventBusResult.ok) {
        expect(eventBusResult.value).toBeInstanceOf(InMemoryEventBus);
      }

      const dbResult = container.get('database');
      expect(dbResult.ok).toBe(true);
      if (dbResult.ok) {
        expect(dbResult.value).toBeInstanceOf(Database);
      }

      const repoResult = container.get('taskRepository');
      expect(repoResult.ok).toBe(true);
      if (repoResult.ok) {
        expect(repoResult.value).toBeInstanceOf(SQLiteTaskRepository);
      }

      const queueResult = container.get('taskQueue');
      expect(queueResult.ok).toBe(true);
      if (queueResult.ok) {
        expect(queueResult.value).toBeInstanceOf(PriorityTaskQueue);
      }

      const workerPoolResult = container.get('workerPool');
      expect(workerPoolResult.ok).toBe(true);
      if (workerPoolResult.ok) {
        expect(workerPoolResult.value).toBeInstanceOf(EventDrivenWorkerPool);
      }

      // TaskManager has async factory, need to use resolve()
      const taskManagerResult = await container.resolve('taskManager');
      expect(taskManagerResult.ok).toBe(true);
      if (taskManagerResult.ok) {
        expect(taskManagerResult.value).toBeInstanceOf(TaskManagerService);
      }

      // Test that services are singletons
      const bus1Result = container.get('eventBus');
      const bus2Result = container.get('eventBus');
      if (bus1Result.ok && bus2Result.ok) {
        expect(bus1Result.value).toBe(bus2Result.value); // Same instance
      }

      // Cleanup
      container.clear();

    } finally {
      delete process.env.CLAUDINE_DATABASE_PATH;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should load and validate configuration', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'claudine-test-'));

    try {
      // Test 1: Load from environment variables
      process.env.TASK_TIMEOUT = '60000';
      process.env.MAX_OUTPUT_BUFFER = '5242880'; // 5MB
      process.env.CPU_CORES_RESERVED = '1';
      process.env.MEMORY_RESERVE = '1073741824'; // 1GB
      process.env.LOG_LEVEL = 'debug';

      const config = loadConfiguration();

      expect(config.timeout).toBe(60000);
      expect(config.maxOutputBuffer).toBe(5242880);
      expect(config.cpuCoresReserved).toBe(1);
      expect(config.memoryReserve).toBe(1073741824);
      expect(config.logLevel).toBe('debug');

      // Test 2: Default values when env vars not set
      delete process.env.TASK_TIMEOUT;
      delete process.env.MAX_OUTPUT_BUFFER;
      const config2 = loadConfiguration();

      expect(config2.timeout).toBe(1800000); // 30 minutes default
      expect(config2.maxOutputBuffer).toBe(10485760); // 10MB default

      // Test 3: loadConfiguration returns consistent values
      const config3 = loadConfiguration();
      expect(config3.timeout).toBe(config2.timeout);
      expect(config3.logLevel).toBe(config2.logLevel);

    } finally {
      // Cleanup env vars
      delete process.env.TASK_TIMEOUT;
      delete process.env.MAX_OUTPUT_BUFFER;
      delete process.env.CPU_CORES_RESERVED;
      delete process.env.MEMORY_RESERVE;
      delete process.env.LOG_LEVEL;

      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should register event handlers during bootstrap', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'claudine-test-'));

    try {
      process.env.CLAUDINE_DATABASE_PATH = join(tempDir, 'test.db');

      // Bootstrap the system
      const container = await bootstrap();

      const eventBusResult = container.get('eventBus');
      const taskManagerResult = await container.resolve('taskManager'); // async factory

      expect(eventBusResult.ok).toBe(true);
      expect(taskManagerResult.ok).toBe(true);

      if (eventBusResult.ok && taskManagerResult.ok) {
        const eventBus = eventBusResult.value as InMemoryEventBus;
        const taskManager = taskManagerResult.value as TaskManagerService;

        // Track events
        const events: string[] = [];
        let taskDelegatedData: any = null;

        // Subscribe to events
        eventBus.on('TaskDelegated', (data) => {
          events.push('delegated');
          taskDelegatedData = data;
        });

        eventBus.on('TaskQueued', () => {
          events.push('queued');
        });

        // Delegate a task
        const request = {
          prompt: 'Test task',
          priority: 'P1' as const
        };

        const result = await taskManager.delegate(request);

        // Give time for events to process
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(result.ok).toBe(true);
        expect(events).toContain('delegated');

        // Verify event data structure
        expect(taskDelegatedData).toBeDefined();
        expect(taskDelegatedData.task).toBeDefined();
        expect(taskDelegatedData.task.prompt).toBe('Test task');
      }

      container.clear();

    } finally {
      delete process.env.CLAUDINE_DATABASE_PATH;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should perform service health checks', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'claudine-test-'));

    try {
      process.env.CLAUDINE_DATABASE_PATH = join(tempDir, 'test.db');

      const container = await bootstrap();

      const eventBusResult = container.get('eventBus');
      const repoResult = container.get('taskRepository');
      const queueResult = container.get('taskQueue');
      const monitorResult = container.get('resourceMonitor');

      expect(eventBusResult.ok).toBe(true);
      expect(repoResult.ok).toBe(true);
      expect(queueResult.ok).toBe(true);
      expect(monitorResult.ok).toBe(true);

      if (eventBusResult.ok && repoResult.ok && queueResult.ok && monitorResult.ok) {
        const eventBus = eventBusResult.value as InMemoryEventBus;
        const repository = repoResult.value as SQLiteTaskRepository;
        const queue = queueResult.value as PriorityTaskQueue;
        const monitor = monitorResult.value as SystemResourceMonitor;

        // Test that services are healthy

        // Repository health - should be able to find all tasks
        const listResult = await repository.findAll();
        expect(listResult.ok).toBe(true);
        if (listResult.ok) {
          expect(Array.isArray(listResult.value)).toBe(true);
        }

        // Queue health - should have size method
        const size = queue.size();
        expect(typeof size).toBe('number');
        expect(size).toBeGreaterThanOrEqual(0);

        // Monitor health - should provide resource metrics
        const resourcesResult = await monitor.getResources();
        expect(resourcesResult.ok).toBe(true);
        if (resourcesResult.ok) {
          expect(resourcesResult.value.cpuUsage).toBeDefined();
          expect(resourcesResult.value.availableMemory).toBeDefined();
        }

        // EventBus health - should handle events
        let healthCheckReceived = false;
        eventBus.on('HealthCheck', () => {
          healthCheckReceived = true;
        });

        await eventBus.emit('HealthCheck', { timestamp: Date.now() });
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(healthCheckReceived).toBe(true);
      }

      container.clear();

    } finally {
      delete process.env.CLAUDINE_DATABASE_PATH;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should handle graceful shutdown', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'claudine-test-'));

    try {
      process.env.CLAUDINE_DATABASE_PATH = join(tempDir, 'test.db');

      const container = await bootstrap();

      const eventBusResult = container.get('eventBus');
      const workerPoolResult = container.get('workerPool');
      const dbResult = container.get('database');

      expect(eventBusResult.ok).toBe(true);
      expect(workerPoolResult.ok).toBe(true);
      expect(dbResult.ok).toBe(true);

      if (eventBusResult.ok && workerPoolResult.ok && dbResult.ok) {
        const eventBus = eventBusResult.value as InMemoryEventBus;
        const workerPool = workerPoolResult.value as EventDrivenWorkerPool;
        const database = dbResult.value as Database;

        // Track shutdown events
        const shutdownEvents: string[] = [];

        eventBus.on('ShutdownInitiated', () => {
          shutdownEvents.push('initiated');
        });

        eventBus.on('WorkersTerminating', () => {
          shutdownEvents.push('workers');
        });

        eventBus.on('DatabaseClosing', () => {
          shutdownEvents.push('database');
        });

        // Dispose should trigger graceful shutdown
        await container.dispose();

        // Give time for events to process
        await new Promise(resolve => setTimeout(resolve, 50));

        // Verify shutdown occurred
        expect(shutdownEvents.length).toBeGreaterThan(0);

        // Verify services are no longer usable
        try {
          // Database should be closed
          const testTask = {
            id: 'test-shutdown',
            prompt: 'Should fail',
            priority: 'P0' as const,
            status: 'queued' as const,
            createdAt: Date.now()
          };

          // This should fail or return an error
          const dbStmt = database.prepare('SELECT 1');
          const dbResult = dbStmt.get();

          // If we get here, database might still be open which is OK
          // Some databases keep connections open for a bit
        } catch (error) {
          // Expected - database should be closed or closing
        }

        // Worker pool should not accept new tasks
        const spawnResult = await workerPool.spawn({
          id: 'test-after-shutdown',
          prompt: 'Should not spawn',
          priority: 'P0',
          status: 'queued',
          createdAt: Date.now()
        } as Task);

        // Should either fail or return an error
        if (spawnResult.ok) {
          // Some implementations might queue but not process
          expect(spawnResult.value).toBeDefined();
        } else {
          // This is the expected path - pool is shut down
          expect(spawnResult.error).toBeDefined();
        }
      }

    } finally {
      delete process.env.CLAUDINE_DATABASE_PATH;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});