/**
 * Input validation utilities
 * Provides secure validation for user inputs
 */

import path from 'path';
import { Result, ok, err } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

/**
 * Validate that a path is within allowed boundaries
 * Prevents path traversal attacks by ensuring paths stay within base directory
 * @param inputPath The path to validate
 * @param baseDir Base directory to validate against (defaults to cwd)
 * @returns Resolved absolute path or error if validation fails
 */
export function validatePath(inputPath: string, baseDir?: string): Result<string> {
  try {
    // If no base directory provided, use current working directory
    const base = baseDir || process.cwd();
    
    // Resolve the absolute path
    const resolvedPath = path.resolve(base, inputPath);
    const resolvedBase = path.resolve(base);
    
    // Check if the resolved path is within the base directory
    if (!resolvedPath.startsWith(resolvedBase)) {
      return err(new ClaudineError(
        ErrorCode.INVALID_INPUT,
        `Path traversal detected: ${inputPath} resolves outside of ${base}`
      ));
    }
    
    // Check for suspicious patterns
    if (inputPath.includes('../') || inputPath.includes('..\\')) {
      return err(new ClaudineError(
        ErrorCode.INVALID_INPUT,
        `Suspicious path pattern detected: ${inputPath}`
      ));
    }
    
    return ok(resolvedPath);
  } catch (error) {
    return err(new ClaudineError(
      ErrorCode.INVALID_INPUT,
      `Invalid path: ${error instanceof Error ? error.message : String(error)}`
    ));
  }
}

/**
 * Sanitize a branch name for git
 * Removes characters that could cause command injection or git issues
 * @param name Raw branch name input
 * @returns Sanitized branch name safe for git operations
 */
export function sanitizeBranchName(name: string): string {
  // Remove any characters that aren't alphanumeric, dash, underscore, or slash
  // Also remove leading/trailing dashes
  return name
    .replace(/[^a-zA-Z0-9\-_\/]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100); // Limit length
}

/**
 * Validate buffer size is within reasonable limits
 * Prevents memory exhaustion attacks by enforcing size limits
 * @param size Buffer size in bytes to validate
 * @returns Validated size or error if outside limits (1KB - 1GB)
 */
export function validateBufferSize(size: number): Result<number> {
  const MIN_BUFFER = 1024; // 1KB
  const MAX_BUFFER = 1073741824; // 1GB
  
  if (isNaN(size) || size < MIN_BUFFER) {
    return err(new ClaudineError(
      ErrorCode.INVALID_INPUT,
      `Buffer size must be at least ${MIN_BUFFER} bytes`
    ));
  }
  
  if (size > MAX_BUFFER) {
    return err(new ClaudineError(
      ErrorCode.INVALID_INPUT,
      `Buffer size cannot exceed ${MAX_BUFFER} bytes (1GB)`
    ));
  }
  
  return ok(size);
}

/**
 * Validate timeout is within reasonable limits
 * Prevents resource exhaustion by enforcing timeout limits
 * @param timeout Timeout in milliseconds to validate
 * @returns Validated timeout or error if outside limits (1s - 24h)
 */
export function validateTimeout(timeout: number): Result<number> {
  const MIN_TIMEOUT = 1000; // 1 second
  const MAX_TIMEOUT = 86400000; // 24 hours
  
  if (isNaN(timeout) || timeout < MIN_TIMEOUT) {
    return err(new ClaudineError(
      ErrorCode.INVALID_INPUT,
      `Timeout must be at least ${MIN_TIMEOUT}ms`
    ));
  }
  
  if (timeout > MAX_TIMEOUT) {
    return err(new ClaudineError(
      ErrorCode.INVALID_INPUT,
      `Timeout cannot exceed ${MAX_TIMEOUT}ms (24 hours)`
    ));
  }
  
  return ok(timeout);
}