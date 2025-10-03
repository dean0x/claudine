import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  retryWithBackoff,
  retryImmediate,
  isRetryableError,
  type RetryOptions
} from '../../../src/utils/retry';
import { TestLogger } from '../../../src/implementations/logger';
import { TIMEOUTS, RETRY_CONFIG } from '../../constants';
import { INVALID_INPUTS, createNonError, RetryTestFunction, createMockFunction } from '../../fixtures/test-helpers';

describe('isRetryableError - Error Classification', () => {
  // Data-driven tests for retryable errors
  const retryableErrorCases = [
    // Network errors
    ['ECONNREFUSED: Connection refused', 'connection refused'],
    ['ECONNRESET: Connection reset by peer', 'connection reset'],
    ['ETIMEDOUT: Connection timed out', 'timeout'],
    ['Operation timed out', 'timeout'],
    ['Connection timed out after 30000ms', 'timeout'],
    ['ENOTFOUND: getaddrinfo ENOTFOUND api.github.com', 'DNS error'],
    ['Network error occurred', 'network error'],
    ['Socket timeout', 'socket error'],
    ['Socket connection failed', 'socket error'],
    // Git remote errors
    ['Could not read from remote repository', 'git remote error'],
    ['Unable to access https://github.com/repo.git', 'git access error'],
    ['SSL certificate problem: unable to verify', 'SSL/TLS error'],
    ['TLS handshake failed', 'SSL/TLS error'],
    // Rate limiting
    ['API rate limit exceeded', 'rate limit'],
    ['Rate limit reached', 'rate limit'],
    ['Too many requests, please retry later', 'rate limit'],
    // File system race conditions
    ['EBUSY: resource busy or locked', 'resource busy'],
    ['File is locked by another process', 'resource locked'],
    ['Resource busy', 'resource busy']
  ];

  // Data-driven tests for non-retryable errors
  const nonRetryableErrorCases = [
    ['Authentication failed', 'authentication'],
    ['Invalid authentication credentials', 'authentication'],
    ['Not authorized to perform this action', 'authorization'],
    ['Permission denied', 'permission'],
    ['Invalid input provided', 'validation'],
    ['Validation failed: name is required', 'validation'],
    ['Merge conflict detected', 'conflict'],
    ['Resource already exists', 'conflict'],
    ['Some random error', 'unknown'],
    ['Unexpected failure', 'unknown'],
    ['Internal error', 'unknown']
  ];

  it.each(retryableErrorCases)(
    'should classify "%s" as retryable (%s)',
    (errorMessage, category) => {
      expect(isRetryableError(new Error(errorMessage))).toBe(true);
    }
  );

  it.each(nonRetryableErrorCases)(
    'should classify "%s" as non-retryable (%s)',
    (errorMessage, category) => {
      expect(isRetryableError(new Error(errorMessage))).toBe(false);
    }
  );

  it('should return false for non-Error objects', () => {
    // Test with properly typed non-Error values
    expect(isRetryableError(createNonError('null') as Error)).toBe(false);
    expect(isRetryableError(createNonError('undefined') as Error)).toBe(false);
    expect(isRetryableError(createNonError('string') as Error)).toBe(false);
    expect(isRetryableError(createNonError('object') as Error)).toBe(false);

    // Additional edge cases
    expect(isRetryableError(createNonError('number') as Error)).toBe(false);
  });

  it('should handle case insensitive matching', () => {
    const errors = [
      new Error('ECONNREFUSED: connection refused'),
      new Error('econnrefused: Connection Refused'),
      new Error('Rate Limit Exceeded'),
      new Error('RATE limit exceeded')
    ];

    errors.forEach(error => {
      expect(isRetryableError(error)).toBe(true);
    });
  });
});

describe('retryWithBackoff - Exponential Backoff Strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return immediately on first success', async () => {
    const testFn = new RetryTestFunction<string>()
      .willSucceedWith('success');

    const resultPromise = retryWithBackoff(testFn.fn, { maxRetries: 3 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success');
    expect(testFn.wasCalledTimes(1)).toBe(true);
  });

  it('should retry with exponential backoff on failure', async () => {
    const testFn = new RetryTestFunction<string>()
      .willFailTimes(2, 'ECONNREFUSED')
      .willSucceedWith('success');

    const resultPromise = retryWithBackoff(testFn.fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success');
    expect(testFn.wasCalledTimes(3)).toBe(true);
  });

  it('should respect custom backoff settings', async () => {
    const testFn = new RetryTestFunction<string>()
      .willFailWith('ETIMEDOUT')
      .willSucceedWith('success');

    const options: RetryOptions = {
      initialDelay: 200,
      multiplier: 3,
      maxDelay: TIMEOUTS.MEDIUM
    };

    const resultPromise = retryWithBackoff(testFn.fn, options);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(testFn.wasCalledTimes(2)).toBe(true);
  });

  it('should cap delay at maxDelay', async () => {
    const delays: number[] = [];
    let lastCallTime = Date.now();

    const trackingFn = createMockFunction(async () => {
      const now = Date.now();
      delays.push(now - lastCallTime);
      lastCallTime = now;
      throw new Error('ECONNRESET');
    });

    const options: RetryOptions = {
      initialDelay: 100,
      multiplier: 10,
      maxDelay: 500,
      maxRetries: 3
    };

    const resultPromise = retryWithBackoff(trackingFn, options);

    // Run timers and await rejection together to avoid unhandled promises
    const [rejection] = await Promise.allSettled([
      resultPromise,
      vi.runAllTimersAsync()
    ]);

    expect(rejection.status).toBe('rejected');
    if (rejection.status === 'rejected') {
      expect(rejection.reason.message).toContain('ECONNRESET');
    }

    // Check actual call count
    expect(trackingFn.wasCalledTimes(4)).toBe(true); // Initial + 3 retries

    // Verify delays are capped
    const retryDelays = delays.slice(1); // Skip first (no delay)
    if (retryDelays.length > 0) {
      expect(Math.max(...retryDelays)).toBeLessThanOrEqual(500);
    }
  });

  it('should throw after max retries', async () => {
    const testFn = new RetryTestFunction()
      .willFailTimes(10, 'ECONNREFUSED'); // Always fails

    const resultPromise = retryWithBackoff(testFn.fn, { maxRetries: 2 });

    // Run timers and await rejection together
    const [rejection] = await Promise.allSettled([
      resultPromise,
      vi.runAllTimersAsync()
    ]);

    expect(rejection.status).toBe('rejected');
    if (rejection.status === 'rejected') {
      expect(rejection.reason.message).toContain('ECONNREFUSED');
    }

    // Check actual call count
    expect(testFn.calls).toBe(3); // Initial + 2 retries
  });

  it('should not retry non-retryable errors', async () => {
    const testFn = new RetryTestFunction()
      .willFailWith('Authentication failed');

    const resultPromise = retryWithBackoff(testFn.fn);

    // Run timers and await rejection together
    const [rejection] = await Promise.allSettled([
      resultPromise,
      vi.runAllTimersAsync()
    ]);

    expect(rejection.status).toBe('rejected');
    if (rejection.status === 'rejected') {
      expect(rejection.reason.message).toContain('Authentication failed');
    }

    expect(testFn.wasCalledTimes(1)).toBe(true);
  });

  it('should use custom isRetryable function', async () => {
    const customRetryable = (err: Error) => err.message.includes('custom');
    const testFn = new RetryTestFunction<string>()
      .willFailWith('custom error')
      .willFailWith('custom error')
      .willSucceedWith('success');

    const resultPromise = retryWithBackoff(testFn.fn, {
      isRetryable: customRetryable,
      maxRetries: 3
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success');
    expect(testFn.wasCalledTimes(3)).toBe(true);
  });

  it('should log retry attempts with context', async () => {
    const logger = new TestLogger();
    const testFn = new RetryTestFunction<string>()
      .willFailWith('ECONNREFUSED')
      .willSucceedWith('success');

    const resultPromise = retryWithBackoff(testFn.fn, {
      logger,
      operation: 'test-operation'
    });

    await vi.runAllTimersAsync();
    await resultPromise;

    const logs = logger.logs;
    // Check if any retry-related logs exist
    const hasRetryLogs = logs.length > 0;
    expect(hasRetryLogs).toBe(true);

    // Find retry log - should contain the operation name in the message
    const retryLog = logs.find(l =>
      l.message.includes('test-operation') &&
      l.message.toLowerCase().includes('retry')
    );

    expect(retryLog).toBeDefined();
    if (retryLog) {
      // The context should have attempt, maxRetries, and error info
      expect(retryLog.context?.attempt).toBe(1);
      expect(retryLog.context?.error).toBe('ECONNREFUSED');
    }
    // At minimum, verify the function was called with context
    expect(testFn.wasCalledTimes(2)).toBe(true);
  });

  it('should handle async operations correctly', async () => {
    let callCount = 0;
    const asyncOperation = async () => {
      callCount++;
      await new Promise(resolve => setTimeout(resolve, 10));
      if (callCount < 3) {
        throw new Error('ECONNREFUSED');
      }
      return `success after ${callCount} attempts`;
    };

    const resultPromise = retryWithBackoff(asyncOperation);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success after 3 attempts');
    expect(callCount).toBe(3);
  });
});

describe('retryImmediate - Fast Retry Strategy', () => {
  it('should succeed on first attempt', async () => {
    const testFn = new RetryTestFunction<string>()
      .willSucceedWith('success');

    const result = await retryImmediate(testFn.fn);

    expect(result).toBe('success');
    expect(testFn.wasCalledTimes(1)).toBe(true);
  });

  it('should retry immediately without delay', async () => {
    const testFn = new RetryTestFunction<string>()
      .willFailTimes(2, 'Failed')
      .willSucceedWith('success');

    const start = Date.now();
    const result = await retryImmediate(testFn.fn, 5);
    const duration = Date.now() - start;

    expect(result).toBe('success');
    expect(testFn.wasCalledTimes(3)).toBe(true);
    expect(duration).toBeLessThan(100); // Should be nearly instant
  });

  it('should throw after max attempts', async () => {
    const testFn = new RetryTestFunction()
      .willFailTimes(10, 'Failed');

    await expect(retryImmediate(testFn.fn, 3)).rejects.toThrow('Failed');
    expect(testFn.wasCalledTimes(3)).toBe(true);
  });

  it('should work for quick file system operations', async () => {
    const testFn = new RetryTestFunction<{ data: string }>()
      .willFailWith('EBUSY')
      .willSucceedWith({ data: 'file content' });

    const result = await retryImmediate(testFn.fn);

    expect(result).toEqual({ data: 'file content' });
    expect(testFn.wasCalledTimes(2)).toBe(true);
  });
});

describe('Integration with Result type', () => {
  it('should combine retryWithBackoff with Result type', async () => {
    const { ok, err } = await import('../../../src/core/result');

    let attempt = 0;
    const operation = async () => {
      attempt++;
      if (attempt < 3) {
        return err(new Error('ECONNREFUSED'));
      }
      return ok({ data: 'success' });
    };

    const retryOperation = async () => {
      const result = await operation();
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    };

    const finalResult = await retryWithBackoff(retryOperation);

    expect(finalResult).toEqual({ data: 'success' });
    expect(attempt).toBe(3);
  });
});

describe('Real-world scenarios', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle GitHub API rate limiting', async () => {
    const testFn = new RetryTestFunction<{ data: string }>()
      .willFailWith('API rate limit exceeded')
      .willFailWith('Rate limit exceeded')
      .willSucceedWith({ data: 'api response' });

    const resultPromise = retryWithBackoff(testFn.fn, {
      initialDelay: RETRY_CONFIG.BASE_DELAY,
      maxRetries: 5
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ data: 'api response' });
    expect(testFn.wasCalledTimes(3)).toBe(true);
  });

  it('should handle database connection issues', async () => {
    const testFn = new RetryTestFunction<{ connected: boolean }>()
      .willFailWith('ECONNREFUSED: Connection refused to localhost:5432')
      .willSucceedWith({ connected: true });

    const resultPromise = retryWithBackoff(testFn.fn, {
      initialDelay: 100,
      maxRetries: 10
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ connected: true });
    expect(testFn.wasCalledTimes(2)).toBe(true);
  });

  it('should handle concurrent retries efficiently', async () => {
    const testFunctions = Array.from({ length: 5 }, (_, i) => {
      return new RetryTestFunction<string>()
        .willFailWith('ECONNREFUSED')
        .willSucceedWith(`success-${i}`);
    });

    const promises = testFunctions.map(tf =>
      retryWithBackoff(tf.fn, { initialDelay: 50, maxRetries: 2 })
    );

    await vi.runAllTimersAsync();
    const results = await Promise.all(promises);

    expect(results).toEqual(['success-0', 'success-1', 'success-2', 'success-3', 'success-4']);
    testFunctions.forEach(tf => expect(tf.wasCalledTimes(2)).toBe(true));
  });
});