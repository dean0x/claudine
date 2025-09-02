import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { TaskStatus } from '../../src/core/domain.js';
import { taskTimeout } from '../../src/core/errors.js';
import type { TaskQueue, WorkerPool, OutputCapture, ResourceMonitor, Logger, TaskRepository } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, TEST_CONSTANTS, AssertionHelpers, MockVerification } from '../helpers/test-factories.js';

describe('TaskManagerService Timeout Handling', () => {
  let taskManager: TaskManagerService;
  let mockQueue: TaskQueue;
  let mockWorkers: WorkerPool;
  let mockOutput: OutputCapture;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockRepository: TaskRepository;

  beforeEach(() => {
    mockQueue = MockFactory.taskQueue();
    mockWorkers = MockFactory.workerPool();
    mockOutput = MockFactory.outputCapture();
    mockMonitor = MockFactory.resourceMonitor(true);
    mockLogger = MockFactory.logger();
    mockRepository = MockFactory.taskRepository();

    taskManager = new TaskManagerService(
      mockQueue,
      mockWorkers,
      mockOutput,
      mockMonitor,
      mockLogger,
      mockRepository
    );
  });

  describe('timeout handling', () => {
    it('should have onTaskTimeout method', () => {
      expect(typeof taskManager.onTaskTimeout).toBe('function');
    });

    it('should mark task as failed when timeout occurs', async () => {
      // Delegate task first
      const delegateResult = await taskManager.delegate({
        prompt: 'test task',
        timeout: TEST_CONSTANTS.FIVE_SECONDS_MS
      });
      
      const task = AssertionHelpers.expectSuccessResult(delegateResult);

      // Simulate timeout
      const timeoutError = taskTimeout(task.id, TEST_CONSTANTS.FIVE_SECONDS_MS);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Check task status
      const statusResult = await taskManager.getStatus(task.id);
      const updatedTask = AssertionHelpers.expectSuccessResult(statusResult);
      
      AssertionHelpers.expectTaskWithStatus(updatedTask, TaskStatus.FAILED);
      expect(updatedTask.completedAt).toBeGreaterThanOrEqual(task.createdAt);
    });

    it('should persist timeout task updates to repository', async () => {
      // Delegate task first  
      const delegateResult = await taskManager.delegate({
        prompt: 'test task',
        timeout: TEST_CONSTANTS.FIVE_SECONDS_MS
      });
      
      const task = AssertionHelpers.expectSuccessResult(delegateResult);

      // Simulate timeout
      const timeoutError = taskTimeout(task.id, TEST_CONSTANTS.FIVE_SECONDS_MS);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Verify repository save was called with correct data
      expect(mockRepository.save).toHaveBeenCalledTimes(2); // Initial save + timeout update
      
      MockVerification.expectRepositorySave(mockRepository, {
        id: task.id,
        status: TaskStatus.FAILED,
        completedAt: expect.any(Number)
      });
    });

    it('should log timeout events', async () => {
      // Delegate task first
      const delegateResult = await taskManager.delegate({
        prompt: 'test task',
        timeout: TEST_CONSTANTS.FIVE_SECONDS_MS
      });
      
      const task = AssertionHelpers.expectSuccessResult(delegateResult);

      // Simulate timeout
      const timeoutError = taskTimeout(task.id, TEST_CONSTANTS.FIVE_SECONDS_MS);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Verify error logging with exact message format
      MockVerification.expectCalledOnceWith(
        mockLogger.error,
        `Task ${task.id} timed out after ${TEST_CONSTANTS.FIVE_SECONDS_MS}ms`
      );
    });
  });
});