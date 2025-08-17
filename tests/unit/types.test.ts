import { describe, it, expect } from 'vitest';
import { ErrorCode, ClaudineError } from '../../src/types';

describe('ClaudineError', () => {
  it('should create error with correct properties', () => {
    const error = new ClaudineError(
      ErrorCode.TASK_NOT_FOUND,
      'Task not found',
      'test-task-id'
    );
    
    expect(error.code).toBe(ErrorCode.TASK_NOT_FOUND);
    expect(error.message).toBe('Task not found');
    expect(error.taskId).toBe('test-task-id');
    expect(error.name).toBe('ClaudineError');
  });
  
  it('should work without taskId', () => {
    const error = new ClaudineError(
      ErrorCode.INTERNAL_ERROR,
      'Something went wrong'
    );
    
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.message).toBe('Something went wrong');
    expect(error.taskId).toBeUndefined();
  });
});

describe('ErrorCode enum', () => {
  it('should have all expected error codes', () => {
    expect(ErrorCode.TASK_NOT_FOUND).toBe('TASK_NOT_FOUND');
    expect(ErrorCode.TASK_ALREADY_RUNNING).toBe('TASK_ALREADY_RUNNING');
    expect(ErrorCode.CLAUDE_NOT_FOUND).toBe('CLAUDE_NOT_FOUND');
    expect(ErrorCode.SPAWN_FAILED).toBe('SPAWN_FAILED');
    expect(ErrorCode.INVALID_PROMPT).toBe('INVALID_PROMPT');
    expect(ErrorCode.TASK_TIMEOUT).toBe('TASK_TIMEOUT');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});