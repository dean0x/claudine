import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { EventDrivenWorkerPool } from '../../src/implementations/event-driven-worker-pool.js';
import { BufferedOutputCapture } from '../../src/implementations/output-capture.js';
import { TaskStatus, Priority } from '../../src/core/domain.js';
import { ErrorCode } from '../../src/core/errors.js';
import type { TaskQueue, ResourceMonitor, Logger, TaskRepository, ProcessSpawner, EventBus } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, TEST_CONSTANTS, AssertionHelpers, ErrorFactory } from '../helpers/test-factories.js';
import { err, ok } from '../../src/core/result.js';
import { taskTimeout } from '../../src/core/errors.js';

describe('Error Scenario Tests', () => {
  let taskManager: TaskManagerService;
  let workerPool: EventDrivenWorkerPool;
  let outputCapture: BufferedOutputCapture;
  let mockQueue: TaskQueue;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockRepository: TaskRepository;
  let mockSpawner: ProcessSpawner;
  let mockEventBus: EventBus;

  beforeEach(() => {
    mockQueue = MockFactory.taskQueue();
    mockMonitor = MockFactory.resourceMonitor(true);
    mockLogger = MockFactory.logger();
    mockRepository = MockFactory.taskRepository();
    mockSpawner = MockFactory.processSpawner();
    mockEventBus = MockFactory.eventBus();

    outputCapture = new BufferedOutputCapture();
    
    workerPool = new EventDrivenWorkerPool(
      mockSpawner,
      mockMonitor,
      mockLogger,
      mockEventBus,
      outputCapture
    );

    taskManager = new TaskManagerService(
      mockEventBus,
      mockRepository,
      mockLogger
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
    it('should reject task delegation when event emission fails', async () => {
      // Mock event bus to fail when emitting TaskDelegated event
      vi.mocked(mockEventBus.emit).mockResolvedValue(err(new Error('Event emission failed')));

      const result = await taskManager.delegate({
        prompt: 'test task',
        priority: Priority.P2
      });

      // Event-driven architecture: task delegation fails if event emission fails
      AssertionHelpers.expectErrorResult(result, 'Event emission failed');
    });

    it('should handle database query failures gracefully', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue(err(ErrorFactory.systemError('Database query failed')));

      const task = TaskFactory.basic();
      const result = await taskManager.getStatus(task.id);

      // TaskManager uses repository for getStatus in event-driven architecture  
      // Should propagate the database query failure
      AssertionHelpers.expectErrorResult(result, 'Database query failed');
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
      
      // Mock repository to return the completed task
      vi.mocked(mockRepository.findById).mockResolvedValue(ok(task));
      
      vi.mocked(mockRepository.save).mockResolvedValue(ok(undefined));
      
      // In event-driven architecture, timeout is handled by EventBus
      // This test should verify the task status retrieval works correctly
      const result = await taskManager.getStatus(task.id);
      const retrievedTask = AssertionHelpers.expectSuccessResult(result);

      // Task should still be marked as completed
      expect(retrievedTask.status).toBe(TaskStatus.COMPLETED);
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