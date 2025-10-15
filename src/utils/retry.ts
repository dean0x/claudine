/**
 * Retry utility with exponential backoff for transient operations
 */

import { Logger } from '../core/interfaces.js';

/**
 * Sleep for specified milliseconds
 * @param ms Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determines if an error is retryable
 * @param error The error to check
 * @returns true if the error is likely transient and worth retrying
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  
  const message = error.message.toLowerCase();
  
  // Network errors
  if (message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('network') ||
      message.includes('socket')) {
    return true;
  }
  
  // Git remote errors
  if (message.includes('could not read from remote') ||
      message.includes('unable to access') ||
      message.includes('connection timed out') ||
      message.includes('operation timed out') ||
      message.includes('ssl') ||
      message.includes('tls')) {
    return true;
  }
  
  // GitHub API rate limiting
  if (message.includes('rate limit') ||
      message.includes('api rate') ||
      message.includes('too many requests')) {
    return true;
  }
  
  // File system race conditions
  if (message.includes('ebusy') ||
      message.includes('resource busy') ||
      message.includes('file is locked')) {
    return true;
  }
  
  // Don't retry these errors
  if (message.includes('authentication') ||
      message.includes('permission denied') ||
      message.includes('not authorized') ||
      message.includes('invalid') ||
      message.includes('merge conflict') ||
      message.includes('already exists')) {
    return false;
  }
  
  return false;
}

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Optional logger for retry attempts */
  logger?: Logger;
  /** Operation name for logging */
  operation?: string;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Retry an async operation with exponential backoff
 * @param fn The async function to retry
 * @param options Retry configuration options
 * @returns The result of the function or throws the last error
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    logger,
    operation = 'operation',
    isRetryable = isRetryableError
  } = options;

  let lastError: unknown;

  // Attempt 0 is the initial attempt, then we have maxRetries additional attempts
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Attempt the operation
      const result = await fn();

      // Success - log if this was a retry
      if (attempt > 0 && logger) {
        logger.info(`${operation} succeeded after ${attempt} retries`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt === maxRetries) {
        // Last retry attempt failed
        if (logger) {
          logger.error(
            `${operation} failed after ${maxRetries} retries`,
            error as Error
          );
        }
        throw error;
      }
      
      // Check if error is retryable
      if (!isRetryable(error)) {
        if (logger) {
          logger.debug(`${operation} failed with non-retryable error`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );
      
      if (logger) {
        logger.warn(`${operation} failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxRetries,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Wait before retrying
      await sleep(delay);
    }
  }
  
  // This should never be reached, but TypeScript doesn't know that
  throw lastError;
}

/**
 * Retry an async operation immediately a fixed number of times
 * Useful for operations that might fail due to timing but don't need backoff
 * @param fn The async function to retry
 * @param maxAttempts Maximum number of attempts (default: 3)
 * @param logger Optional logger
 * @returns The result of the function or throws the last error
 */
export async function retryImmediate<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  logger?: Logger
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts - 1) {
        if (logger) {
          logger.debug(`Operation failed after ${maxAttempts} immediate attempts`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      }
    }
  }
  
  throw lastError;
}