import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryWithBackoff, retryImmediate, isRetryableError } from './retry.js';
import { ConsoleLogger } from '../implementations/logger.js';

describe('Retry Utilities', () => {
  let logger: ConsoleLogger;
  
  beforeEach(() => {
    vi.useFakeTimers();
    logger = new ConsoleLogger('test');
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      const networkErrors = [
        new Error('ECONNREFUSED: Connection refused'),
        new Error('ECONNRESET: Connection reset by peer'),
        new Error('ETIMEDOUT: Connection timed out'),
        new Error('Network error occurred'),
        new Error('Socket hang up')
      ];
      
      networkErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
    
    it('should identify git remote errors as retryable', () => {
      const gitErrors = [
        new Error('Could not read from remote repository'),
        new Error('Unable to access remote'),
        new Error('Connection timed out'),
        new Error('SSL certificate problem')
      ];
      
      gitErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
    
    it('should identify rate limiting as retryable', () => {
      const rateLimitErrors = [
        new Error('API rate limit exceeded'),
        new Error('Too many requests')
      ];
      
      rateLimitErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
    
    it('should NOT identify auth errors as retryable', () => {
      const authErrors = [
        new Error('Authentication failed'),
        new Error('Permission denied'),
        new Error('Not authorized'),
        new Error('Invalid credentials')
      ];
      
      authErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
    
    it('should NOT identify validation errors as retryable', () => {
      const validationErrors = [
        new Error('Invalid input'),
        new Error('Merge conflict detected'),
        new Error('File already exists')
      ];
      
      validationErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first try', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      
      const result = await retryWithBackoff(fn, { logger });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.info).not.toHaveBeenCalled();
    });
    
    it('should retry on failure and succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce('success');
      
      const promise = retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 1000,
        logger,
        operation: 'test operation'
      });
      
      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'test operation failed, retrying in 1000ms',
        expect.objectContaining({
          attempt: 1,
          maxRetries: 3,
          error: 'ECONNREFUSED'
        })
      );
      
      // Wait for retry delay
      await vi.advanceTimersByTimeAsync(1000);
      
      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('test operation succeeded after 1 retries');
    });
    
    it('should use exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');
      
      const promise = retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        logger
      });
      
      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      
      // First retry after 100ms
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(2);
      
      // Second retry after 200ms (100 * 2^1)
      await vi.advanceTimersByTimeAsync(200);
      expect(fn).toHaveBeenCalledTimes(3);
      
      const result = await promise;
      expect(result).toBe('success');
    });
    
    it('should respect max delay', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success');
      
      const promise = retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 10000,
        maxDelay: 5000, // Max delay is less than initial
        logger
      });
      
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      
      // Should wait maxDelay (5000ms) not initialDelay (10000ms)
      await vi.advanceTimersByTimeAsync(5000);
      expect(fn).toHaveBeenCalledTimes(2);
      
      await promise;
    });
    
    it('should fail after max retries', async () => {
      const error = new Error('Network error');
      const fn = vi.fn().mockRejectedValue(error);
      
      const promise = retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 100,
        logger,
        operation: 'failing operation'
      });
      
      // Catch the promise to prevent unhandled rejection
      const resultPromise = promise.catch(e => e);
      
      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      
      // First retry
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(2);
      
      const result = await resultPromise;
      expect(result).toEqual(error);
      expect(logger.error).toHaveBeenCalledWith(
        'failing operation failed after 2 attempts',
        error
      );
    });
    
    it('should not retry non-retryable errors', async () => {
      const error = new Error('Authentication failed');
      const fn = vi.fn().mockRejectedValue(error);
      
      await expect(
        retryWithBackoff(fn, { maxRetries: 3, logger })
      ).rejects.toThrow('Authentication failed');
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalled();
    });
    
    it('should use custom isRetryable function', async () => {
      const customRetryable = (error: unknown) => {
        return error instanceof Error && error.message === 'retry me';
      };
      
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('retry me'))
        .mockResolvedValueOnce('success');
      
      const promise = retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 100,
        isRetryable: customRetryable,
        logger
      });
      
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      
      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('retryImmediate', () => {
    it('should retry immediately without delay', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');
      
      const result = await retryImmediate(fn, 3, logger);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      // No timers were used
      expect(vi.getTimerCount()).toBe(0);
    });
    
    it('should fail after max attempts', async () => {
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);
      
      await expect(
        retryImmediate(fn, 2, logger)
      ).rejects.toThrow('persistent failure');
      
      expect(fn).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledWith(
        'Operation failed after 2 immediate attempts',
        expect.objectContaining({ error: 'persistent failure' })
      );
    });
    
    it('should succeed on first try', async () => {
      const fn = vi.fn().mockResolvedValue('immediate success');
      
      const result = await retryImmediate(fn, 3);
      
      expect(result).toBe('immediate success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Integration with real async operations', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });
    
    it('should handle real async operations with delays', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
        return 'success after retries';
      };
      
      const result = await retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 10, // Small delay for testing
        logger
      });
      
      expect(result).toBe('success after retries');
      expect(attempts).toBe(3);
    });
  });
});