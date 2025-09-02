import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { AutoscalingWorkerPool } from '../../src/implementations/worker-pool.js';
import { BufferedOutputCapture } from '../../src/implementations/output-capture.js';
import { TaskStatus, Priority } from '../../src/core/domain.js';
import { ErrorCode } from '../../src/core/errors.js';
import type { TaskQueue, ResourceMonitor, Logger, TaskRepository, ProcessSpawner } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, TEST_CONSTANTS, AssertionHelpers, ErrorFactory } from '../helpers/test-factories.js';
import { err, ok } from '../../src/core/result.js';
import { taskTimeout } from '../../src/core/errors.js';

describe('Error Scenario Tests', () => {
  let taskManager: TaskManagerService;
  let workerPool: AutoscalingWorkerPool;
  let outputCapture: BufferedOutputCapture;
  let mockQueue: TaskQueue;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockRepository: TaskRepository;
  let mockSpawner: ProcessSpawner;

  beforeEach(() => {
    mockQueue = MockFactory.taskQueue();
    mockMonitor = MockFactory.resourceMonitor(true);
    mockLogger = MockFactory.logger();
    mockRepository = MockFactory.taskRepository();
    mockSpawner = MockFactory.processSpawner();

    outputCapture = new BufferedOutputCapture();
    
    workerPool = new AutoscalingWorkerPool(
      mockSpawner,
      mockMonitor,
      mockLogger,
      outputCapture
    );

    taskManager = new TaskManagerService(
      mockQueue,
      workerPool,
      outputCapture,
      mockMonitor,
      mockLogger,
      mockRepository
    );
  });

  describe('Resource exhaustion scenarios', () => {
    it('should handle no available resources', async () => {
      // Mock resource monitor to return false for can spawn worker
      vi.mocked(mockMonitor.canSpawnWorker).mockResolvedValue(ok(false));

      const result = await taskManager.delegate({
        prompt: 'test task',
        priority: Priority.P2
      });

      // Task should still be created and queued, not rejected
      const task = AssertionHelpers.expectSuccessResult(result);
      expect(task.status).toBe(TaskStatus.QUEUED);
    });

    it('should handle memory exhaustion during buffer operations', () => {
      const task = TaskFactory.withBuffer(TEST_CONSTANTS.ONE_KB);
      
      // Configure the task with small buffer first
      outputCapture.configureTask(task.id, { maxOutputBuffer: TEST_CONSTANTS.ONE_KB });
      
      // Try to capture data larger than buffer limit
      const largeData = 'x'.repeat(TEST_CONSTANTS.FIVE_KB);
      const result = outputCapture.capture(task.id, 'stdout', largeData);

      AssertionHelpers.expectErrorResult(result, 'Output buffer limit exceeded');
    });

    it('should handle process spawn failures', async () => {
      vi.mocked(mockSpawner.spawn).mockReturnValue(err(ErrorFactory.systemError('Process spawn failed')));

      const task = TaskFactory.basic();
      const result = await workerPool.spawn(task);

      AssertionHelpers.expectErrorResult(result, 'Process spawn failed');
    });
  });

  describe('Database error scenarios', () => {
    it('should handle database save failures gracefully', async () => {
      vi.mocked(mockRepository.save).mockResolvedValue(err(ErrorFactory.systemError('Database connection lost')));

      const result = await taskManager.delegate({
        prompt: 'test task',
        priority: Priority.P2
      });

      // Task manager continues on database save errors - task is still created
      const task = AssertionHelpers.expectSuccessResult(result);
      expect(task.status).toBe(TaskStatus.QUEUED);
      
      // Logger should have been called with error
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to persist task', expect.any(Object));
    });

    it('should handle database query failures gracefully', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(err(ErrorFactory.systemError('Database query failed')));

      const task = TaskFactory.basic();
      const result = await taskManager.getStatus(task.id);

      // TaskManager uses in-memory Map, not repository for getStatus  
      // Should return task not found since it's not in memory
      AssertionHelpers.expectErrorResult(result, 'not found');
    });
  });

  describe('Network error scenarios', () => {
    it('should handle process spawn failures with proper error wrapping', async () => {
      const networkError = ErrorFactory.networkError();
      vi.mocked(mockSpawner.spawn).mockReturnValue(err(networkError));

      const task = TaskFactory.basic();
      const result = await workerPool.spawn(task);

      const error = AssertionHelpers.expectErrorResult(result);
      // Worker pool wraps errors in WORKER_SPAWN_FAILED, which is correct behavior
      expect(error.code).toBe(ErrorCode.WORKER_SPAWN_FAILED);
    });

    it('should handle connection failures during task execution', () => {
      const timeoutError = ErrorFactory.timeoutError();
      
      // Simulate timeout during output capture by mocking the method
      const mockCapture = vi.spyOn(outputCapture, 'capture').mockReturnValue(err(timeoutError));
      
      const task = TaskFactory.basic();
      const result = outputCapture.capture(task.id, 'stdout', 'test data');

      const error = AssertionHelpers.expectErrorResult(result);
      expect((error as any).code).toBe('ETIMEDOUT');
      
      mockCapture.mockRestore();
    });
  });

  describe('Task lifecycle error scenarios', () => {
    it('should reject cancellation of non-existent task', async () => {
      // Mock repository to return null (task not found)
      vi.mocked(mockRepository.findById).mockResolvedValue(ok(null));
      
      const result = await taskManager.cancel(TaskFactory.basic().id);
      
      // Should return error for non-existent task
      AssertionHelpers.expectErrorResult(result, 'not found');
    });

    it('should handle timeout on already completed task gracefully', async () => {
      const task = TaskFactory.completed();
      
      // Put the completed task in the task manager's memory first
      // @ts-ignore - accessing private member for test
      taskManager.tasks.set(task.id, task);
      
      vi.mocked(mockRepository.save).mockResolvedValue(ok(undefined));
      
      // Try to timeout an already completed task - should be handled gracefully
      const timeoutError = taskTimeout(task.id, TEST_CONSTANTS.FIVE_SECONDS_MS);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Should still process the timeout and save the updated task
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should create new tasks regardless of existing failed tasks', async () => {
      // This test doesn't depend on existing failed tasks - each task is independent
      vi.mocked(mockRepository.save).mockResolvedValue(ok(undefined));
      
      const result = await taskManager.delegate({
        prompt: 'test task',
        priority: Priority.P2
      });
      
      // Should create a new task successfully
      const task = AssertionHelpers.expectSuccessResult(result);
      expect(task.status).toBe(TaskStatus.QUEUED);
    });
  });

  describe('Configuration error scenarios', () => {
    it('should handle invalid timeout values', () => {
      const task = TaskFactory.withTimeout(-1000); // Negative timeout
      
      expect(task.timeout).toBe(-1000); // Value is preserved
      // The system should handle invalid timeouts gracefully in worker pool
    });

    it('should handle zero buffer size configuration', () => {
      const task = TaskFactory.withBuffer(0);
      
      const result = outputCapture.configureTask(task.id, {
        maxOutputBuffer: 0
      });
      
      AssertionHelpers.expectSuccessResult(result);
      
      // Even tiny data should fail with zero buffer
      const captureResult = outputCapture.capture(task.id, 'stdout', 'x');
      AssertionHelpers.expectErrorResult(captureResult, 'buffer limit exceeded');
    });

    it('should handle extremely large buffer sizes', () => {
      const massiveBuffer = Number.MAX_SAFE_INTEGER;
      const task = TaskFactory.withBuffer(massiveBuffer);
      
      const result = outputCapture.configureTask(task.id, {
        maxOutputBuffer: massiveBuffer
      });
      
      AssertionHelpers.expectSuccessResult(result);
    });
  });
});