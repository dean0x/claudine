/**
 * Tests for EventBus request-response pattern
 * Validates correlation-based thread-safe implementation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryEventBus } from '../../../../src/core/events/event-bus.js';
import { Logger } from '../../../../src/core/interfaces.js';
import { ClaudineError, ErrorCode } from '../../../../src/core/errors.js';
import { TestLogger } from '../../../fixtures/test-doubles.js';
import { TIMEOUTS, TEST_COUNTS } from '../../../constants.js';

describe('EventBus Request-Response Pattern', () => {
  let eventBus: InMemoryEventBus;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new TestLogger();
    eventBus = new InMemoryEventBus(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Request-Response', () => {
    it('should successfully complete request-response cycle', async () => {
      // Set up handler that responds
      eventBus.subscribe('TestQuery', async (event: any) => {
        if (event.__correlationId) {
          eventBus.respond(event.__correlationId, { result: 'success' });
        }
      });

      const result = await eventBus.request('TestQuery', { data: 'test' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ result: 'success' });
      }
    });

    it('should handle error responses', async () => {
      // Set up handler that responds with error
      eventBus.subscribe('TestQuery', async (event: any) => {
        if (event.__correlationId) {
          eventBus.respondError(
            event.__correlationId,
            new ClaudineError(ErrorCode.SYSTEM_ERROR, 'Test error')
          );
        }
      });

      const result = await eventBus.request('TestQuery', { data: 'test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.SYSTEM_ERROR);
        expect(result.error.message).toBe('Test error');
      }
    });

    it('should timeout when no response received', async () => {
      // Set up handler that never responds
      eventBus.subscribe('TestQuery', async () => {
        // Do nothing - simulate hanging handler
      });

      const result = await eventBus.request(
        'TestQuery',
        { data: 'test' },
        100 // 100ms timeout
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('timeout');
        expect(result.error.message).toContain('100ms');
      }
    });

    it('should return error when no handlers registered', async () => {
      const result = await eventBus.request('UnhandledQuery', { data: 'test' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No handlers registered');
        expect(result.error.message).toContain('UnhandledQuery');
      }
    });
  });

  describe('Correlation ID Management', () => {
    it('should generate unique correlation IDs for each request', async () => {
      const correlationIds = new Set<string>();

      eventBus.subscribe('TestQuery', async (event: any) => {
        correlationIds.add(event.__correlationId);
        eventBus.respond(event.__correlationId, 'ok');
      });

      // Make multiple requests
      await Promise.all([
        eventBus.request('TestQuery', {}),
        eventBus.request('TestQuery', {}),
        eventBus.request('TestQuery', {})
      ]);

      // Should have 3 unique correlation IDs
      expect(correlationIds.size).toBe(3);
    });

    it('should clean up pending requests after response', async () => {
      eventBus.subscribe('TestQuery', async (event: any) => {
        eventBus.respond(event.__correlationId, 'done');
      });

      await eventBus.request('TestQuery', {});

      // Check internal state is cleaned up
      expect((eventBus as { pendingRequests: Map<any, any> }).pendingRequests.size).toBe(0);
    });

    it('should clean up pending requests after error', async () => {
      eventBus.subscribe('TestQuery', async (event: any) => {
        eventBus.respondError(event.__correlationId, new Error('failed'));
      });

      await eventBus.request('TestQuery', {});

      // Check internal state is cleaned up
      expect((eventBus as { pendingRequests: Map<any, any> }).pendingRequests.size).toBe(0);
    });

    it('should clean up pending requests after timeout', async () => {
      vi.useFakeTimers();

      eventBus.subscribe('TestQuery', async () => {
        // Never respond
      });

      const requestPromise = eventBus.request('TestQuery', {}, 50);
      await vi.runAllTimersAsync();
      await requestPromise;

      // Wait a bit to ensure cleanup happens
      await vi.runAllTimersAsync();

      // Check internal state is cleaned up
      expect((eventBus as { pendingRequests: Map<any, any> }).pendingRequests.size).toBe(0);

      vi.useRealTimers();
    });

    it('should ignore responses for unknown correlation IDs', () => {
      // Should not throw
      expect(() => {
        eventBus.respond('unknown-id', 'data');
        eventBus.respondError('unknown-id', new Error('error'));
      }).not.toThrow();
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent requests correctly', async () => {
      vi.useFakeTimers();
      const responses: number[] = [];

      eventBus.subscribe('TestQuery', async (event: any) => {
        const value = event.value;
        // Simulate async work with random delay
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        eventBus.respond(event.__correlationId, value * 2);
      });

      // Make concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        eventBus.request('TestQuery', { value: i })
      );

      await vi.runAllTimersAsync();
      const results = await Promise.all(promises);

      // Verify all succeeded and got correct responses
      results.forEach((result, i) => {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(i * 2);
        }
      });

      vi.useRealTimers();
    });

    it('should handle mixed success and failure responses', async () => {
      eventBus.subscribe('TestQuery', async (event: any) => {
        const value = event.value;
        if (value % 2 === 0) {
          eventBus.respond(event.__correlationId, `success-${value}`);
        } else {
          eventBus.respondError(
            event.__correlationId,
            new Error(`error-${value}`)
          );
        }
      });

      const promises = Array.from({ length: 6 }, (_, i) =>
        eventBus.request('TestQuery', { value: i })
      );

      const results = await Promise.all(promises);

      // Even numbers should succeed
      expect(results[0].ok).toBe(true);
      expect(results[2].ok).toBe(true);
      expect(results[4].ok).toBe(true);

      // Odd numbers should fail
      expect(results[1].ok).toBe(false);
      expect(results[3].ok).toBe(false);
      expect(results[5].ok).toBe(false);

      if (results[0].ok) {
        expect(results[0].value).toBe('success-0');
      }
      if (!results[1].ok) {
        expect(results[1].error.message).toContain('error-1');
      }
    });

    it('should handle requests with different timeouts', async () => {
      vi.useFakeTimers();
      let handlerCallCount = 0;

      eventBus.subscribe('TestQuery', async (event: any) => {
        handlerCallCount++;
        const delay = event.delay;
        await new Promise(resolve => setTimeout(resolve, delay));
        eventBus.respond(event.__correlationId, 'completed');
      });

      const promises = [
        eventBus.request('TestQuery', { delay: 10 }, TIMEOUTS.MEDIUM),  // Fast response, long timeout
        eventBus.request('TestQuery', { delay: 200 }, 50)    // Slow response, short timeout
      ];

      await vi.runAllTimersAsync();
      const [fast, slow] = await Promise.all(promises);

      expect(fast.ok).toBe(true); // Should succeed
      expect(slow.ok).toBe(false); // Should timeout
      expect(handlerCallCount).toBe(2); // Both handlers called

      vi.useRealTimers();
    });
  });

  describe('Handler Execution', () => {
    it('should execute first handler only for requests', async () => {
      let handler1Called = false;
      let handler2Called = false;

      eventBus.subscribe('TestQuery', async (event: any) => {
        handler1Called = true;
        eventBus.respond(event.__correlationId, 'handler1');
      });

      eventBus.subscribe('TestQuery', async (event: any) => {
        handler2Called = true;
        eventBus.respond(event.__correlationId, 'handler2');
      });

      const result = await eventBus.request('TestQuery', {});

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(false);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('handler1');
      }
    });

    it('should handle handler exceptions gracefully', async () => {
      eventBus.subscribe('TestQuery', async () => {
        throw new Error('Handler crashed');
      });

      const result = await eventBus.request('TestQuery', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Handler crashed');
      }
    });

    it('should handle async handler errors', async () => {
      vi.useFakeTimers();

      eventBus.subscribe('TestQuery', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Async error');
      });

      const resultPromise = eventBus.request('TestQuery', {});
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Async error');
      }

      vi.useRealTimers();
    });

    it('should convert non-Error throws to ClaudineError', async () => {
      eventBus.subscribe('TestQuery', async () => {
        throw 'string error';
      });

      const result = await eventBus.request('TestQuery', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ClaudineError);
        expect(result.error.message).toContain('string error');
      }
    });
  });

  describe('Custom Timeouts', () => {
    it('should respect custom timeout values', async () => {
      vi.useFakeTimers();

      eventBus.subscribe('TestQuery', async (event: any) => {
        await new Promise(resolve => setTimeout(resolve, 150));
        eventBus.respond(event.__correlationId, 'done');
      });

      // Should timeout with 100ms
      const shortPromise = eventBus.request('TestQuery', {}, 100);
      await vi.runAllTimersAsync();
      const shortResult = await shortPromise;
      expect(shortResult.ok).toBe(false);

      // Should succeed with 200ms
      const longPromise = eventBus.request('TestQuery', {}, 200);
      await vi.runAllTimersAsync();
      const longResult = await longPromise;
      expect(longResult.ok).toBe(true);

      vi.useRealTimers();
    });

    it('should use default timeout when not specified', async () => {
      const startTime = Date.now();

      eventBus.subscribe('TestQuery', async () => {
        // Never respond
      });

      await eventBus.request('TestQuery', {}); // Uses default 5000ms

      const elapsed = Date.now() - startTime;

      // Should timeout around 5000ms (allow some margin)
      expect(elapsed).toBeGreaterThanOrEqual(4900);
      expect(elapsed).toBeLessThan(5200);
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory with many requests', async () => {
      eventBus.subscribe('TestQuery', async (event: any) => {
        eventBus.respond(event.__correlationId, 'ok');
      });

      // Make many requests
      for (let i = 0; i < TEST_COUNTS.STRESS_TEST; i++) {
        await eventBus.request('TestQuery', { index: i });
      }

      // All should be cleaned up
      expect((eventBus as { pendingRequests: Map<any, any> }).pendingRequests.size).toBe(0);
    });

    it('should handle rapid fire requests', async () => {
      let responseCount = 0;

      eventBus.subscribe('TestQuery', async (event: any) => {
        responseCount++;
        // Immediate response
        eventBus.respond(event.__correlationId, responseCount);
      });

      // Fire requests without waiting
      const promises = Array.from({ length: 100 }, () =>
        eventBus.request('TestQuery', {})
      );

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every(r => r.ok)).toBe(true);
      expect(responseCount).toBe(100);
    });
  });
});