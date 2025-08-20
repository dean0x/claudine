/**
 * Functional composition utilities
 * Compose operations in a readable, left-to-right manner
 */

/**
 * Pipe functions left-to-right
 */
export function pipe<A, B>(
  value: A,
  fn1: (a: A) => B
): B;
export function pipe<A, B, C>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C
): C;
export function pipe<A, B, C, D>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D
): D;
export function pipe<A, B, C, D, E>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E
): E;
export function pipe<A, B, C, D, E, F>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E,
  fn5: (e: E) => F
): F;
export function pipe(
  value: any,
  ...fns: Array<(arg: any) => any>
): any {
  return fns.reduce((acc, fn) => fn(acc), value);
}

/**
 * Async pipe for Promise-based operations
 */
export function pipeAsync<A, B>(
  value: A,
  fn1: (a: A) => Promise<B>
): Promise<B>;
export function pipeAsync<A, B, C>(
  value: A,
  fn1: (a: A) => Promise<B>,
  fn2: (b: B) => Promise<C>
): Promise<C>;
export function pipeAsync<A, B, C, D>(
  value: A,
  fn1: (a: A) => Promise<B>,
  fn2: (b: B) => Promise<C>,
  fn3: (c: C) => Promise<D>
): Promise<D>;
export function pipeAsync<A, B, C, D, E>(
  value: A,
  fn1: (a: A) => Promise<B>,
  fn2: (b: B) => Promise<C>,
  fn3: (c: C) => Promise<D>,
  fn4: (d: D) => Promise<E>
): Promise<E>;
export async function pipeAsync(
  value: any,
  ...fns: Array<(arg: any) => Promise<any>>
): Promise<any> {
  let result = value;
  for (const fn of fns) {
    result = await fn(result);
  }
  return result;
}

/**
 * Create a pipeline function
 */
export function createPipeline<A, B>(
  fn1: (a: A) => B
): (a: A) => B;
export function createPipeline<A, B, C>(
  fn1: (a: A) => B,
  fn2: (b: B) => C
): (a: A) => C;
export function createPipeline<A, B, C, D>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D
): (a: A) => D;
export function createPipeline<A, B, C, D, E>(
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E
): (a: A) => E;
export function createPipeline(
  ...fns: Array<(arg: any) => any>
): (arg: any) => any {
  return (value: any) => fns.reduce((acc, fn) => fn(acc), value);
}

/**
 * Compose functions right-to-left (traditional composition)
 */
export function compose<A, B>(
  fn1: (a: A) => B
): (a: A) => B;
export function compose<A, B, C>(
  fn2: (b: B) => C,
  fn1: (a: A) => B
): (a: A) => C;
export function compose<A, B, C, D>(
  fn3: (c: C) => D,
  fn2: (b: B) => C,
  fn1: (a: A) => B
): (a: A) => D;
export function compose(
  ...fns: Array<(arg: any) => any>
): (arg: any) => any {
  return (value: any) => fns.reduceRight((acc, fn) => fn(acc), value);
}

/**
 * Tap for side effects (debugging, logging)
 */
export const tap = <T>(fn: (value: T) => void) => (value: T): T => {
  fn(value);
  return value;
};

/**
 * Identity function
 */
export const identity = <T>(value: T): T => value;