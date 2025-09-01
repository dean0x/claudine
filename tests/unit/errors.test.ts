import { describe, it, expect } from 'vitest';
import { ErrorCode, ClaudineError, taskTimeout } from '../../src/core/errors.js';

describe('Error System', () => {
  describe('ErrorCode enum', () => {
    it('should have TASK_TIMEOUT error code', () => {
      expect(ErrorCode.TASK_TIMEOUT).toBe('TASK_TIMEOUT');
    });
  });

  describe('taskTimeout factory', () => {
    it('should create TASK_TIMEOUT error with correct properties', () => {
      const taskId = 'test-task-123';
      const timeoutMs = 60000;
      
      const error = taskTimeout(taskId, timeoutMs);
      
      expect(error).toBeInstanceOf(ClaudineError);
      expect(error.code).toBe(ErrorCode.TASK_TIMEOUT);
      expect(error.message).toBe(`Task ${taskId} timed out after ${timeoutMs}ms`);
      expect(error.context).toEqual({ taskId, timeoutMs });
    });
  });
});