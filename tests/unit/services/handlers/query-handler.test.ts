import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueryHandler } from '../../../../src/services/handlers/query-handler';
import { InMemoryEventBus } from '../../../../src/core/events/event-bus';
import { SQLiteTaskRepository } from '../../../../src/implementations/task-repository';
import { Database } from '../../../../src/implementations/database';
import { TestLogger } from '../../../fixtures/test-doubles';
import { BufferedOutputCapture } from '../../../../src/implementations/output-capture';
import { createTask, type Task } from '../../../../src/core/domain';
import { ok, err } from '../../../../src/core/result';
import { taskNotFound } from '../../../../src/core/errors';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestConfiguration } from '../../../fixtures/factories';

describe('QueryHandler - Behavioral Tests', () => {
  let handler: QueryHandler;
  let eventBus: InMemoryEventBus;
  let repository: SQLiteTaskRepository;
  let outputCapture: BufferedOutputCapture;
  let database: Database;
  let tempDir: string;
  let logger: TestLogger;

  beforeEach(async () => {
    // Use real implementations instead of mocks
    logger = new TestLogger();
    const config = createTestConfiguration();
    eventBus = new InMemoryEventBus(config, logger);
    outputCapture = new BufferedOutputCapture(10 * 1024 * 1024, eventBus);

    // Use real database for testing
    tempDir = await mkdtemp(join(tmpdir(), 'query-handler-test-'));
    database = new Database(join(tempDir, 'test.db'));
    repository = new SQLiteTaskRepository(database);

    // Create handler with real dependencies
    handler = new QueryHandler(repository, outputCapture, eventBus, logger);

    // Setup the handler to register event listeners
    const setupResult = await handler.setup(eventBus);
    if (!setupResult.ok) {
      throw new Error(`Failed to setup QueryHandler: ${setupResult.error.message}`);
    }
  });

  afterEach(async () => {
    eventBus.dispose();
    outputCapture.cleanup();
    database.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Task status queries', () => {
    it('should return task when it exists', async () => {
      // Arrange - Create and save a real task
      const task = createTask({ prompt: 'test task' });
      await repository.save(task);

      // Act - Query for the task
      // FIXED: Response is Task directly, not wrapped in {task: ...}
      const result = await eventBus.request<{ taskId: string }, Task>(
        'TaskStatusQuery',
        { taskId: task.id }
      );

      // Assert - Verify behavior, not mocks
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(result.value.id).toBe(task.id);
        expect(result.value.prompt).toBe('test task');
        expect(result.value.status).toBe('queued'); // FIX: Domain defaults to QUEUED
      }
    });

    it('should return null for non-existent task', async () => {
      // Act - Query for non-existent task
      // FIXED: Response is Task | null directly, not wrapped
      const result = await eventBus.request<{ taskId: string }, Task | null>(
        'TaskStatusQuery',
        { taskId: 'non-existent-id' }
      );

      // Assert - Should handle gracefully
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should handle database errors gracefully', async () => {
      // Arrange - Close database to force error
      database.close();

      // Act - Try to query
      // FIXED: Response is Task | null directly
      const result = await eventBus.request<{ taskId: string }, Task | null>(
        'TaskStatusQuery',
        { taskId: 'any-id' }
      );

      // Assert - Should return error
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('database');
      }
    });
  });

  describe('Task list queries', () => {
    it('should return all tasks with correct status filtering', async () => {
      // Arrange - Create tasks, all start as QUEUED, then update status
      const task1 = createTask({ prompt: 'task1' });
      const task2 = createTask({ prompt: 'task2' });
      const task3 = createTask({ prompt: 'task3' });
      const task4 = createTask({ prompt: 'task4' });
      const task5 = createTask({ prompt: 'task5' });

      // Save and update statuses (domain enforces QUEUED on creation)
      await repository.save(task1);
      await repository.save(task2);
      await repository.save({ ...task2, status: 'running' as const });
      await repository.save(task3);
      await repository.save({ ...task3, status: 'completed' as const });
      await repository.save(task4);
      await repository.save({ ...task4, status: 'failed' as const });
      await repository.save(task5);

      // Act - Query all tasks
      // FIXED: Use TaskStatusQuery with no taskId (returns Task[])
      const result = await eventBus.request<{}, readonly Task[]>(
        'TaskStatusQuery',
        {}
      );

      // Assert - Verify we get all tasks
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(5);

        // Verify status distribution (2 queued, 1 running, 1 completed, 1 failed)
        const statuses = result.value.map(t => t.status);
        expect(statuses.filter(s => s === 'queued')).toHaveLength(2);
        expect(statuses.filter(s => s === 'running')).toHaveLength(1);
        expect(statuses.filter(s => s === 'completed')).toHaveLength(1);
        expect(statuses.filter(s => s === 'failed')).toHaveLength(1);
      }
    });

    it('should return empty array when no tasks exist', async () => {
      // Act - Query empty database
      // FIXED: Use TaskStatusQuery with no taskId
      const result = await eventBus.request<{}, readonly Task[]>(
        'TaskStatusQuery',
        {}
      );

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
        expect(Array.isArray(result.value)).toBe(true);
      }
    });

    it('should handle large task lists efficiently', async () => {
      // Arrange - Create many tasks
      const taskCount = 100;
      const tasks = Array.from({ length: taskCount }, (_, i) =>
        createTask({ prompt: `task ${i}` })
      );

      // Save all tasks
      for (const task of tasks) {
        await repository.save(task);
      }

      // Act - Query all tasks
      const startTime = Date.now();
      // FIXED: Use TaskStatusQuery with no taskId
      const result = await eventBus.request<{}, readonly Task[]>(
        'TaskStatusQuery',
        {}
      );
      const queryTime = Date.now() - startTime;

      // Assert - Should be fast and complete
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(taskCount);
        expect(queryTime).toBeLessThan(1000); // Should complete in < 1 second
      }
    });
  });

  describe('Task output queries', () => {
    it('should return captured output for task', async () => {
      // Arrange - Create task and capture output
      const task = createTask({ prompt: 'echo test' });
      await repository.save(task);

      // FIX: Use correct capture() API instead of old startCapture/handleStdout
      outputCapture.capture(task.id, 'stdout', 'Hello World\n');
      outputCapture.capture(task.id, 'stderr', 'Error occurred\n');

      // Act - Query output using correct event name
      const result = await eventBus.request<{ taskId: string }, any>(
        'TaskLogsQuery', // FIX: Use TaskLogsQuery not TaskOutputQuery
        { taskId: task.id }
      );

      // Assert - Verify real output
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stdout).toEqual(['Hello World\n']);
        expect(result.value.stderr).toEqual(['Error occurred\n']);
      }
    });

    it('should return empty output for task with no capture', async () => {
      // Arrange - Task without output
      const task = createTask({ prompt: 'test' });
      await repository.save(task);

      // Act - FIX: Use TaskLogsQuery not TaskOutputQuery
      const result = await eventBus.request<{ taskId: string }, any>(
        'TaskLogsQuery',
        { taskId: task.id }
      );

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stdout).toEqual([]);
        expect(result.value.stderr).toEqual([]);
      }
    });

    it('should handle large output efficiently', async () => {
      // Arrange - Task with large output
      const task = createTask({ prompt: 'generate output' });
      await repository.save(task);

      // FIX: Use correct capture() API
      // Generate 1MB of output
      const largeData = 'x'.repeat(1024);
      for (let i = 0; i < 1024; i++) {
        outputCapture.capture(task.id, 'stdout', largeData);
      }

      // Act - FIX: Use TaskLogsQuery not TaskOutputQuery
      const result = await eventBus.request<{ taskId: string }, any>(
        'TaskLogsQuery',
        { taskId: task.id }
      );

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        const totalOutput = result.value.stdout.join('').length;
        expect(totalOutput).toBeGreaterThanOrEqual(1024 * 1024); // FIX: Use >= not > (exactly 1MB)
      }
    });
  });

  describe('Request timeout handling', () => {
    it('should timeout long-running requests', async () => {
      vi.useFakeTimers();

      // Create a handler that never responds
      eventBus.onRequest('SlowQuery', async () => {
        // Never resolves
        return new Promise(() => {});
      });

      // Act - Make request with timeout
      const resultPromise = eventBus.request('SlowQuery', {}, 100);

      // Advance time past timeout
      vi.advanceTimersByTime(150);

      const result = await resultPromise;

      // Assert - Should timeout
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timeout');
      }

      vi.useRealTimers();
    });
  });

  describe('Concurrent query handling', () => {
    it('should handle multiple concurrent queries correctly', async () => {
      // Arrange - Create multiple tasks
      const tasks = Array.from({ length: 10 }, (_, i) =>
        createTask({ prompt: `concurrent task ${i}` })
      );

      // Save all tasks
      for (const task of tasks) {
        await repository.save(task);
      }

      // Act - Make concurrent queries
      const promises = tasks.map(task =>
        // FIXED: Response is Task | null directly
        eventBus.request<{ taskId: string }, Task | null>(
          'TaskStatusQuery',
          { taskId: task.id }
        )
      );

      const results = await Promise.all(promises);

      // Assert - All should succeed
      results.forEach((result, index) => {
        expect(result.ok).toBe(true);
        if (result.ok) {
          // FIXED: result.value IS the task directly
          expect(result.value?.id).toBe(tasks[index].id);
          expect(result.value?.prompt).toContain(`concurrent task ${index}`);
        }
      });
    });

    it('should maintain query isolation', async () => {
      // Arrange
      const task1 = createTask({ prompt: 'task 1' });
      const task2 = createTask({ prompt: 'task 2' });
      await repository.save(task1);
      await repository.save(task2);

      // Act - Concurrent different queries
      // FIXED: Use correct response types
      const [result1, result2, listResult] = await Promise.all([
        eventBus.request<{ taskId: string }, Task>('TaskStatusQuery', { taskId: task1.id }),
        eventBus.request<{ taskId: string }, Task>('TaskStatusQuery', { taskId: task2.id }),
        eventBus.request<{}, readonly Task[]>('TaskStatusQuery', {})
      ]);

      // Assert - Each query gets correct results
      expect(result1.ok && result1.value.id).toBe(task1.id);
      expect(result2.ok && result2.value.id).toBe(task2.id);
      expect(listResult.ok && listResult.value).toHaveLength(2);
    });
  });

  describe('Error recovery', () => {
    it('should recover from transient database errors', async () => {
      // Arrange
      const task = createTask({ prompt: 'test recovery' });
      await repository.save(task);

      // Temporarily break database
      const dbPath = database['db']['name'];
      database.close();

      // First query should fail (database closed)
      const failResult = await eventBus.request<{ taskId: string }, any>(
        'TaskStatusQuery',
        { taskId: task.id }
      );
      expect(failResult.ok).toBe(false);

      // FIX: Recovery means reopening same database and querying again
      // Must dispose old handler first to avoid duplicate listeners
      eventBus.dispose();

      // Recreate everything with same database path
      const config = createTestConfiguration();
      eventBus = new InMemoryEventBus(config, logger);
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);
      handler = new QueryHandler(repository, outputCapture, eventBus, logger);

      const setupResult = await handler.setup(eventBus);
      if (!setupResult.ok) {
        throw new Error(`Failed to setup QueryHandler: ${setupResult.error.message}`);
      }

      // Second query should succeed (database recovered)
      const successResult = await eventBus.request<{ taskId: string }, any>(
        'TaskStatusQuery',
        { taskId: task.id }
      );

      expect(successResult.ok).toBe(true);
      if (successResult.ok) {
        expect(successResult.value?.id).toBe(task.id);
      }
    });
  });
});