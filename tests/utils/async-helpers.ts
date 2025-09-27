/**
 * Test utilities for proper async handling
 * Replaces arbitrary setTimeout usage with deterministic patterns
 */

/**
 * Wait for a condition to become true
 * @param condition Function that returns true when condition is met
 * @param timeout Maximum time to wait in milliseconds
 * @param interval Check interval in milliseconds
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 10
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Wait for an event to be emitted
 * @param eventEmitter Event emitter to listen on
 * @param eventName Name of the event to wait for
 * @param timeout Maximum time to wait
 */
export function waitForEvent<T = any>(
  eventEmitter: any,
  eventName: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for event '${eventName}' after ${timeout}ms`));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      eventEmitter.removeListener(eventName, handler);
    };

    const handler = (data: T) => {
      cleanup();
      resolve(data);
    };

    eventEmitter.once(eventName, handler);
  });
}

/**
 * Process all pending promises in the microtask queue
 * Useful for ensuring async operations have completed
 */
export async function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Create a deferred promise that can be resolved externally
 */
export function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Run an async function with a timeout
 * @param fn Async function to run
 * @param timeout Maximum execution time
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeout: number
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
    )
  ]);
}