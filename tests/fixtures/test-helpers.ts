/**
 * Test Helpers
 * Type-safe utilities to eliminate 'as any' casts in tests
 *
 * ARCHITECTURE: These helpers provide properly typed test utilities
 * to avoid unsafe type assertions while maintaining test flexibility
 */

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { Readable, Writable } from 'stream';

/**
 * Creates a properly typed mock ChildProcess for testing
 */
export function createMockChildProcess(overrides?: Partial<ChildProcess>): ChildProcess {
  const stdout = new EventEmitter() as EventEmitter & Readable;
  const stderr = new EventEmitter() as EventEmitter & Readable;
  const stdin = new EventEmitter() as EventEmitter & Writable;

  // Add stream methods to EventEmitters
  Object.assign(stdout, {
    readable: true,
    read: () => null,
    setEncoding: () => stdout,
    pause: () => stdout,
    resume: () => stdout,
    isPaused: () => false,
    pipe: () => stdout,
    unpipe: () => stdout,
    unshift: () => undefined,
    wrap: () => stdout,
    destroy: () => stdout,
  });

  Object.assign(stderr, {
    readable: true,
    read: () => null,
    setEncoding: () => stderr,
    pause: () => stderr,
    resume: () => stderr,
    isPaused: () => false,
    pipe: () => stderr,
    unpipe: () => stderr,
    unshift: () => undefined,
    wrap: () => stderr,
    destroy: () => stderr,
  });

  Object.assign(stdin, {
    writable: true,
    write: () => true,
    end: () => stdin,
    destroy: () => stdin,
    cork: () => undefined,
    uncork: () => undefined,
    setDefaultEncoding: () => stdin,
  });

  const process = new EventEmitter() as EventEmitter & ChildProcess;

  return Object.assign(process, {
    pid: 12345,
    stdin: stdin as Writable,
    stdout: stdout as Readable,
    stderr: stderr as Readable,
    stdio: [stdin, stdout, stderr] as [Writable, Readable, Readable],
    kill: (signal?: NodeJS.Signals | number) => {
      setImmediate(() => {
        process.emit('exit', 0, signal);
      });
      return true;
    },
    send: () => true,
    disconnect: () => undefined,
    unref: () => process,
    ref: () => process,
    connected: false,
    signalCode: null,
    exitCode: null,
    killed: false,
    spawnfile: 'test',
    spawnargs: ['test'],
    channel: undefined,
    ...overrides,
  }) as ChildProcess;
}

/**
 * Type guard to safely check if a value is an Error
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Type guard to safely check if a value is an object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates a non-Error value for testing error handling
 */
export function createNonError(type: 'null' | 'undefined' | 'string' | 'number' | 'object'): unknown {
  switch (type) {
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'string':
      return 'not an error';
    case 'number':
      return 42;
    case 'object':
      return { message: 'error-like but not Error' };
  }
}

/**
 * Creates an error-like object for testing
 */
export function createErrorLike(message: string, code?: string): { message: string; code?: string } {
  return code ? { message, code } : { message };
}

/**
 * Safely casts to a specific type with runtime validation
 */
export function safeCast<T>(value: unknown, validator: (v: unknown) => v is T, fallback: T): T {
  return validator(value) ? value : fallback;
}

/**
 * Creates a mock stream for testing
 */
export function createMockStream(): Readable & EventEmitter {
  const stream = new EventEmitter();
  return Object.assign(stream, {
    readable: true,
    read: () => null,
    setEncoding: () => stream,
    pause: () => stream,
    resume: () => stream,
    isPaused: () => false,
    pipe: () => stream,
    unpipe: () => stream,
    unshift: () => undefined,
    wrap: () => stream,
    destroy: () => stream,
  }) as Readable & EventEmitter;
}

/**
 * Type-safe way to test invalid inputs
 */
export type InvalidInput = null | undefined | string | number | boolean | object;

export const INVALID_INPUTS: InvalidInput[] = [null, undefined, 'string', 42, true, false, { notAnError: true }];

/**
 * Creates a partial mock with only specified methods
 */
export function createPartialMock<T>(methods: Partial<T>): T {
  return methods as T;
}

/**
 * Helper to test functions with various invalid inputs
 */
export function testWithInvalidInputs<T>(
  fn: (input: T) => unknown,
  validInput: T,
  expectation: (result: unknown) => void,
): void {
  INVALID_INPUTS.forEach((invalid) => {
    const result = fn(invalid as T);
    expectation(result);
  });
}

/**
 * Creates a mock function for testing retry behavior
 */
export class RetryTestFunction<T = unknown> {
  private callCount = 0;
  private readonly responses: Array<{ type: 'success' | 'error'; value: T | Error }> = [];
  private readonly callHistory: Array<{ timestamp: number; args: unknown[] }> = [];

  constructor() {}

  // Configure responses for each call
  willSucceedWith(value: T): this {
    this.responses.push({ type: 'success', value });
    return this;
  }

  willFailWith(error: Error | string): this {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.responses.push({ type: 'error', value: err });
    return this;
  }

  willFailTimes(count: number, error: Error | string): this {
    for (let i = 0; i < count; i++) {
      this.willFailWith(error);
    }
    return this;
  }

  // The actual function to pass to retry utilities
  get fn() {
    return async (...args: unknown[]): Promise<T> => {
      this.callHistory.push({ timestamp: Date.now(), args });
      const response = this.responses[this.callCount] || this.responses[this.responses.length - 1];
      this.callCount++;

      if (!response) {
        throw new Error('No response configured for call ' + this.callCount);
      }

      if (response.type === 'error') {
        throw response.value;
      }
      return response.value as T;
    };
  }

  // Inspection methods
  get calls() {
    return this.callCount;
  }

  get history() {
    return [...this.callHistory];
  }

  wasCalledTimes(n: number): boolean {
    return this.callCount === n;
  }

  reset(): void {
    this.callCount = 0;
    this.callHistory.length = 0;
  }
}

/**
 * Mock function class that tracks calls
 */
export class MockFunction<T = unknown> {
  private callCount = 0;
  private calls: unknown[][] = [];
  private implementation?: (...args: unknown[]) => T | Promise<T>;

  constructor(implementation?: (...args: unknown[]) => T | Promise<T>) {
    this.implementation = implementation;

    // Bind the function to maintain context
    this.fn = this.fn.bind(this);

    // Add properties to the function
    const fnRecord = this.fn as unknown as Record<string, unknown>;
    fnRecord.callCount = 0;
    fnRecord.calls = [];
    fnRecord.wasCalledTimes = this.wasCalledTimes.bind(this);
    fnRecord.wasCalledWith = this.wasCalledWith.bind(this);
    fnRecord.reset = this.reset.bind(this);
  }

  async fn(...args: unknown[]): Promise<T> {
    this.callCount++;
    this.calls.push(args);

    // Update function properties
    const fnRecord = this.fn as unknown as Record<string, unknown>;
    fnRecord.callCount = this.callCount;
    fnRecord.calls = [...this.calls];

    if (this.implementation) {
      return await this.implementation(...args);
    }
    return undefined as T;
  }

  wasCalledTimes(n: number): boolean {
    return this.callCount === n;
  }

  wasCalledWith(...args: unknown[]): boolean {
    return this.calls.some((call) => call.length === args.length && call.every((arg, i) => arg === args[i]));
  }

  reset(): void {
    this.callCount = 0;
    this.calls.length = 0;
    const fnRecord = this.fn as unknown as Record<string, unknown>;
    fnRecord.callCount = 0;
    fnRecord.calls = [];
  }
}

/**
 * Creates a simple mock function that tracks calls
 */
export function createMockFunction<T = unknown>(
  implementation?: (...args: unknown[]) => T | Promise<T>,
): (...args: unknown[]) => Promise<T> {
  const mock = new MockFunction(implementation);
  return mock.fn;
}
