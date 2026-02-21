import { describe, it, expect, vi } from 'vitest';
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapError,
  flatMap,
  tryCatch,
  tryCatchAsync,
  combine,
  Result,
} from '../../../src/core/result';

describe('Result Type - REAL Behavior Tests', () => {
  describe('Result creation and type guards', () => {
    it('should create Ok result with value', () => {
      const result = ok(42);

      expect(result.ok).toBe(true);
      expect(isOk(result)).toBe(true);
      expect(isErr(result)).toBe(false);
      if (result.ok) {
        expect(result.value).toBe(42);
        expect(typeof result.value).toBe('number');
        expect(result.value).toBeGreaterThan(0);
        expect(result.value).toBeLessThan(100);
      }
      expect(typeof result.ok).toBe('boolean');
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('value');
      expect(Object.keys(result)).toEqual(['ok', 'value']);
    });

    it('should create Err result with error', () => {
      const error = new Error('Something went wrong');
      const result = err(error);

      expect(result.ok).toBe(false);
      expect(isOk(result)).toBe(false);
      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error).toBe(error);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('Something went wrong');
        expect(typeof result.error.message).toBe('string');
      }
      expect(typeof result.ok).toBe('boolean');
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('error');
      expect(Object.keys(result)).toEqual(['ok', 'error']);
    });

    it('should handle null and undefined values in Ok', () => {
      const nullResult = ok(null);
      const undefinedResult = ok(undefined);

      expect(isOk(nullResult)).toBe(true);
      expect(isOk(undefinedResult)).toBe(true);
      if (nullResult.ok) {
        expect(nullResult.value).toBeNull();
        expect(nullResult.ok).toBe(true);
        expect(typeof nullResult.ok).toBe('boolean');
      }
      if (undefinedResult.ok) {
        expect(undefinedResult.value).toBeUndefined();
        expect(undefinedResult.ok).toBe(true);
        expect(typeof undefinedResult.ok).toBe('boolean');
      }
      expect(nullResult).toHaveProperty('ok', true);
      expect(undefinedResult).toHaveProperty('ok', true);
      if (undefinedResult.ok) expect(undefinedResult.value).toBeUndefined();
    });

    it('should handle complex objects in results', () => {
      const complexValue = {
        nested: { data: [1, 2, 3] },
        fn: () => 'test',
      };
      const result = ok(complexValue);

      if (result.ok) {
        expect(result.value.nested.data).toEqual([1, 2, 3]);
        expect(result.value.fn()).toBe('test');
      }
    });
  });

  describe('unwrap operations', () => {
    it('should unwrap Ok value', () => {
      const result = ok('success');
      const value = unwrap(result);

      expect(value).toBe('success');
    });

    it('should throw when unwrapping Err', () => {
      const result = err(new Error('fail'));

      expect(() => unwrap(result)).toThrow('fail');
    });

    it('should use default value with unwrapOr on Err', () => {
      const result = err(new Error('fail'));
      const value = unwrapOr(result, 'default');

      expect(value).toBe('default');
    });

    it('should ignore default value with unwrapOr on Ok', () => {
      const result = ok('actual');
      const value = unwrapOr(result, 'default');

      expect(value).toBe('actual');
    });
  });

  describe('map transformations', () => {
    it('should map Ok value', () => {
      const result = ok(5);
      const mapped = map(result, (x) => x * 2);

      expect(isOk(mapped)).toBe(true);
      if (mapped.ok) {
        expect(mapped.value).toBe(10);
      }
    });

    it('should not map Err value', () => {
      const error = new Error('original');
      const result = err<number>(error);
      const mapped = map(result, (x) => x * 2);

      expect(isErr(mapped)).toBe(true);
      if (!mapped.ok) {
        expect(mapped.error).toBe(error);
      }
    });

    it('should handle type transformations in map', () => {
      const result = ok(42);
      const mapped = map(result, (n) => `Number: ${n}`);

      if (mapped.ok) {
        expect(typeof mapped.value).toBe('string');
        expect(mapped.value).toBe('Number: 42');
      }
    });

    it('should map error with mapError', () => {
      const result = err(new Error('original'));
      const mapped = mapError(result, (e) => new Error(`Wrapped: ${e.message}`));

      expect(isErr(mapped)).toBe(true);
      if (!mapped.ok) {
        expect(mapped.error.message).toBe('Wrapped: original');
      }
    });

    it('should not mapError on Ok result', () => {
      const result = ok('value');
      const mapped = mapError(result, (e) => new Error('should not run'));

      expect(isOk(mapped)).toBe(true);
      if (mapped.ok) {
        expect(mapped.value).toBe('value');
      }
    });
  });

  describe('flatMap chaining', () => {
    it('should chain Ok results', () => {
      const divide = (n: number, by: number): Result<number> =>
        by === 0 ? err(new Error('Division by zero')) : ok(n / by);

      const result = ok(20);
      const chained = flatMap(result, (n) => divide(n, 2));

      expect(isOk(chained)).toBe(true);
      if (chained.ok) {
        expect(chained.value).toBe(10);
      }
    });

    it('should short-circuit on first Err', () => {
      const divide = (n: number, by: number): Result<number> =>
        by === 0 ? err(new Error('Division by zero')) : ok(n / by);

      const result = ok(20);
      const chained = flatMap(result, (n) => divide(n, 0));

      expect(isErr(chained)).toBe(true);
      if (!chained.ok) {
        expect(chained.error.message).toBe('Division by zero');
      }
    });

    it('should not execute flatMap on Err', () => {
      let executed = false;
      const result = err<number>(new Error('initial error'));

      const chained = flatMap(result, (n) => {
        executed = true;
        return ok(n * 2);
      });

      expect(executed).toBe(false);
      expect(isErr(chained)).toBe(true);
    });

    it('should handle complex chaining scenarios', () => {
      const parseNumber = (s: string): Result<number> => {
        const n = Number(s);
        return isNaN(n) ? err(new Error(`Invalid number: ${s}`)) : ok(n);
      };

      const safeDivide = (n: number, by: number): Result<number> =>
        by === 0 ? err(new Error('Division by zero')) : ok(n / by);

      // Success case
      const success = flatMap(parseNumber('100'), (n) => safeDivide(n, 4));

      expect(unwrap(success)).toBe(25);

      // Failure at parse
      const failParse = flatMap(parseNumber('abc'), (n) => safeDivide(n, 4));

      expect(isErr(failParse)).toBe(true);
      if (!failParse.ok) {
        expect(failParse.error.message).toContain('Invalid number');
      }

      // Failure at divide
      const failDivide = flatMap(parseNumber('100'), (n) => safeDivide(n, 0));

      expect(isErr(failDivide)).toBe(true);
      if (!failDivide.ok) {
        expect(failDivide.error.message).toBe('Division by zero');
      }
    });
  });

  describe('tryCatch error handling', () => {
    it('should catch synchronous errors', () => {
      const dangerous = () => {
        throw new Error('Boom!');
      };

      const result = tryCatch(dangerous);

      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.message).toBe('Boom!');
      }
    });

    it('should return Ok for successful execution', () => {
      const safe = () => 'all good';
      const result = tryCatch(safe);

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('all good');
      }
    });

    it('should use custom error transformer', () => {
      const dangerous = () => {
        throw new TypeError('Wrong type');
      };

      const result = tryCatch(dangerous, (e) => new Error(`Caught: ${e}`));

      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.message).toContain('Caught: TypeError');
      }
    });

    it('should handle non-Error throws', () => {
      const throwString = () => {
        throw 'string error';
      };

      const throwNumber = () => {
        throw 42;
      };

      const throwObject = () => {
        throw { code: 'ERROR', data: 'test' };
      };

      const stringResult = tryCatch(throwString);
      const numberResult = tryCatch(throwNumber);
      const objectResult = tryCatch(throwObject);

      expect(isErr(stringResult)).toBe(true);
      expect(isErr(numberResult)).toBe(true);
      expect(isErr(objectResult)).toBe(true);

      // tryCatch doesn't wrap non-Errors, it just casts them
      if (!stringResult.ok) {
        expect(stringResult.error).toBe('string error');
      }

      if (!numberResult.ok) {
        expect(numberResult.error).toBe(42);
      }

      if (!objectResult.ok) {
        expect(objectResult.error).toEqual({ code: 'ERROR', data: 'test' });
      }
    });
  });

  describe('tryCatchAsync for promises', () => {
    it('should catch async errors', async () => {
      const failingAsync = async () => {
        await Promise.resolve(); // Simulate async work
        throw new Error('Async boom!');
      };

      const result = await tryCatchAsync(failingAsync);

      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.message).toBe('Async boom!');
      }
    });

    it('should handle successful async operations', async () => {
      const successAsync = async () => {
        await Promise.resolve(); // Simulate async work
        return 'async success';
      };

      const result = await tryCatchAsync(successAsync);

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('async success');
      }
    });

    it('should handle promise rejections', async () => {
      const rejectingAsync = async () => {
        return Promise.reject(new Error('Rejected!'));
      };

      const result = await tryCatchAsync(rejectingAsync);

      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.message).toBe('Rejected!');
      }
    });

    it('should transform async errors', async () => {
      const failingAsync = async () => {
        throw new TypeError('Wrong async type');
      };

      const result = await tryCatchAsync(failingAsync, (e) => new Error(`Async caught: ${e}`));

      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.message).toContain('Async caught');
      }
    });
  });

  describe('combine multiple results', () => {
    it('should combine all Ok results', () => {
      const results = [ok(1), ok(2), ok(3)];

      const combined = combine(results);

      expect(isOk(combined)).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual([1, 2, 3]);
      }
    });

    it('should fail fast on first Err', () => {
      const results = [ok(1), err(new Error('Second failed')), ok(3), err(new Error('Fourth failed'))];

      const combined = combine(results);

      expect(isErr(combined)).toBe(true);
      if (!combined.ok) {
        expect(combined.error.message).toBe('Second failed');
      }
    });

    it('should handle empty array', () => {
      const results: Result<number>[] = [];
      const combined = combine(results);

      expect(isOk(combined)).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual([]);
      }
    });

    it('should preserve types in combined result', () => {
      const results = [ok('string'), ok('another')];

      const combined = combine(results);

      expect(isOk(combined)).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual(['string', 'another']);
        combined.value.forEach((v) => {
          expect(typeof v).toBe('string');
        });
      }
    });

    it('should handle mixed types with proper typing', () => {
      // This test verifies TypeScript would catch type errors
      const r1: Result<number> = ok(42);
      const r2: Result<number> = ok(7);
      const results = [r1, r2];

      const combined = combine(results);

      if (combined.ok) {
        const values: number[] = combined.value;
        expect(values.every((v) => typeof v === 'number')).toBe(true);
      }
    });
  });

  describe('Real-world usage patterns', () => {
    it('should handle file parsing scenario', () => {
      const parseJSON = (text: string): Result<any> => {
        return tryCatch(() => JSON.parse(text));
      };

      // Valid JSON
      const validResult = parseJSON('{"name": "test", "value": 42}');
      expect(isOk(validResult)).toBe(true);
      if (validResult.ok) {
        expect(validResult.value.name).toBe('test');
        expect(validResult.value.value).toBe(42);
      }

      // Invalid JSON
      const invalidResult = parseJSON('not json');
      expect(isErr(invalidResult)).toBe(true);
    });

    it('should handle validation chain', () => {
      const validatePositive = (n: number): Result<number> => (n > 0 ? ok(n) : err(new Error('Must be positive')));

      const validateEven = (n: number): Result<number> => (n % 2 === 0 ? ok(n) : err(new Error('Must be even')));

      const validateRange = (n: number): Result<number> => (n <= 100 ? ok(n) : err(new Error('Must be <= 100')));

      // Test valid number
      const valid = flatMap(flatMap(validatePositive(42), validateEven), validateRange);

      expect(unwrap(valid)).toBe(42);

      // Test negative number
      const negative = flatMap(flatMap(validatePositive(-5), validateEven), validateRange);

      expect(isErr(negative)).toBe(true);
      if (!negative.ok) {
        expect(negative.error.message).toBe('Must be positive');
      }

      // Test odd number
      const odd = flatMap(flatMap(validatePositive(7), validateEven), validateRange);

      expect(isErr(odd)).toBe(true);
      if (!odd.ok) {
        expect(odd.error.message).toBe('Must be even');
      }
    });

    it('should handle async pipeline with proper error propagation', async () => {
      const fetchData = async (id: number): Promise<Result<string>> => {
        if (id < 0) {
          return err(new Error('Invalid ID'));
        }
        // Simulate async fetch (just needs to be async, no actual delay needed)
        await Promise.resolve();
        return ok(`Data for ${id}`);
      };

      const processData = (data: string): Result<number> => {
        const match = data.match(/\d+/);
        return match ? ok(parseInt(match[0])) : err(new Error('No number found'));
      };

      // Success case
      const successResult = await fetchData(42);
      const processed = flatMap(successResult, (data) => processData(data));

      expect(isOk(processed)).toBe(true);
      if (processed.ok) {
        expect(processed.value).toBe(42);
      }

      // Failure case
      const failResult = await fetchData(-1);
      const failProcessed = flatMap(failResult, (data) => processData(data));

      expect(isErr(failProcessed)).toBe(true);
      if (!failProcessed.ok) {
        expect(failProcessed.error.message).toBe('Invalid ID');
      }
    });
  });

  describe('Edge cases and error conditions', () => {
    it('should handle circular references in results', () => {
      const obj: any = { value: 1 };
      obj.self = obj; // Circular reference

      const result = ok(obj);

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(1);
        expect(result.value.self.self.self.value).toBe(1);
      }
    });

    it('should maintain error stack traces', () => {
      const createError = () => {
        const error = new Error('Test error');
        return error;
      };

      const error = createError();
      const result = err(error);

      if (!result.ok) {
        expect(result.error.stack).toBeDefined();
        expect(result.error.stack).toContain('createError');
      }
    });

    it('should handle Symbol values', () => {
      const sym = Symbol('test');
      const result = ok(sym);

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(sym);
        expect(result.value.toString()).toBe('Symbol(test)');
      }
    });

    it('should handle BigInt values', () => {
      const big = BigInt(Number.MAX_SAFE_INTEGER) * 2n;
      const result = ok(big);

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(big);
        expect(typeof result.value).toBe('bigint');
      }
    });
  });
});
