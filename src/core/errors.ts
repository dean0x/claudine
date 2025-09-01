/**
 * Error types for Result pattern
 * Never throw these - always return them in Result.err()
 */

export enum ErrorCode {
  // Task errors
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  TASK_CANNOT_CANCEL = 'TASK_CANNOT_CANCEL',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  
  // Resource errors
  INSUFFICIENT_RESOURCES = 'INSUFFICIENT_RESOURCES',
  RESOURCE_MONITORING_FAILED = 'RESOURCE_MONITORING_FAILED',
  
  // Process errors
  PROCESS_SPAWN_FAILED = 'PROCESS_SPAWN_FAILED',
  PROCESS_KILL_FAILED = 'PROCESS_KILL_FAILED',
  PROCESS_NOT_FOUND = 'PROCESS_NOT_FOUND',
  
  // Worker errors
  WORKER_NOT_FOUND = 'WORKER_NOT_FOUND',
  WORKER_SPAWN_FAILED = 'WORKER_SPAWN_FAILED',
  
  // Validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_TASK_ID = 'INVALID_TASK_ID',
  INVALID_PROMPT = 'INVALID_PROMPT',
  INVALID_DIRECTORY = 'INVALID_DIRECTORY',
  
  // System errors
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  
  // Queue errors
  QUEUE_FULL = 'QUEUE_FULL',
  QUEUE_EMPTY = 'QUEUE_EMPTY',
}

export class ClaudineError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ClaudineError';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * Error factory functions
 */
export const taskNotFound = (taskId: string): ClaudineError =>
  new ClaudineError(
    ErrorCode.TASK_NOT_FOUND,
    `Task ${taskId} not found`,
    { taskId }
  );

export const taskAlreadyRunning = (taskId: string): ClaudineError =>
  new ClaudineError(
    ErrorCode.TASK_ALREADY_RUNNING,
    `Task ${taskId} is already running`,
    { taskId }
  );

export const taskTimeout = (taskId: string, timeoutMs: number): ClaudineError =>
  new ClaudineError(
    ErrorCode.TASK_TIMEOUT,
    `Task ${taskId} timed out after ${timeoutMs}ms`,
    { taskId, timeoutMs }
  );

export const insufficientResources = (
  cpuUsage: number,
  availableMemory: number
): ClaudineError =>
  new ClaudineError(
    ErrorCode.INSUFFICIENT_RESOURCES,
    `Insufficient resources: CPU ${cpuUsage}%, Memory ${availableMemory} bytes`,
    { cpuUsage, availableMemory }
  );

export const processSpawnFailed = (reason: string): ClaudineError =>
  new ClaudineError(
    ErrorCode.PROCESS_SPAWN_FAILED,
    `Failed to spawn process: ${reason}`,
    { reason }
  );

export const invalidInput = (field: string, value: unknown): ClaudineError =>
  new ClaudineError(
    ErrorCode.INVALID_INPUT,
    `Invalid input for field ${field}`,
    { field, value }
  );

export const invalidDirectory = (path: string): ClaudineError =>
  new ClaudineError(
    ErrorCode.INVALID_DIRECTORY,
    `Invalid directory: ${path}`,
    { path }
  );

export const systemError = (message: string, originalError?: Error): ClaudineError =>
  new ClaudineError(
    ErrorCode.SYSTEM_ERROR,
    message,
    { originalError: originalError?.message }
  );

/**
 * Type guard for ClaudineError
 */
export const isClaudineError = (error: unknown): error is ClaudineError => {
  return error instanceof ClaudineError;
};

/**
 * Convert unknown errors to ClaudineError
 */
export const toClaudineError = (error: unknown): ClaudineError => {
  if (isClaudineError(error)) {
    return error;
  }
  
  if (error instanceof Error) {
    return systemError(error.message, error);
  }
  
  return systemError(String(error));
};