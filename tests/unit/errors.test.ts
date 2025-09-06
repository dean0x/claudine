import { describe, it, expect } from 'vitest';
import { ErrorCode, ClaudineError, taskTimeout } from '../../src/core/errors.js';
import { TEST_CONSTANTS, ErrorFactory } from '../helpers/test-factories.js';

describe('Error System', () => {
  describe('ErrorCode enum', () => {
    it('should have TASK_TIMEOUT error code', () => {
      expect(ErrorCode.TASK_TIMEOUT).toBe('TASK_TIMEOUT');
    });
  });

  describe('taskTimeout factory', () => {
    it('should create TASK_TIMEOUT error with correct properties', () => {
      const taskId = 'test-task-123';
      const timeoutMs = TEST_CONSTANTS.FIVE_SECONDS_MS;
      
      const error = taskTimeout(taskId, timeoutMs);
      
      expect(error).toBeInstanceOf(ClaudineError);
      expect(error.code).toBe(ErrorCode.TASK_TIMEOUT);
      expect(error.message).toBe(`Task ${taskId} timed out after ${timeoutMs}ms`);
      expect(error.context).toEqual({ taskId, timeoutMs });
    });

    it('should create error with different timeout values', () => {
      const taskId = 'timeout-test';
      const shortTimeout = TEST_CONSTANTS.ONE_SECOND_MS;
      const longTimeout = TEST_CONSTANTS.TWO_MINUTES_MS;

      const shortError = taskTimeout(taskId, shortTimeout);
      const longError = taskTimeout(taskId, longTimeout);

      expect(shortError.message).toContain(`${shortTimeout}ms`);
      expect(longError.message).toContain(`${longTimeout}ms`);
    });
  });

  describe('error factories', () => {
    it('should create system errors with consistent format', () => {
      const error = ErrorFactory.systemError('Database connection failed');
      
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Database connection failed');
    });

    it('should create network errors with proper error codes', () => {
      const error = ErrorFactory.networkError();
      
      expect(error.message).toBe('Network request failed');
      expect((error as any).code).toBe('ENOTFOUND');
    });

    it('should create timeout errors with proper error codes', () => {
      const error = ErrorFactory.timeoutError();
      
      expect(error.message).toBe('Operation timed out');
      expect((error as any).code).toBe('ETIMEDOUT');
    });
  });
});