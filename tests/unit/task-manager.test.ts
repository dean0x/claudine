import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { TaskStatus } from '../../src/core/domain.js';
import { NullEventBus } from '../../src/core/events/event-bus.js';
import type { Logger, TaskRepository } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, TEST_CONSTANTS, AssertionHelpers } from '../helpers/test-factories.js';

describe('TaskManagerService Event-Driven Architecture', () => {
  let taskManager: TaskManagerService;
  let mockEventBus: NullEventBus;
  let mockLogger: Logger;
  let mockRepository: TaskRepository;

  beforeEach(() => {
    mockEventBus = new NullEventBus();
    mockLogger = MockFactory.logger();
    mockRepository = MockFactory.taskRepository();

    // Fix the logger mock to have proper methods
    Object.assign(mockLogger, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => mockLogger)
    });

    taskManager = new TaskManagerService(
      mockEventBus,
      mockRepository,
      mockLogger,
      {
        timeout: TEST_CONSTANTS.FIVE_SECONDS_MS,
        maxOutputBuffer: 1024 * 1024, // 1MB
        cpuThreshold: 80,
        memoryReserve: 1024 * 1024 * 100, // 100MB
        logLevel: 'info'
      },
      undefined // outputCapture is optional
    );
  });

  describe('task delegation', () => {
    it('should create task and emit TaskDelegated event', async () => {
      const delegateResult = await taskManager.delegate({
        prompt: 'test task',
        timeout: TEST_CONSTANTS.FIVE_SECONDS_MS
      });
      
      const task = AssertionHelpers.expectSuccessResult(delegateResult);
      expect(task.prompt).toBe('test task');
      expect(task.status).toBe(TaskStatus.QUEUED);
      expect(task.timeout).toBe(TEST_CONSTANTS.FIVE_SECONDS_MS);
      
      // Verify logging occurred
      expect(mockLogger.info).toHaveBeenCalledWith('Delegating task', expect.objectContaining({
        taskId: task.id,
        priority: task.priority
      }));
    });

    it('should handle event emission failures gracefully', async () => {
      // Create a failing event bus
      const failingEventBus = {
        emit: vi.fn().mockResolvedValue({ ok: false, error: new Error('Event emission failed') }),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        subscribeAll: vi.fn(),
        unsubscribeAll: vi.fn()
      };

      const failingTaskManager = new TaskManagerService(
        failingEventBus as any,
        mockRepository,
        mockLogger,
        {
          timeout: TEST_CONSTANTS.FIVE_SECONDS_MS,
          maxOutputBuffer: 1024 * 1024,
          cpuThreshold: 80,
          memoryReserve: 1024 * 1024 * 100,
          logLevel: 'info'
        },
        undefined
      );

      const delegateResult = await failingTaskManager.delegate({
        prompt: 'test task'
      });
      
      expect(delegateResult.ok).toBe(false);
      expect(delegateResult.error?.message).toBe('Event emission failed');
    });
  });

  describe('task status retrieval', () => {
    it('should get single task status from repository', async () => {
      const testTask = TaskFactory.basic('test task');
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: testTask });

      const statusResult = await taskManager.getStatus(testTask.id);
      
      const task = AssertionHelpers.expectSuccessResult(statusResult);
      expect(task).toEqual(testTask);
      expect(mockRepository.findById).toHaveBeenCalledWith(testTask.id);
    });

    it('should handle task not found', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: null });

      const statusResult = await taskManager.getStatus('non-existent-id');
      
      expect(statusResult.ok).toBe(false);
      expect(statusResult.error?.message).toContain('Task non-existent-id not found');
    });

    it('should get all tasks when no taskId provided', async () => {
      const tasks = [TaskFactory.basic(), TaskFactory.basic()];
      vi.mocked(mockRepository.findAll).mockResolvedValue({ ok: true, value: tasks });

      const statusResult = await taskManager.getStatus();
      
      const allTasks = AssertionHelpers.expectSuccessResult(statusResult) as any[];
      expect(allTasks).toEqual(tasks);
      expect(mockRepository.findAll).toHaveBeenCalledOnce();
    });
  });

  describe('task logs retrieval', () => {
    it('should emit LogsRequested event for existing task', async () => {
      const testTask = TaskFactory.basic('test task');
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: testTask });

      const logsResult = await taskManager.getLogs(testTask.id);
      
      const logs = AssertionHelpers.expectSuccessResult(logsResult);
      expect(logs).toEqual({
        taskId: testTask.id,
        stdout: [],
        stderr: [],
        totalSize: 0
      });
    });

    it('should handle logs request for non-existent task', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: null });

      const logsResult = await taskManager.getLogs('non-existent-id');
      
      expect(logsResult.ok).toBe(false);
      expect(logsResult.error?.message).toContain('Task non-existent-id not found');
    });
  });

  describe('task cancellation', () => {
    it('should cancel existing cancellable task', async () => {
      const testTask = TaskFactory.running();
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: testTask });

      const cancelResult = await taskManager.cancel(testTask.id, 'user requested');
      
      AssertionHelpers.expectSuccessResult(cancelResult);
      expect(mockLogger.info).toHaveBeenCalledWith('Cancelling task', {
        taskId: testTask.id,
        reason: 'user requested'
      });
    });

    it('should reject cancellation of completed task', async () => {
      const completedTask = TaskFactory.completed();
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: completedTask });

      const cancelResult = await taskManager.cancel(completedTask.id);
      
      expect(cancelResult.ok).toBe(false);
      expect(cancelResult.error?.message).toContain('cannot be cancelled in state');
    });

    it('should handle cancellation of non-existent task', async () => {
      vi.mocked(mockRepository.findById).mockResolvedValue({ ok: true, value: null });

      const cancelResult = await taskManager.cancel('non-existent-id');
      
      expect(cancelResult.ok).toBe(false);
      expect(cancelResult.error?.message).toContain('Task non-existent-id not found');
    });
  });

  describe('listTasks method', () => {
    it('should return empty array and log warning', () => {
      const result = taskManager.listTasks();
      
      const tasks = AssertionHelpers.expectSuccessResult(result);
      expect(tasks).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('listTasks() is deprecated and returns empty array')
      );
    });
  });
});