/**
 * Error types for Result pattern
 * Never throw these - always return them in Result.err()
 * 
 * @see /docs/SECURITY.md for security-related error handling
 */

/**
 * Error codes used throughout the application
 * Organized by category for better maintainability
 */
export enum ErrorCode {
  // Task errors
  /** Task with specified ID does not exist */
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  /** Task is already running and cannot be started again */
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  /** Task is in a state that prevents cancellation */
  TASK_CANNOT_CANCEL = 'TASK_CANNOT_CANCEL',
  /** Task exceeded its configured timeout */
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  
  // Resource errors
  /** System lacks resources (CPU/memory) to spawn new workers */
  INSUFFICIENT_RESOURCES = 'INSUFFICIENT_RESOURCES',
  /** Failed to monitor system resources */
  RESOURCE_MONITORING_FAILED = 'RESOURCE_MONITORING_FAILED',
  /** Resource limit exceeded (e.g., max listeners, subscriptions) */
  RESOURCE_LIMIT_EXCEEDED = 'RESOURCE_LIMIT_EXCEEDED',
  
  // Process errors
  /** Failed to spawn child process */
  PROCESS_SPAWN_FAILED = 'PROCESS_SPAWN_FAILED',
  /** Failed to kill child process */
  PROCESS_KILL_FAILED = 'PROCESS_KILL_FAILED',
  /** Process with specified PID not found */
  PROCESS_NOT_FOUND = 'PROCESS_NOT_FOUND',
  
  // Worker errors
  /** Worker with specified ID not found */
  WORKER_NOT_FOUND = 'WORKER_NOT_FOUND',
  /** Failed to spawn worker process */
  WORKER_SPAWN_FAILED = 'WORKER_SPAWN_FAILED',
  /** Failed to kill worker process */
  WORKER_KILL_FAILED = 'WORKER_KILL_FAILED',
  /** Task execution failed within worker */
  TASK_EXECUTION_FAILED = 'TASK_EXECUTION_FAILED',
  
  // Validation errors (Security-critical)
  /** Input validation failed - may indicate injection attempt */
  INVALID_INPUT = 'INVALID_INPUT',
  /** Task ID format or content invalid */
  INVALID_TASK_ID = 'INVALID_TASK_ID',
  /** Task prompt validation failed */
  INVALID_PROMPT = 'INVALID_PROMPT',
  /** Directory path invalid or outside allowed boundaries */
  INVALID_DIRECTORY = 'INVALID_DIRECTORY',
  
  // System errors
  /** Generic system error - check logs for details */
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  /** Configuration validation or loading failed */
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  /**
   * Operation not allowed in current context
   * @example Attempting to retry a task that is not in a terminal state (QUEUED, RUNNING)
   * @example Trying to cancel a task that has already completed
   * @example Performing operations on tasks without required permissions
   */
  INVALID_OPERATION = 'INVALID_OPERATION',
  /**
   * System state inconsistent or corrupted
   * @example Missing expected data in database
   * @example Task references non-existent parent task
   * @example Orphaned worker processes without corresponding tasks
   * @example Database schema version mismatch
   */
  INVALID_STATE = 'INVALID_STATE',

  // Queue errors
  /** Task queue has reached maximum capacity */
  QUEUE_FULL = 'QUEUE_FULL',
  /** Attempted operation on empty queue */
  QUEUE_EMPTY = 'QUEUE_EMPTY',
}

/**
 * Custom error class for Claudine
 * Includes error code and optional context for debugging
 * 
 * @example
 * return err(new ClaudineError(
 *   ErrorCode.INVALID_INPUT,
 *   'Path traversal detected',
 *   { path: inputPath, base: baseDir }
 * ));
 */
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

export const resourceLimitExceeded = (resourceType: string, limit: number, current: number): ClaudineError =>
  new ClaudineError(
    ErrorCode.RESOURCE_LIMIT_EXCEEDED,
    `Resource limit exceeded for ${resourceType}: limit=${limit}, current=${current}`,
    { resourceType, limit, current }
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

  // Handle objects with message property
  if (error && typeof error === 'object' && 'message' in error) {
    return systemError(String((error as any).message));
  }

  // Handle null/undefined
  if (error == null) {
    return systemError('Unknown error');
  }

  return systemError(String(error));
};