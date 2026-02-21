/**
 * Event-based test helpers for proper async synchronization
 * Replaces setTimeout with deterministic event-driven patterns
 */

/**
 * Minimal interface for event bus operations used in test helpers.
 * Avoids importing the full EventBus type (which has optional convenience methods).
 * Both InMemoryEventBus and TestEventBus satisfy this contract at runtime.
 */
interface TestableEventBus {
  on(event: string, handler: (data: unknown) => void): string | void;
  once(event: string, handler: (data: unknown) => void): void;
  removeListener(event: string, handler: (data: unknown) => void): void;
  emit(event: string, data: unknown): void;
}

type EventBus = TestableEventBus;

/**
 * Wait for a specific event to be emitted
 */
export function waitForEvent<T = unknown>(eventBus: EventBus, eventType: string, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event '${eventType}' after ${timeout}ms`));
    }, timeout);

    const handler = (data: T) => {
      clearTimeout(timer);
      resolve(data);
    };

    eventBus.once(eventType, handler);
  });
}

/**
 * Wait for multiple events to be emitted in any order
 */
export async function waitForEvents(
  eventBus: EventBus,
  eventTypes: string[],
  timeout = 5000,
): Promise<Map<string, unknown>> {
  const results = new Map<string, unknown>();
  const promises = eventTypes.map((eventType) =>
    waitForEvent(eventBus, eventType, timeout).then((data) => {
      results.set(eventType, data);
    }),
  );

  await Promise.all(promises);
  return results;
}

/**
 * Collect events over a period of time
 */
export function collectEvents(eventBus: EventBus, eventType: string, count: number, timeout = 5000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`Timeout collecting ${count} '${eventType}' events after ${timeout}ms. Got ${events.length}`));
    }, timeout);

    const handler = (data: unknown) => {
      events.push(data);
      if (events.length >= count) {
        clearTimeout(timer);
        resolve(events);
      }
    };

    // Use on instead of once to collect multiple
    for (let i = 0; i < count; i++) {
      eventBus.once(eventType, handler);
    }
  });
}

/**
 * Wait for a condition based on event data
 */
export function waitForCondition<T = unknown>(
  eventBus: EventBus,
  eventType: string,
  condition: (data: T) => boolean,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.removeListener(eventType, handler);
      reject(new Error(`Timeout waiting for condition on '${eventType}' after ${timeout}ms`));
    }, timeout);

    const handler = (data: T) => {
      if (condition(data)) {
        clearTimeout(timer);
        eventBus.removeListener(eventType, handler);
        resolve(data);
      }
    };

    eventBus.on(eventType, handler);
  });
}

/**
 * Emit an event and wait for a response event
 */
export async function emitAndWait<T = unknown>(
  eventBus: EventBus,
  emitType: string,
  emitData: unknown,
  waitType: string,
  timeout = 5000,
): Promise<T> {
  const waitPromise = waitForEvent<T>(eventBus, waitType, timeout);
  eventBus.emit(emitType, emitData);
  return waitPromise;
}

/**
 * Process microtasks and event loop
 */
export function flushEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
