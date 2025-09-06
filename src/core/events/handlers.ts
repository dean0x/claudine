/**
 * Base event handler classes and utilities
 * Provides common patterns for event handling
 */

import { Result, ok, err } from '../result.js';
import { ClaudineError, ErrorCode } from '../errors.js';
import { Logger } from '../interfaces.js';
import { ClaudineEvent, EventHandler } from './events.js';
import { EventBus } from './event-bus.js';

/**
 * Base event handler with common functionality
 */
export abstract class BaseEventHandler {
  constructor(
    protected readonly logger: Logger,
    protected readonly name: string
  ) {}

  /**
   * Handle an event with error logging
   */
  protected async handleEvent<T extends ClaudineEvent>(
    event: T,
    handler: (event: T) => Promise<Result<void>>
  ): Promise<void> {
    this.logger.debug(`${this.name} handling event`, {
      eventType: event.type,
      eventId: event.eventId
    });

    const result = await handler(event);

    if (!result.ok) {
      this.logger.error(`${this.name} event handling failed`, result.error, {
        eventType: event.type,
        eventId: event.eventId
      });
      
      // Re-throw to fail the event emission
      throw result.error;
    }

    this.logger.debug(`${this.name} event handled successfully`, {
      eventType: event.type,
      eventId: event.eventId
    });
  }
}

/**
 * Event handler registry for organizing handlers
 */
export class EventHandlerRegistry {
  private readonly handlers: BaseEventHandler[] = [];

  constructor(private readonly eventBus: EventBus, private readonly logger: Logger) {}

  /**
   * Register an event handler
   */
  register(handler: BaseEventHandler): Result<void> {
    this.handlers.push(handler);
    
    this.logger.debug('Event handler registered', {
      handlerName: handler.constructor.name,
      totalHandlers: this.handlers.length
    });

    return ok(undefined);
  }

  /**
   * Register multiple handlers
   */
  registerAll(handlers: BaseEventHandler[]): Result<void> {
    for (const handler of handlers) {
      const result = this.register(handler);
      if (!result.ok) {
        return result;
      }
    }
    return ok(undefined);
  }

  /**
   * Initialize all handlers by subscribing them to events
   */
  async initialize(): Promise<Result<void>> {
    try {
      for (const handler of this.handlers) {
        // Each handler should have its own setup method
        if ('setup' in handler && typeof handler.setup === 'function') {
          const result = await handler.setup(this.eventBus);
          if (!result.ok) {
            return result;
          }
        }
      }

      this.logger.info('Event handler registry initialized', {
        handlerCount: this.handlers.length
      });

      return ok(undefined);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Event handler registry initialization failed: ${error}`
      ));
    }
  }

  /**
   * Shutdown all handlers
   */
  async shutdown(): Promise<Result<void>> {
    try {
      for (const handler of this.handlers) {
        if ('teardown' in handler && typeof handler.teardown === 'function') {
          await handler.teardown();
        }
      }

      this.logger.info('Event handler registry shutdown complete');
      return ok(undefined);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Event handler registry shutdown failed: ${error}`
      ));
    }
  }
}

/**
 * Retry logic for event handlers
 */
export class RetryableEventHandler extends BaseEventHandler {
  constructor(
    logger: Logger,
    name: string,
    private readonly maxRetries: number = 3,
    private readonly retryDelayMs: number = 1000
  ) {
    super(logger, name);
  }

  /**
   * Execute handler with retry logic
   */
  protected async executeWithRetry<T extends ClaudineEvent>(
    event: T,
    handler: (event: T) => Promise<Result<void>>
  ): Promise<void> {
    let lastError: ClaudineError | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await handler(event);
        
        if (result.ok) {
          if (attempt > 1) {
            this.logger.info(`${this.name} succeeded on retry`, {
              eventId: event.eventId,
              attempt
            });
          }
          return;
        }

        lastError = result.error instanceof ClaudineError ? result.error : new ClaudineError(ErrorCode.SYSTEM_ERROR, result.error.message || String(result.error));
        
        this.logger.warn(`${this.name} failed, attempt ${attempt}/${this.maxRetries}`, {
          eventId: event.eventId,
          error: lastError.message
        });

        // Wait before retrying (except on last attempt)
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
        }
      } catch (error) {
        lastError = error instanceof ClaudineError 
          ? error 
          : new ClaudineError(ErrorCode.SYSTEM_ERROR, `${error}`);
      }
    }

    // All retries failed
    throw lastError || new ClaudineError(
      ErrorCode.SYSTEM_ERROR,
      `${this.name} failed after ${this.maxRetries} attempts`
    );
  }
}

/**
 * Utility to create simple event handler functions
 */
export function createEventHandler<T extends ClaudineEvent>(
  handler: (event: T) => Promise<Result<void>>,
  logger: Logger,
  name: string
): EventHandler<T> {
  return async (event: T) => {
    logger.debug(`Event handler ${name} processing`, {
      eventType: event.type,
      eventId: event.eventId
    });

    const result = await handler(event);

    if (!result.ok) {
      logger.error(`Event handler ${name} failed`, result.error, {
        eventType: event.type,
        eventId: event.eventId
      });
      throw result.error;
    }
  };
}