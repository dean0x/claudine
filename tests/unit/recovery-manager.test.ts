import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoveryManager } from '../../src/services/recovery-manager.js';
import { TaskStatus } from '../../src/core/domain.js';
import type { TaskRepository, TaskQueue, Logger, EventBus } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, AssertionHelpers } from '../helpers/test-factories.js';
import { ok, err } from '../../src/core/result.js';

describe('RecoveryManager', () => {
  let recoveryManager: RecoveryManager;
  let mockRepository: TaskRepository;
  let mockQueue: TaskQueue;
  let mockLogger: Logger;
  let mockEventBus: EventBus;

  beforeEach(() => {
    mockRepository = MockFactory.taskRepository();
    mockQueue = MockFactory.taskQueue();
    mockLogger = MockFactory.logger();
    mockEventBus = MockFactory.eventBus();

    recoveryManager = new RecoveryManager(
      mockRepository,
      mockQueue,
      mockEventBus,
      mockLogger
    );
  });

  describe('task recovery', () => {
    it('should re-queue QUEUED tasks on recovery', async () => {
      const queuedTask = TaskFactory.basic({ status: TaskStatus.QUEUED });
      
      vi.mocked(mockRepository.findByStatus)
        .mockResolvedValueOnce(ok([queuedTask])) // QUEUED tasks
        .mockResolvedValueOnce(ok([])); // RUNNING tasks
      vi.mocked(mockRepository.cleanupOldTasks).mockResolvedValue(ok(0));

      const result = await recoveryManager.recover();

      AssertionHelpers.expectSuccessResult(result);
      expect(mockQueue.enqueue).toHaveBeenCalledWith(queuedTask);
    });

    it('should mark RUNNING tasks as FAILED on recovery', async () => {
      const runningTask = TaskFactory.running();
      
      vi.mocked(mockRepository.findByStatus)
        .mockResolvedValueOnce(ok([])) // QUEUED tasks
        .mockResolvedValueOnce(ok([runningTask])); // RUNNING tasks
      vi.mocked(mockRepository.cleanupOldTasks).mockResolvedValue(ok(0));

      const result = await recoveryManager.recover();

      AssertionHelpers.expectSuccessResult(result);
      expect(mockRepository.update).toHaveBeenCalledWith(
        runningTask.id,
        expect.objectContaining({
          status: TaskStatus.FAILED,
          exitCode: -1,
          completedAt: expect.any(Number)
        })
      );
    });

    it('should skip re-queuing if task already in queue', async () => {
      const queuedTask = TaskFactory.basic({ status: TaskStatus.QUEUED });
      
      // Mock queue to say task is already present
      vi.mocked(mockQueue.contains).mockReturnValue(true);
      
      vi.mocked(mockRepository.findByStatus)
        .mockResolvedValueOnce(ok([queuedTask])) // QUEUED tasks
        .mockResolvedValueOnce(ok([])); // RUNNING tasks
      vi.mocked(mockRepository.cleanupOldTasks).mockResolvedValue(ok(0));

      const result = await recoveryManager.recover();

      AssertionHelpers.expectSuccessResult(result);
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Task already in queue, skipping re-queue',
        { taskId: queuedTask.id }
      );
    });

    it('should cleanup old completed tasks before recovery', async () => {
      vi.mocked(mockRepository.findByStatus)
        .mockResolvedValueOnce(ok([])) // QUEUED tasks
        .mockResolvedValueOnce(ok([])); // RUNNING tasks
      vi.mocked(mockRepository.cleanupOldTasks).mockResolvedValue(ok(5));

      const result = await recoveryManager.recover();

      AssertionHelpers.expectSuccessResult(result);
      expect(mockRepository.cleanupOldTasks).toHaveBeenCalledWith(
        7 * 24 * 60 * 60 * 1000 // 7 days in ms
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up old completed tasks',
        { count: 5 }
      );
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database connection failed');
      vi.mocked(mockRepository.findByStatus).mockResolvedValue(err(error));
      vi.mocked(mockRepository.cleanupOldTasks).mockResolvedValue(ok(0));

      const result = await recoveryManager.recover();

      AssertionHelpers.expectErrorResult(result);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load queued tasks for recovery',
        error
      );
    });
  });
});