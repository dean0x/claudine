/**
 * Result type for functional error handling
 * Never throw errors - always return Results
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

/**
 * Map over a successful result
 */
export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> => {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
};

/**
 * FlatMap (bind) for chaining Results
 */
export const flatMap = <T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> => {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
};

/**
 * Map over an error
 */
export const mapError = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> => {
  if (!result.ok) {
    return err(fn(result.error));
  }
  return result;
};

/**
 * Combine multiple Results
 */
export const combine = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];

  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }

  return ok(values);
};

/**
 * Try-catch wrapper that returns a Result
 */
export const tryCatch = <T, E = Error>(fn: () => T, onError?: (error: unknown) => E): Result<T, E> => {
  try {
    return ok(fn());
  } catch (error) {
    const errorHandler = onError || ((e: unknown) => e as E);
    return err(errorHandler(error));
  }
};

/**
 * Async try-catch wrapper
 */
export const tryCatchAsync = async <T, E = Error>(
  fn: () => Promise<T>,
  onError?: (error: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    const errorHandler = onError || ((e: unknown) => e as E);
    return err(errorHandler(error));
  }
};

/**
 * Convert a Result to a Promise (for interop)
 */
export const toPromise = <T, E>(result: Result<T, E>): Promise<T> => {
  if (result.ok) {
    return Promise.resolve(result.value);
  }
  return Promise.reject(result.error);
};

/**
 * Pattern matching for Results
 */
export const match = <T, E, R>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => R;
    err: (error: E) => R;
  },
): R => {
  if (result.ok) {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
};

/**
 * Get value or default
 */
export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
};

/**
 * Type guards
 */
export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => {
  return result.ok;
};

export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => {
  return !result.ok;
};

/**
 * Unwrap a Result (throws if error)
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
};

/**
 * Unwrap error (throws if ok)
 */
export const unwrapErr = <T, E>(result: Result<T, E>): E => {
  if (!result.ok) {
    return result.error;
  }
  throw new Error('Called unwrapErr on Ok result');
};
