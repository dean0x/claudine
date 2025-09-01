import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { createTask, TaskId, TaskStatus, Priority } from '../../src/core/domain.js';
import { ok, err } from '../../src/core/result.js';
import { taskTimeout, ErrorCode } from '../../src/core/errors.js';
import type { TaskQueue, WorkerPool, OutputCapture, ResourceMonitor, Logger, TaskRepository } from '../../src/core/interfaces.js';

describe('TaskManagerService Timeout Handling', () => {
  let taskManager: TaskManagerService;
  let mockQueue: TaskQueue;
  let mockWorkers: WorkerPool;
  let mockOutput: OutputCapture;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockRepository: TaskRepository;

  beforeEach(() => {
    mockQueue = {
      enqueue: vi.fn().mockReturnValue(ok(undefined)),
      dequeue: vi.fn().mockReturnValue(ok(null)),
      remove: vi.fn().mockReturnValue(ok(undefined)),
      peek: vi.fn().mockReturnValue(ok(null)),
      size: vi.fn().mockReturnValue(0),
      isEmpty: vi.fn().mockReturnValue(true),
      clear: vi.fn().mockReturnValue(ok(undefined))
    } as TaskQueue;

    mockWorkers = {
      spawn: vi.fn().mockResolvedValue(ok({ id: 'worker-1' } as any)),
      kill: vi.fn().mockResolvedValue(ok(undefined)),
      killAll: vi.fn().mockResolvedValue(ok(undefined)),
      getWorker: vi.fn().mockReturnValue(ok(null)),
      getWorkers: vi.fn().mockReturnValue(ok([])),
      getWorkerCount: vi.fn().mockReturnValue(0),
      getWorkerForTask: vi.fn().mockReturnValue(ok(null))
    } as WorkerPool;

    mockOutput = {
      getOutput: vi.fn().mockReturnValue(ok({ stdout: '', stderr: '', totalSize: 0 }))
    } as OutputCapture;

    mockMonitor = {
      canSpawnWorker: vi.fn().mockResolvedValue(ok(true))
    } as any;

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis()
    } as any;

    mockRepository = {
      save: vi.fn().mockResolvedValue(ok(undefined)),
      findById: vi.fn().mockResolvedValue(ok(null)),
      findByStatus: vi.fn().mockResolvedValue(ok([])),
      update: vi.fn().mockResolvedValue(ok(undefined)),
      delete: vi.fn().mockResolvedValue(ok(undefined))
    } as TaskRepository;

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
        timeout: 5000
      });
      
      expect(delegateResult.ok).toBe(true);
      if (!delegateResult.ok) return;
      
      const task = delegateResult.value;

      // Simulate timeout
      const timeoutError = taskTimeout(task.id, 5000);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Check task status
      const statusResult = await taskManager.getStatus(task.id);
      expect(statusResult.ok).toBe(true);
      
      if (statusResult.ok) {
        const updatedTask = statusResult.value as any;
        expect(updatedTask.status).toBe(TaskStatus.FAILED);
        expect(updatedTask.completedAt).toBeDefined();
      }
    });

    it('should persist timeout task updates to repository', async () => {
      // Delegate task first
      const delegateResult = await taskManager.delegate({
        prompt: 'test task',
        timeout: 5000
      });
      
      expect(delegateResult.ok).toBe(true);
      if (!delegateResult.ok) return;
      
      const task = delegateResult.value;

      // Simulate timeout
      const timeoutError = taskTimeout(task.id, 5000);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Verify repository save was called
      expect(mockRepository.save).toHaveBeenCalled();
      const savedTask = vi.mocked(mockRepository.save).mock.calls.find(call => 
        call[0].status === TaskStatus.FAILED
      );
      expect(savedTask).toBeDefined();
    });

    it('should log timeout events', async () => {
      // Delegate task first
      const delegateResult = await taskManager.delegate({
        prompt: 'test task',
        timeout: 5000
      });
      
      expect(delegateResult.ok).toBe(true);
      if (!delegateResult.ok) return;
      
      const task = delegateResult.value;

      // Simulate timeout
      const timeoutError = taskTimeout(task.id, 5000);
      await taskManager.onTaskTimeout(task.id, timeoutError);

      // Verify error logging
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Task ${task.id} timed out after 5000ms`
      );
    });
  });
});