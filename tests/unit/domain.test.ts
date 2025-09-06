import { describe, it, expect } from 'vitest';
import { createTask, updateTask, Priority, TaskStatus, type DelegateRequest } from '../../src/core/domain.js';
import { TaskFactory, TEST_CONSTANTS, AssertionHelpers } from '../helpers/test-factories.js';

describe('Task Domain Model', () => {
  describe('createTask', () => {
    it('should create task with timeout from DelegateRequest', () => {
      const request: DelegateRequest = {
        prompt: 'test prompt',
        priority: Priority.P1,
        timeout: TEST_CONSTANTS.TWO_MINUTES_MS,
        maxOutputBuffer: TEST_CONSTANTS.FIVE_MB
      };

      const task = createTask(request);

      expect(task.timeout).toBe(TEST_CONSTANTS.TWO_MINUTES_MS);
      expect(task.maxOutputBuffer).toBe(TEST_CONSTANTS.FIVE_MB);
      expect(task.prompt).toBe('test prompt');
      expect(task.priority).toBe(Priority.P1);
    });

    it('should create task with undefined timeout when not specified', () => {
      const task = TaskFactory.basic();

      expect(task.timeout).toBeUndefined();
      expect(task.maxOutputBuffer).toBeUndefined();
      expect(task.prompt).toBe('test task');
      expect(task.priority).toBe(Priority.P2);
    });

    it('should preserve all existing task properties', () => {
      const task = TaskFactory.withWorktree();

      expect(task.id).toBeDefined();
      AssertionHelpers.expectTaskWithStatus(task, TaskStatus.QUEUED);
      expect(task.createdAt).toBeDefined();
      expect(task.useWorktree).toBe(true);
    });
  });

  describe('updateTask', () => {
    it('should preserve timeout and buffer fields during updates', () => {
      const originalTask = TaskFactory.withTimeoutAndBuffer(
        TEST_CONSTANTS.TWO_MINUTES_MS,
        TEST_CONSTANTS.FIVE_KB
      );

      const updatedTask = updateTask(originalTask, {
        status: TaskStatus.RUNNING,
        startedAt: Date.now()
      });

      expect(updatedTask.timeout).toBe(TEST_CONSTANTS.TWO_MINUTES_MS);
      expect(updatedTask.maxOutputBuffer).toBe(TEST_CONSTANTS.FIVE_KB);
      AssertionHelpers.expectTaskWithStatus(updatedTask, TaskStatus.RUNNING);
    });

    it('should create different task states correctly', () => {
      const completedTask = TaskFactory.completed();
      const failedTask = TaskFactory.failed();
      const runningTask = TaskFactory.running();

      AssertionHelpers.expectTaskWithStatus(completedTask, TaskStatus.COMPLETED);
      expect(completedTask.exitCode).toBe(0);
      
      AssertionHelpers.expectTaskWithStatus(failedTask, TaskStatus.FAILED);
      expect(failedTask.exitCode).toBe(1);
      
      AssertionHelpers.expectTaskWithStatus(runningTask, TaskStatus.RUNNING);
    });
  });
});