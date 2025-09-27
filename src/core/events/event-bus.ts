/**
 * Event bus implementation for coordinating system events
 * Provides pub/sub pattern for loosely coupled components
 */

import { Result, ok, err } from '../result.js';
import { ClaudineError, ErrorCode } from '../errors.js';
import { Logger } from '../interfaces.js';
import { ClaudineEvent, EventHandler, createEvent, BaseEvent } from './events.js';

/**
 * Event bus interface for dependency injection
 *
 * ARCHITECTURE: Supports both fire-and-forget (emit) and request-response (request) patterns
 * for pure event-driven architecture. All service operations go through this bus.
 */
export interface EventBus {
  emit<T extends ClaudineEvent>(type: T['type'], payload: Omit<T, keyof BaseEvent | 'type'>): Promise<Result<void>>;
  request<T extends ClaudineEvent, R = unknown>(type: T['type'], payload: Omit<T, keyof BaseEvent | 'type'>): Promise<Result<R>>;
  subscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<string>;
  unsubscribe(subscriptionId: string): Result<void>;
  subscribeAll(handler: EventHandler): Result<string>;
  unsubscribeAll(): void;
  dispose?(): void; // Optional cleanup method

  // Additional convenience methods for testing compatibility
  on?(event: string, handler: (data: any) => void): string;
  off?(event: string, subscriptionId: string): void;
  once?(event: string, handler: (data: any) => void): void;
  onRequest?(event: string, handler: (data: any) => Promise<Result<any>>): string;
}

/**
 * Pending request tracking with proper typing
 */
interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  timestamp: number;
  resolved: boolean;
}

/**
 * In-memory event bus implementation
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly globalHandlers: EventHandler[] = [];
  private readonly subscriptions = new Map<string, { eventType?: string; handler: EventHandler; isGlobal: boolean }>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private subscriptionCounter = 0;
  private cleanupInterval?: NodeJS.Timeout;
  private readonly maxRequestAge = 60000; // 1 minute max age for stale requests
  private readonly maxListenersPerEvent: number;
  private readonly maxTotalSubscriptions: number;

  constructor(
    private readonly logger: Logger,
    maxListenersPerEvent = 100, // ARCHITECTURE: Configurable limit to prevent memory leaks
    maxTotalSubscriptions = 1000 // ARCHITECTURE: Configurable global subscription limit
  ) {
    this.maxListenersPerEvent = maxListenersPerEvent;
    this.maxTotalSubscriptions = maxTotalSubscriptions;
    // Start cleanup interval to prevent memory leaks
    this.startCleanupInterval();
  }

  /**
   * Start periodic cleanup of stale pending requests
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleRequests();
    }, 30000); // Clean up every 30 seconds
  }

  /**
   * Clean up stale pending requests to prevent memory leaks
   */
  private cleanupStaleRequests(): void {
    const now = Date.now();
    const staleRequests: string[] = [];

    for (const [id, request] of this.pendingRequests) {
      if (now - request.timestamp > this.maxRequestAge) {
        staleRequests.push(id);
      }
    }

    for (const id of staleRequests) {
      const request = this.pendingRequests.get(id);
      if (request) {
        clearTimeout(request.timeoutId);
        this.pendingRequests.delete(id);
        this.logger.warn('Cleaned up stale request', { correlationId: id, age: now - request.timestamp });
      }
    }
  }

  /**
   * Clean up resources when shutting down
   * ARCHITECTURE: Complete cleanup to prevent memory leaks in tests
   */
  public dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Clear all pending requests
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeoutId);
    }
    this.pendingRequests.clear();

    // CRITICAL: Clear all event handlers to prevent memory leaks
    this.handlers.clear();
    this.globalHandlers.length = 0;
    this.subscriptions.clear();
    this.subscriptionCounter = 0;

    this.logger.debug('EventBus disposed', {
      handlersCleared: true,
      subscriptionsCleared: true,
      pendingRequestsCleared: true
    });
  }

  async emit<T extends ClaudineEvent>(
    type: T['type'], 
    payload: Omit<T, keyof BaseEvent | 'type'>
  ): Promise<Result<void>> {
    const event = createEvent(type, payload) as T;
    
    this.logger.debug('Event emitted', {
      eventType: event.type,
      eventId: event.eventId,
      timestamp: event.timestamp
    });

    try {
      // Get specific handlers for this event type
      const specificHandlers = this.handlers.get(type) || [];

      // Combine with global handlers
      const allHandlers = [...specificHandlers, ...this.globalHandlers];

      // Log if no subscribers
      if (allHandlers.length === 0) {
        this.logger.debug('No subscribers for event type', { eventType: type });
      }

      // Execute all handlers in parallel
      const results = await Promise.allSettled(
        allHandlers.map(handler => handler(event))
      );

      // Check for handler failures
      const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
      
      if (failures.length > 0) {
        this.logger.error('Event handler failures', undefined, {
          eventType: type,
          eventId: event.eventId,
          failures: failures.map(f => f.reason)
        });

        // Return error if any handler failed
        return err(new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Event handler failures for ${type}: ${failures.map(f => f.reason).join(', ')}`,
          { eventId: event.eventId, failures: failures.length }
        ));
      }

      return ok(undefined);
    } catch (error) {
      this.logger.error('Event emission failed', error as Error, {
        eventType: type,
        eventId: event.eventId
      });

      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Event emission failed for ${type}: ${error}`,
        { eventId: event.eventId }
      ));
    }
  }

  /**
   * Request-response pattern for query events with proper correlation
   * ARCHITECTURE: Thread-safe implementation using correlation IDs and promises
   * Includes automatic timeout (default 5s) to prevent hanging queries
   */
  async request<T extends ClaudineEvent, R = any>(
    type: T['type'],
    payload: Omit<T, keyof BaseEvent | 'type'>,
    timeoutMs: number = 5000
  ): Promise<Result<R>> {
    const correlationId = crypto.randomUUID();

    return new Promise<Result<R>>((resolve) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
          this.pendingRequests.delete(correlationId);
          this.logger.error('Request timeout', undefined, {
            eventType: type,
            correlationId,
            timeoutMs
          });
          resolve(err(new ClaudineError(
            ErrorCode.SYSTEM_ERROR,
            `Request timeout after ${timeoutMs}ms for ${type}`
          )));
        }
      }, timeoutMs);

      // Store pending request with timestamp and resolved flag
      const pendingRequest: PendingRequest<R> = {
        resolve: (value: R) => {
          if (!pendingRequest.resolved) {
            pendingRequest.resolved = true;
            clearTimeout(timeoutId);
            this.pendingRequests.delete(correlationId);
            resolve(ok(value));
          }
        },
        reject: (error: Error) => {
          if (!pendingRequest.resolved) {
            pendingRequest.resolved = true;
            clearTimeout(timeoutId);
            this.pendingRequests.delete(correlationId);
            resolve(err(error instanceof ClaudineError ? error : new ClaudineError(
              ErrorCode.SYSTEM_ERROR,
              error.message
            )));
          }
        },
        timeoutId,
        timestamp: Date.now(),
        resolved: false
      };

      this.pendingRequests.set(correlationId, pendingRequest as PendingRequest);

      // Emit event with correlation ID
      const event = createEvent(type, {
        ...payload,
        __correlationId: correlationId
      } as any) as T;

      this.logger.debug('Request event emitted', {
        eventType: event.type,
        eventId: event.eventId,
        correlationId
      });

      // Get handlers for this event type
      const handlers = this.handlers.get(type) || [];

      if (handlers.length === 0) {
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
          pending.reject(new ClaudineError(
            ErrorCode.SYSTEM_ERROR,
            `No handlers registered for query: ${type}`
          ));
        }
        return;
      }

      // Execute handler asynchronously
      handlers[0](event).catch((error) => {
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  /**
   * Respond to a request with a correlation ID
   * Used by handlers to send responses back to request callers
   * @template T The response type
   * @param correlationId The correlation ID of the request
   * @param response The response value
   * @returns true if response was sent, false if already resolved or not found
   */
  respond<T = unknown>(correlationId: string, response: T): boolean {
    const pending = this.pendingRequests.get(correlationId);
    if (pending && !pending.resolved) {
      pending.resolve(response);
      return true;
    }

    if (pending?.resolved) {
      this.logger.warn('Attempted to respond to already resolved request', { correlationId });
    }

    return false;
  }

  /**
   * Respond to a request with an error
   * Used by handlers to send errors back to request callers
   * @param correlationId The correlation ID of the request
   * @param error The error to send
   * @returns true if error was sent, false if already resolved or not found
   */
  respondError(correlationId: string, error: Error): boolean {
    const pending = this.pendingRequests.get(correlationId);
    if (pending && !pending.resolved) {
      pending.reject(error);
      return true;
    }

    if (pending?.resolved) {
      this.logger.warn('Attempted to reject already resolved request', { correlationId });
    }

    return false;
  }

  subscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<string> {
    // Check global subscription limit
    if (this.subscriptions.size >= this.maxTotalSubscriptions) {
      this.logger.error('Maximum total subscriptions reached', undefined, {
        limit: this.maxTotalSubscriptions,
        current: this.subscriptions.size
      });
      return err(new ClaudineError(
        ErrorCode.RESOURCE_LIMIT_EXCEEDED,
        `Maximum subscription limit (${this.maxTotalSubscriptions}) reached`
      ));
    }

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    const handlers = this.handlers.get(eventType)!;

    // Check per-event listener limit (warn only, don't fail)
    if (handlers.length >= this.maxListenersPerEvent) {
      this.logger.warn('Maximum listeners per event approaching limit', {
        eventType,
        limit: this.maxListenersPerEvent,
        current: handlers.length
      });
    }

    handlers.push(handler as EventHandler);

    // Generate subscription ID
    const subscriptionId = `sub-${++this.subscriptionCounter}`;
    this.subscriptions.set(subscriptionId, {
      eventType,
      handler: handler as EventHandler,
      isGlobal: false
    });

    this.logger.debug('Event handler subscribed', {
      eventType,
      subscriptionId,
      handlerCount: handlers.length
    });

    return ok(subscriptionId);
  }

  unsubscribe(subscriptionId: string): Result<void> {
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Subscription not found: ${subscriptionId}`
      ));
    }

    // Remove from subscriptions map
    this.subscriptions.delete(subscriptionId);

    // Remove handler from appropriate list
    if (subscription.isGlobal) {
      const index = this.globalHandlers.indexOf(subscription.handler);
      if (index !== -1) {
        this.globalHandlers.splice(index, 1);
      }
    } else if (subscription.eventType) {
      const handlers = this.handlers.get(subscription.eventType);
      if (handlers) {
        const index = handlers.indexOf(subscription.handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    }

    this.logger.debug('Handler unsubscribed', {
      subscriptionId,
      eventType: subscription.eventType || 'global',
      isGlobal: subscription.isGlobal
    });

    return ok(undefined);
  }

  subscribeAll(handler: EventHandler): Result<string> {
    this.globalHandlers.push(handler);

    // Generate subscription ID for global handler
    const subscriptionId = `global-${++this.subscriptionCounter}`;
    this.subscriptions.set(subscriptionId, {
      handler,
      isGlobal: true
    });

    this.logger.debug('Global event handler subscribed', {
      subscriptionId,
      globalHandlerCount: this.globalHandlers.length
    });

    return ok(subscriptionId);
  }

  unsubscribeAll(): void {
    // Clear all handlers
    this.handlers.clear();
    this.globalHandlers.length = 0;
    this.subscriptions.clear();

    this.logger.debug('All handlers unsubscribed');
  }

  /**
   * Get current subscription statistics
   */
  getStats(): { eventTypes: number; totalHandlers: number; globalHandlers: number } {
    const totalHandlers = Array.from(this.handlers.values())
      .reduce((sum, handlers) => sum + handlers.length, 0);

    return {
      eventTypes: this.handlers.size,
      totalHandlers,
      globalHandlers: this.globalHandlers.length
    };
  }

  /**
   * Convenience method for testing - similar to Node's EventEmitter
   */
  on(event: string, handler: (data: any) => void): string {
    const wrappedHandler: EventHandler = async (evt) => {
      handler(evt);
    };
    const result = this.subscribe(event as any, wrappedHandler);
    return result.ok ? result.value : '';
  }

  /**
   * Convenience method for testing - unsubscribe by event and subscription ID
   */
  off(event: string, subscriptionId: string): void {
    this.unsubscribe(subscriptionId);
  }

  /**
   * Convenience method for testing - one-time event listener
   */
  once(event: string, handler: (data: any) => void): void {
    const subscriptionId = this.on(event, (data) => {
      handler(data);
      this.unsubscribe(subscriptionId);
    });
  }

  /**
   * Convenience method for testing - handle request/response pattern
   */
  onRequest(event: string, handler: (data: any) => Promise<Result<any>>): string {
    const wrappedHandler: EventHandler = async (evt: any) => {
      const correlationId = evt.__correlationId || evt.correlationId;
      if (!correlationId) return;

      try {
        const result = await handler(evt);
        if (this.pendingRequests.has(correlationId)) {
          this.respond(correlationId, result.ok ? result.value : undefined);
        }
      } catch (error) {
        if (this.pendingRequests.has(correlationId)) {
          this.respondError(correlationId, error as Error);
        }
      }
    };
    const result = this.subscribe(event as any, wrappedHandler);
    return result.ok ? result.value : '';
  }
}

/**
 * Null event bus for testing - events are emitted but not processed
 */
export class NullEventBus implements EventBus {
  private subscriptionCounter = 0;

  async emit<T extends ClaudineEvent>(): Promise<Result<void>> {
    return ok(undefined);
  }

  async request<T extends ClaudineEvent, R = unknown>(): Promise<Result<R>> {
    return ok(undefined as R);
  }

  subscribe<T extends ClaudineEvent>(): Result<string> {
    return ok(`null-sub-${++this.subscriptionCounter}`);
  }

  unsubscribe(subscriptionId: string): Result<void> {
    return ok(undefined);
  }

  subscribeAll(): Result<string> {
    return ok(`null-global-${++this.subscriptionCounter}`);
  }

  unsubscribeAll(): void {
    // No-op
  }
}