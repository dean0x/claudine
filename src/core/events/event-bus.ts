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
  request<T extends ClaudineEvent, R = any>(type: T['type'], payload: Omit<T, keyof BaseEvent | 'type'>): Promise<Result<R>>;
  subscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<void>;
  unsubscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<void>;
  subscribeAll(handler: EventHandler): Result<void>;
  unsubscribeAll(handler: EventHandler): Result<void>;
}

/**
 * In-memory event bus implementation
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly globalHandlers: EventHandler[] = [];

  constructor(private readonly logger: Logger) {}

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
   * Request-response pattern for query events
   * ARCHITECTURE: Enables synchronous-like queries in event-driven system
   */
  async request<T extends ClaudineEvent, R = any>(
    type: T['type'],
    payload: Omit<T, keyof BaseEvent | 'type'>
  ): Promise<Result<R>> {
    const event = createEvent(type, payload) as T & { __response?: R; __error?: Error };

    this.logger.debug('Request event emitted', {
      eventType: event.type,
      eventId: event.eventId
    });

    try {
      // Get handlers for this event type
      const handlers = this.handlers.get(type) || [];

      if (handlers.length === 0) {
        return err(new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `No handlers registered for query: ${type}`
        ));
      }

      // Execute first handler (queries should have single handler)
      await handlers[0](event);

      // Check for response or error
      if (event.__error) {
        return err(event.__error as ClaudineError);
      }

      if (event.__response !== undefined) {
        return ok(event.__response);
      }

      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Query handler did not provide response: ${type}`
      ));

    } catch (error) {
      this.logger.error('Request event failed', error as Error, {
        eventType: type,
        eventId: event.eventId
      });

      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Request failed for ${type}: ${error}`
      ));
    }
  }

  subscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<void> {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    
    const handlers = this.handlers.get(eventType)!;
    handlers.push(handler as EventHandler);

    this.logger.debug('Event handler subscribed', {
      eventType,
      handlerCount: handlers.length
    });

    return ok(undefined);
  }

  unsubscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<void> {
    const handlers = this.handlers.get(eventType);
    
    if (!handlers) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `No handlers registered for event type: ${eventType}`
      ));
    }

    const index = handlers.indexOf(handler as EventHandler);
    
    if (index === -1) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Handler not found for event type: ${eventType}`
      ));
    }

    handlers.splice(index, 1);

    this.logger.debug('Event handler unsubscribed', {
      eventType,
      handlerCount: handlers.length
    });

    return ok(undefined);
  }

  subscribeAll(handler: EventHandler): Result<void> {
    this.globalHandlers.push(handler);

    this.logger.debug('Global event handler subscribed', {
      globalHandlerCount: this.globalHandlers.length
    });

    return ok(undefined);
  }

  unsubscribeAll(handler: EventHandler): Result<void> {
    const index = this.globalHandlers.indexOf(handler);
    
    if (index === -1) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        'Global handler not found'
      ));
    }

    this.globalHandlers.splice(index, 1);

    this.logger.debug('Global event handler unsubscribed', {
      globalHandlerCount: this.globalHandlers.length
    });

    return ok(undefined);
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
}

/**
 * Null event bus for testing - events are emitted but not processed
 */
export class NullEventBus implements EventBus {
  async emit<T extends ClaudineEvent>(): Promise<Result<void>> {
    return ok(undefined);
  }

  async request<T extends ClaudineEvent, R = any>(): Promise<Result<R>> {
    return ok(undefined as any);
  }

  subscribe<T extends ClaudineEvent>(): Result<void> {
    return ok(undefined);
  }

  unsubscribe<T extends ClaudineEvent>(): Result<void> {
    return ok(undefined);
  }

  subscribeAll(): Result<void> {
    return ok(undefined);
  }

  unsubscribeAll(): Result<void> {
    return ok(undefined);
  }
}