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
    eventBus = new InMemoryEventBus(logger);
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
      const result = await eventBus.request<{ taskId: string }, { task: Task | null }>(
        'TaskStatusQuery',
        { taskId: task.id }
      );

      // Assert - Verify behavior, not mocks
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.task).toBeDefined();
        expect(result.value.task?.id).toBe(task.id);
        expect(result.value.task?.prompt).toBe('test task');
        expect(result.value.task?.status).toBe('pending');
      }
    });

    it('should return null for non-existent task', async () => {
      // Act - Query for non-existent task
      const result = await eventBus.request<{ taskId: string }, { task: Task | null }>(
        'TaskStatusQuery',
        { taskId: 'non-existent-id' }
      );

      // Assert - Should handle gracefully
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.task).toBeNull();
      }
    });

    it('should handle database errors gracefully', async () => {
      // Arrange - Close database to force error
      database.close();

      // Act - Try to query
      const result = await eventBus.request<{ taskId: string }, { task: Task | null }>(
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
      // Arrange - Create tasks with different statuses
      const tasks = [
        createTask({ prompt: 'task1', status: 'pending' }),
        createTask({ prompt: 'task2', status: 'running' }),
        createTask({ prompt: 'task3', status: 'completed' }),
        createTask({ prompt: 'task4', status: 'failed' }),
        createTask({ prompt: 'task5', status: 'pending' })
      ];

      for (const task of tasks) {
        await repository.save(task);
      }

      // Act - Query all tasks
      const result = await eventBus.request<{}, { tasks: Task[] }>(
        'TaskListQuery',
        {}
      );

      // Assert - Verify we get all tasks
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tasks).toHaveLength(5);

        // Verify status distribution
        const statuses = result.value.tasks.map(t => t.status);
        expect(statuses.filter(s => s === 'pending')).toHaveLength(2);
        expect(statuses.filter(s => s === 'running')).toHaveLength(1);
        expect(statuses.filter(s => s === 'completed')).toHaveLength(1);
        expect(statuses.filter(s => s === 'failed')).toHaveLength(1);
      }
    });

    it('should return empty array when no tasks exist', async () => {
      // Act - Query empty database
      const result = await eventBus.request<{}, { tasks: Task[] }>(
        'TaskListQuery',
        {}
      );

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tasks).toEqual([]);
        expect(Array.isArray(result.value.tasks)).toBe(true);
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
      const result = await eventBus.request<{}, { tasks: Task[] }>(
        'TaskListQuery',
        {}
      );
      const queryTime = Date.now() - startTime;

      // Assert - Should be fast and complete
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.tasks).toHaveLength(taskCount);
        expect(queryTime).toBeLessThan(1000); // Should complete in < 1 second
      }
    });
  });

  describe('Task output queries', () => {
    it('should return captured output for task', async () => {
      // Arrange - Create task and capture output
      const task = createTask({ prompt: 'echo test', status: 'running' });
      await repository.save(task);

      // Start capture and add output
      outputCapture.startCapture(task.id, 12345);
      outputCapture.handleStdout(task.id, Buffer.from('Hello World\n'));
      outputCapture.handleStderr(task.id, Buffer.from('Error occurred\n'));

      // Act - Query output
      const result = await eventBus.request<{ taskId: string }, any>(
        'TaskOutputQuery',
        { taskId: task.id }
      );

      // Assert - Verify real output
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stdout).toEqual(['Hello World\n']);
        expect(result.value.stderr).toEqual(['Error occurred\n']);
        expect(result.value.pid).toBe(12345);
      }
    });

    it('should return empty output for task with no capture', async () => {
      // Arrange - Task without output
      const task = createTask({ prompt: 'test' });
      await repository.save(task);

      // Act
      const result = await eventBus.request<{ taskId: string }, any>(
        'TaskOutputQuery',
        { taskId: task.id }
      );

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stdout).toEqual([]);
        expect(result.value.stderr).toEqual([]);
        expect(result.value.exitCode).toBeUndefined();
      }
    });

    it('should handle large output efficiently', async () => {
      // Arrange - Task with large output
      const task = createTask({ prompt: 'generate output', status: 'running' });
      await repository.save(task);

      outputCapture.startCapture(task.id, 12345);

      // Generate 1MB of output
      const largeData = 'x'.repeat(1024);
      for (let i = 0; i < 1024; i++) {
        outputCapture.handleStdout(task.id, Buffer.from(largeData));
      }

      // Act
      const result = await eventBus.request<{ taskId: string }, any>(
        'TaskOutputQuery',
        { taskId: task.id }
      );

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        const totalOutput = result.value.stdout.join('').length;
        expect(totalOutput).toBeGreaterThan(1024 * 1024);
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
        eventBus.request<{ taskId: string }, { task: Task | null }>(
          'TaskStatusQuery',
          { taskId: task.id }
        )
      );

      const results = await Promise.all(promises);

      // Assert - All should succeed
      results.forEach((result, index) => {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.task?.id).toBe(tasks[index].id);
          expect(result.value.task?.prompt).toContain(`concurrent task ${index}`);
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
      const [result1, result2, listResult] = await Promise.all([
        eventBus.request<{ taskId: string }, any>('TaskStatusQuery', { taskId: task1.id }),
        eventBus.request<{ taskId: string }, any>('TaskStatusQuery', { taskId: task2.id }),
        eventBus.request<{}, any>('TaskListQuery', {})
      ]);

      // Assert - Each query gets correct results
      expect(result1.ok && result1.value.task?.id).toBe(task1.id);
      expect(result2.ok && result2.value.task?.id).toBe(task2.id);
      expect(listResult.ok && listResult.value.tasks).toHaveLength(2);
    });
  });

  describe('Error recovery', () => {
    it('should recover from transient database errors', async () => {
      // Arrange
      const task = createTask({ prompt: 'test recovery' });
      await repository.save(task);

      // Temporarily break then fix database
      const dbPath = database['db']['name'];
      database.close();

      // First query should fail
      const failResult = await eventBus.request<{ taskId: string }, any>(
        'TaskStatusQuery',
        { taskId: task.id }
      );
      expect(failResult.ok).toBe(false);

      // Reconnect database
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);
      handler = new QueryHandler(repository, outputCapture, logger, eventBus);

      // Second query should succeed
      const successResult = await eventBus.request<{ taskId: string }, any>(
        'TaskStatusQuery',
        { taskId: task.id }
      );

      expect(successResult.ok).toBe(true);
      if (successResult.ok) {
        expect(successResult.value.task?.id).toBe(task.id);
      }
    });
  });
});