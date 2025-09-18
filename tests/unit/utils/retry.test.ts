import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  retryWithBackoff,
  retryImmediate,
  isRetryableError,
  type RetryOptions
} from '../../../src/utils/retry';
import { TestLogger } from '../../../src/implementations/logger';

describe('isRetryableError - REAL Error Classification', () => {
  describe('Network errors', () => {
    it('should identify connection refused as retryable', () => {
      const error = new Error('ECONNREFUSED: Connection refused');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify connection reset as retryable', () => {
      const error = new Error('ECONNRESET: Connection reset by peer');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify timeout errors as retryable', () => {
      const errors = [
        new Error('ETIMEDOUT: Connection timed out'),
        new Error('Operation timed out'),
        new Error('Connection timed out after 30000ms')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify DNS errors as retryable', () => {
      const error = new Error('ENOTFOUND: getaddrinfo ENOTFOUND api.github.com');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify generic network errors as retryable', () => {
      const errors = [
        new Error('Network error occurred'),
        new Error('Socket timeout'),
        new Error('Socket connection failed')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
  });

  describe('Git remote errors', () => {
    it('should identify git remote read errors as retryable', () => {
      const error = new Error('Could not read from remote repository');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify git access errors as retryable', () => {
      const error = new Error('Unable to access https://github.com/repo.git');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should identify SSL/TLS errors as retryable', () => {
      const errors = [
        new Error('SSL certificate problem: unable to verify'),
        new Error('TLS handshake failed')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
  });

  describe('Rate limiting', () => {
    it('should identify rate limit errors as retryable', () => {
      const errors = [
        new Error('API rate limit exceeded'),
        new Error('Rate limit reached'),
        new Error('Too many requests, please retry later')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
  });

  describe('File system race conditions', () => {
    it('should identify busy resources as retryable', () => {
      const errors = [
        new Error('EBUSY: resource busy or locked'),
        new Error('File is locked by another process'),
        new Error('Resource busy')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
  });

  describe('Non-retryable errors', () => {
    it('should not retry authentication errors', () => {
      const errors = [
        new Error('Authentication failed'),
        new Error('Invalid authentication credentials'),
        new Error('Not authorized to perform this action')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should not retry permission errors', () => {
      const error = new Error('Permission denied');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not retry validation errors', () => {
      const errors = [
        new Error('Invalid input provided'),
        new Error('Validation failed: name is required')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should not retry conflict errors', () => {
      const errors = [
        new Error('Merge conflict detected'),
        new Error('Resource already exists')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });

    it('should not retry unknown errors by default', () => {
      const errors = [
        new Error('Some random error'),
        new Error('Unexpected failure'),
        new Error('Internal error')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('Error type handling', () => {
    it('should return false for non-Error objects', () => {
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError(123)).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError({ message: 'ECONNREFUSED' })).toBe(false);
    });

    it('should handle case insensitive matching', () => {
      const errors = [
        new Error('ECONNREFUSED: connection refused'),
        new Error('econnrefused: Connection Refused'),
        new Error('EcOnNrEfUsEd: CONNECTION REFUSED')
      ];

      errors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });
  });
});

describe('retryWithBackoff - REAL Retry Behavior', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Successful operations', () => {
    it('should return immediately on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const promise = retryWithBackoff(fn, { logger });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.logs).toHaveLength(0); // No retries logged
    });

    it('should succeed after retries', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        logger,
        operation: 'api-call'
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(logger.hasLog('warn', 'api-call failed, retrying in 1000ms')).toBe(true);
      expect(logger.hasLog('warn', 'api-call failed, retrying in 2000ms')).toBe(true);
      expect(logger.hasLog('info', 'api-call succeeded after 2 retries')).toBe(true);
    });
  });

  describe('Exponential backoff', () => {
    it('should use exponential backoff with default settings', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('done');

      const promise = retryWithBackoff(fn);

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Wait for first retry (1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Wait for second retry (2000ms)
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe('done');
    });

    it('should respect custom backoff settings', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue('ok');

      const promise = retryWithBackoff(fn, {
        initialDelay: 500,
        backoffMultiplier: 3,
        logger
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(logger.logs[0].context?.attempt).toBe(1);
      expect(logger.logs[0].message).toContain('500ms');
      expect(logger.logs[1].context?.attempt).toBe(2);
      expect(logger.logs[1].message).toContain('1500ms'); // 500 * 3
    });

    it('should cap delay at maxDelay', async () => {
      const fn = vi.fn();
      for (let i = 0; i < 5; i++) {
        fn.mockRejectedValueOnce(new Error('ECONNRESET'));
      }
      fn.mockResolvedValue('finally');

      const promise = retryWithBackoff(fn, {
        maxRetries: 6,
        initialDelay: 1000,
        backoffMultiplier: 10,
        maxDelay: 5000,
        logger
      });

      await vi.runAllTimersAsync();
      await promise;

      // Check that delays are capped
      const delays = logger.logs
        .filter(l => l.level === 'warn')
        .map(l => {
          const match = l.message.match(/(\d+)ms/);
          return match ? parseInt(match[1]) : 0;
        });

      expect(delays[0]).toBe(1000);  // 1000 * 10^0
      expect(delays[1]).toBe(5000);  // min(10000, 5000)
      expect(delays[2]).toBe(5000);  // min(100000, 5000)
    });
  });

  describe('Error handling', () => {
    it('should throw after max retries', async () => {
      const error = new Error('ECONNREFUSED');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 10,
        logger,
        operation: 'connect'
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('ECONNREFUSED');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(logger.hasLog('error', 'connect failed after 3 attempts')).toBe(true);
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Permission denied');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retryWithBackoff(fn, {
        logger,
        operation: 'write-file'
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Permission denied');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.hasLog('debug', 'write-file failed with non-retryable error')).toBe(true);
    });

    it('should use custom isRetryable function', async () => {
      const customRetryable = (error: unknown) => {
        return error instanceof Error && error.message === 'RETRY_ME';
      };

      const retryableError = new Error('RETRY_ME');
      const nonRetryableError = new Error('DONT_RETRY');

      // Test retryable error
      const fn1 = vi.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const promise1 = retryWithBackoff(fn1, {
        isRetryable: customRetryable,
        initialDelay: 10
      });

      await vi.runAllTimersAsync();
      expect(await promise1).toBe('success');
      expect(fn1).toHaveBeenCalledTimes(2);

      // Test non-retryable error
      const fn2 = vi.fn().mockRejectedValue(nonRetryableError);

      const promise2 = retryWithBackoff(fn2, {
        isRetryable: customRetryable
      });

      await vi.runAllTimersAsync();
      await expect(promise2).rejects.toThrow('DONT_RETRY');
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Logging behavior', () => {
    it('should log retry attempts with context', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET: Connection reset'))
        .mockResolvedValue('ok');

      const promise = retryWithBackoff(fn, {
        logger,
        operation: 'database-query',
        initialDelay: 100
      });

      await vi.runAllTimersAsync();
      await promise;

      const warnLog = logger.logs.find(l => l.level === 'warn');
      expect(warnLog).toBeDefined();
      expect(warnLog?.message).toContain('database-query failed');
      expect(warnLog?.context).toEqual({
        attempt: 1,
        maxRetries: 3,
        error: 'ECONNRESET: Connection reset'
      });
    });

    it('should not log if no logger provided', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('done');

      const promise = retryWithBackoff(fn, { initialDelay: 10 });
      await vi.runAllTimersAsync();
      await promise;

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle async operations correctly', async () => {
      let callCount = 0;
      const fn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Socket timeout');
        }
        return { data: 'response' };
      });

      const promise = retryWithBackoff(fn, {
        logger,
        operation: 'http-request',
        initialDelay: 50
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ data: 'response' });
      expect(callCount).toBe(3);
    });

    it('should handle promise rejection patterns', async () => {
      const fn = () => Promise.reject(new Error('ECONNREFUSED'));

      const promise = retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 10,
        logger
      });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('ECONNREFUSED');
      expect(logger.logs.filter(l => l.level === 'warn')).toHaveLength(1);
      expect(logger.logs.filter(l => l.level === 'error')).toHaveLength(1);
    });
  });
});

describe('retryImmediate - REAL Immediate Retry', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  describe('Basic behavior', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('immediate');

      const result = await retryImmediate(fn);

      expect(result).toBe('immediate');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry immediately without delay', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const start = performance.now();
      const result = await retryImmediate(fn, 3);
      const duration = performance.now() - start;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(duration).toBeLessThan(50); // Should be nearly instant
    });

    it('should throw after max attempts', async () => {
      const error = new Error('Persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retryImmediate(fn, 3, logger)).rejects.toThrow('Persistent failure');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(logger.hasLog('debug', 'Operation failed after 3 immediate attempts')).toBe(true);
    });
  });

  describe('Use cases', () => {
    it('should handle race conditions', async () => {
      let attempt = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt < 2) {
          throw new Error('Resource locked');
        }
        return 'acquired';
      });

      const result = await retryImmediate(fn, 5);

      expect(result).toBe('acquired');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should work for quick file system operations', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockResolvedValue({ written: true });

      const result = await retryImmediate(fn);

      expect(result).toEqual({ written: true });
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should preserve error type', async () => {
      class CustomError extends Error {
        constructor(public code: string) {
          super(`Custom error: ${code}`);
        }
      }

      const fn = vi.fn().mockRejectedValue(new CustomError('ERR_001'));

      try {
        await retryImmediate(fn, 2);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CustomError);
        expect((error as CustomError).code).toBe('ERR_001');
      }
    });

    it('should handle non-Error rejections', async () => {
      const fn = vi.fn().mockRejectedValue('string rejection');

      await expect(retryImmediate(fn, 2)).rejects.toBe('string rejection');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Logging', () => {
    it('should log final failure with context', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));

      await expect(retryImmediate(fn, 2, logger)).rejects.toThrow();

      const debugLog = logger.logs.find(l => l.level === 'debug');
      expect(debugLog?.message).toContain('failed after 2 immediate attempts');
      expect(debugLog?.context?.error).toBe('Test error');
    });

    it('should not log on success', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Temporary'))
        .mockResolvedValue('ok');

      await retryImmediate(fn, 3, logger);

      expect(logger.logs).toHaveLength(0);
    });
  });
});

describe('Integration patterns', () => {
  it('should combine retryWithBackoff with Result type', async () => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

    async function operationWithRetry(): Promise<Result<string>> {
      try {
        const value = await retryWithBackoff(
          async () => {
            // Simulate flaky operation
            if (Math.random() > 0.5) {
              throw new Error('ECONNRESET');
            }
            return 'data';
          },
          { maxRetries: 5, initialDelay: 10 }
        );
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: error as Error };
      }
    }

    // Should eventually succeed or fail gracefully
    const result = await operationWithRetry();
    expect(result).toHaveProperty('ok');
  });

  it('should work with database operations', async () => {
    const logger = new TestLogger();
    let dbLocked = true;

    async function queryDatabase(): Promise<any> {
      if (dbLocked) {
        dbLocked = false;
        throw new Error('SQLITE_BUSY: database is locked');
      }
      return { rows: [] };
    }

    const result = await retryWithBackoff(queryDatabase, {
      logger,
      operation: 'db-query',
      initialDelay: 10,
      isRetryable: (error) => {
        return error instanceof Error &&
               error.message.includes('SQLITE_BUSY');
      }
    });

    expect(result).toEqual({ rows: [] });
    expect(logger.hasLog('info', 'db-query succeeded after 1 retries')).toBe(true);
  });

  it('should handle GitHub API rate limiting', async () => {
    const logger = new TestLogger();
    let rateLimited = 2;

    async function callGitHubAPI(): Promise<any> {
      if (rateLimited > 0) {
        rateLimited--;
        const error = new Error('API rate limit exceeded');
        throw error;
      }
      return { status: 'success' };
    }

    vi.useFakeTimers();

    const promise = retryWithBackoff(callGitHubAPI, {
      logger,
      operation: 'github-api',
      initialDelay: 1000,
      backoffMultiplier: 2
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ status: 'success' });
    expect(logger.logs.filter(l => l.level === 'warn')).toHaveLength(2);

    vi.useRealTimers();
  });
});

describe('Performance characteristics', () => {
  it('should handle many concurrent retries', async () => {
    const operations = Array.from({ length: 100 }, (_, i) => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error(`Error ${i}`))
        .mockResolvedValue(`Result ${i}`);

      return retryImmediate(fn, 3);
    });

    const results = await Promise.all(operations);

    expect(results).toHaveLength(100);
    expect(results[0]).toBe('Result 0');
    expect(results[99]).toBe('Result 99');
  });

  it('should not leak memory with many retries', async () => {
    const fn = vi.fn();
    for (let i = 0; i < 50; i++) {
      fn.mockRejectedValueOnce(new Error('Transient'));
    }
    fn.mockResolvedValue('finally');

    vi.useFakeTimers();

    const promise = retryWithBackoff(fn, {
      maxRetries: 51,
      initialDelay: 1,
      backoffMultiplier: 1
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(51);

    vi.useRealTimers();
  });
});