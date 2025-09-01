import { describe, it, expect } from 'vitest';
import { createTask, updateTask, Priority, TaskStatus, type DelegateRequest } from '../../src/core/domain.js';

describe('Task Domain Model', () => {
  describe('createTask', () => {
    it('should create task with timeout from DelegateRequest', () => {
      const request: DelegateRequest = {
        prompt: 'test prompt',
        priority: Priority.P1,
        timeout: 120000, // 2 minutes
        maxOutputBuffer: 5242880 // 5MB
      };

      const task = createTask(request);

      expect(task.timeout).toBe(120000);
      expect(task.maxOutputBuffer).toBe(5242880);
      expect(task.prompt).toBe('test prompt');
      expect(task.priority).toBe(Priority.P1);
    });

    it('should create task with undefined timeout when not specified', () => {
      const request: DelegateRequest = {
        prompt: 'test prompt'
      };

      const task = createTask(request);

      expect(task.timeout).toBeUndefined();
      expect(task.maxOutputBuffer).toBeUndefined();
    });

    it('should preserve all existing task properties', () => {
      const request: DelegateRequest = {
        prompt: 'test task',
        priority: Priority.P2,
        workingDirectory: '/test/dir',
        useWorktree: true
      };

      const task = createTask(request);

      expect(task.id).toBeDefined();
      expect(task.status).toBe(TaskStatus.QUEUED);
      expect(task.createdAt).toBeDefined();
      expect(task.workingDirectory).toBe('/test/dir');
      expect(task.useWorktree).toBe(true);
    });
  });

  describe('updateTask', () => {
    it('should preserve timeout and buffer fields during updates', () => {
      const originalTask = createTask({
        prompt: 'test',
        timeout: 180000,
        maxOutputBuffer: 2097152
      });

      const updatedTask = updateTask(originalTask, {
        status: TaskStatus.RUNNING,
        startedAt: Date.now()
      });

      expect(updatedTask.timeout).toBe(180000);
      expect(updatedTask.maxOutputBuffer).toBe(2097152);
      expect(updatedTask.status).toBe(TaskStatus.RUNNING);
      expect(updatedTask.startedAt).toBeDefined();
    });
  });
});