import { describe, it, expect } from 'vitest';
import { pipe, pipeAsync, compose, composeAsync, identity } from '../../../src/core/pipe';

describe('Pipe - REAL Function Composition Tests', () => {
  describe('pipe - left-to-right composition', () => {
    it('should execute functions in order', () => {
      const add5 = (x: number) => x + 5;
      const multiply2 = (x: number) => x * 2;
      const subtract3 = (x: number) => x - 3;

      const pipeline = pipe(add5, multiply2, subtract3);
      const result = pipeline(10);

      // (10 + 5) * 2 - 3 = 15 * 2 - 3 = 30 - 3 = 27
      expect(result).toBe(27);
    });

    it('should handle type transformations', () => {
      const toNumber = (s: string) => parseInt(s, 10);
      const double = (n: number) => n * 2;
      const toString = (n: number) => `Result: ${n}`;

      const pipeline = pipe(toNumber, double, toString);
      const result = pipeline('21');

      expect(result).toBe('Result: 42');
      expect(typeof result).toBe('string');
    });

    it('should work with single function', () => {
      const double = (x: number) => x * 2;
      const pipeline = pipe(double);

      expect(pipeline(21)).toBe(42);
    });

    it('should handle complex object transformations', () => {
      interface User {
        name: string;
        age: number;
      }

      const getUser = (id: number): User => ({
        name: `User${id}`,
        age: id * 10
      });

      const addTitle = (user: User) => ({
        ...user,
        title: `Mr. ${user.name}`
      });

      const toGreeting = (user: { title: string; age: number }) =>
        `${user.title}, age ${user.age}`;

      const pipeline = pipe(getUser, addTitle, toGreeting);
      const result = pipeline(3);

      expect(result).toBe('Mr. User3, age 30');
    });

    it('should preserve this context when needed', () => {
      class Counter {
        value = 0;

        increment = (x: number) => {
          this.value += x;
          return this.value;
        };

        double = (x: number) => {
          this.value = x * 2;
          return this.value;
        };
      }

      const counter = new Counter();
      const pipeline = pipe(counter.increment, counter.double);

      const result = pipeline(5);

      // increment(5) sets value to 5, returns 5
      // double(5) sets value to 10, returns 10
      expect(result).toBe(10);
      expect(counter.value).toBe(10);
    });

    it('should handle functions with side effects', () => {
      const sideEffects: string[] = [];

      const logAndAdd = (x: number) => {
        sideEffects.push(`add: ${x}`);
        return x + 10;
      };

      const logAndMultiply = (x: number) => {
        sideEffects.push(`multiply: ${x}`);
        return x * 2;
      };

      const pipeline = pipe(logAndAdd, logAndMultiply);
      const result = pipeline(5);

      expect(result).toBe(30); // (5 + 10) * 2
      expect(sideEffects).toEqual(['add: 5', 'multiply: 15']);
    });

    it('should handle up to 10 functions with proper typing', () => {
      const f1 = (x: number) => x + 1;
      const f2 = (x: number) => x + 2;
      const f3 = (x: number) => x + 3;
      const f4 = (x: number) => x + 4;
      const f5 = (x: number) => x + 5;
      const f6 = (x: number) => x + 6;
      const f7 = (x: number) => x + 7;
      const f8 = (x: number) => x + 8;
      const f9 = (x: number) => x + 9;
      const f10 = (x: number) => x + 10;

      const pipeline = pipe(f1, f2, f3, f4, f5, f6, f7, f8, f9, f10);
      const result = pipeline(0);

      expect(result).toBe(55); // Sum of 1 through 10
    });

    it('should handle error propagation correctly', () => {
      const mayThrow = (x: number) => {
        if (x < 0) throw new Error('Negative number');
        return x;
      };

      const double = (x: number) => x * 2;

      const pipeline = pipe(mayThrow, double);

      expect(pipeline(5)).toBe(10);
      expect(() => pipeline(-1)).toThrow('Negative number');
    });
  });

  describe('compose - right-to-left composition', () => {
    it('should execute functions in reverse order', () => {
      const add5 = (x: number) => x + 5;
      const multiply2 = (x: number) => x * 2;
      const subtract3 = (x: number) => x - 3;

      const composition = compose(subtract3, multiply2, add5);
      const result = composition(10);

      // Same functions as pipe but applied right-to-left
      // add5(10) = 15, multiply2(15) = 30, subtract3(30) = 27
      expect(result).toBe(27);
    });

    it('should be equivalent to pipe with reversed arguments', () => {
      const f1 = (x: number) => x * 2;
      const f2 = (x: number) => x + 10;
      const f3 = (x: number) => x / 2;

      const piped = pipe(f1, f2, f3);
      const composed = compose(f3, f2, f1);

      const testValue = 8;
      expect(piped(testValue)).toBe(composed(testValue));
    });

    it('should handle type transformations right-to-left', () => {
      const stringify = (n: number) => n.toString();
      const double = (n: number) => n * 2;
      const parse = (s: string) => parseInt(s, 10);

      // Applied right-to-left: parse -> double -> stringify
      const composition = compose(stringify, double, parse);
      const result = composition('21');

      expect(result).toBe('42');
    });
  });

  describe('pipeAsync - async function composition', () => {
    it('should compose async functions left-to-right', async () => {
      const asyncAdd = async (x: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return x + 5;
      };

      const asyncMultiply = async (x: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return x * 2;
      };

      const pipeline = pipeAsync(asyncAdd, asyncMultiply);
      const result = await pipeline(10);

      expect(result).toBe(30); // (10 + 5) * 2
    });

    it('should handle mixed sync and async functions', async () => {
      const syncAdd = (x: number) => x + 10;
      const asyncDouble = async (x: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return x * 2;
      };
      const syncToString = (x: number) => `Result: ${x}`;

      const pipeline = pipeAsync(syncAdd, asyncDouble, syncToString);
      const result = await pipeline(5);

      expect(result).toBe('Result: 30'); // (5 + 10) * 2
    });

    it('should handle promise rejections', async () => {
      const asyncSuccess = async (x: number) => x * 2;
      const asyncFail = async (x: number) => {
        if (x > 10) {
          throw new Error('Too large');
        }
        return x;
      };

      const pipeline = pipeAsync(asyncSuccess, asyncFail);

      await expect(pipeline(6)).rejects.toThrow('Too large');
      await expect(pipeline(4)).resolves.toBe(8);
    });

    it('should maintain execution order with delays', async () => {
      const order: number[] = [];

      const delay = (ms: number) =>
        new Promise(resolve => setTimeout(resolve, ms));

      const first = async (x: number) => {
        await delay(10);
        order.push(1);
        return x + 1;
      };

      const second = async (x: number) => {
        await delay(5);
        order.push(2);
        return x * 2;
      };

      const third = async (x: number) => {
        await delay(1);
        order.push(3);
        return x - 3;
      };

      const pipeline = pipeAsync(first, second, third);
      const result = await pipeline(10);

      expect(result).toBe(19); // ((10 + 1) * 2) - 3 = 22 - 3
      expect(order).toEqual([1, 2, 3]);
    });

    it('should handle async type transformations', async () => {
      const fetchUser = async (id: number) => ({
        id,
        name: `User${id}`
      });

      const enrichUser = async (user: { id: number; name: string }) => ({
        ...user,
        email: `${user.name.toLowerCase()}@example.com`
      });

      const formatUser = (user: { name: string; email: string }) =>
        `${user.name} <${user.email}>`;

      const pipeline = pipeAsync(fetchUser, enrichUser, formatUser);
      const result = await pipeline(42);

      expect(result).toBe('User42 <user42@example.com>');
    });
  });

  describe('composeAsync - async right-to-left composition', () => {
    it('should compose async functions right-to-left', async () => {
      const asyncAdd = async (x: number) => x + 5;
      const asyncMultiply = async (x: number) => x * 2;

      const composition = composeAsync(asyncMultiply, asyncAdd);
      const result = await composition(10);

      // Applied right-to-left: add then multiply
      expect(result).toBe(30); // (10 + 5) * 2
    });

    it('should be equivalent to pipeAsync with reversed args', async () => {
      const f1 = async (x: number) => x * 2;
      const f2 = async (x: number) => x + 10;
      const f3 = async (x: number) => x / 2;

      const piped = pipeAsync(f1, f2, f3);
      const composed = composeAsync(f3, f2, f1);

      const testValue = 8;
      const pipedResult = await piped(testValue);
      const composedResult = await composed(testValue);

      expect(pipedResult).toBe(composedResult);
    });
  });

  describe('identity function', () => {
    it('should return input unchanged', () => {
      expect(identity(42)).toBe(42);
      expect(identity('hello')).toBe('hello');
      expect(identity(null)).toBe(null);
      expect(identity(undefined)).toBe(undefined);

      const obj = { test: 'value' };
      expect(identity(obj)).toBe(obj); // Same reference
    });

    it('should be useful in conditional pipelines', () => {
      const maybeDouble = (shouldDouble: boolean) =>
        shouldDouble ? (x: number) => x * 2 : identity;

      const pipeline1 = pipe(
        (x: number) => x + 10,
        maybeDouble(true)
      );

      const pipeline2 = pipe(
        (x: number) => x + 10,
        maybeDouble(false)
      );

      expect(pipeline1(5)).toBe(30); // (5 + 10) * 2
      expect(pipeline2(5)).toBe(15); // (5 + 10) * 1
    });
  });

  describe('Real-world composition patterns', () => {
    it('should handle data validation pipeline', () => {
      const trim = (s: string) => s.trim();
      const lowercase = (s: string) => s.toLowerCase();
      const removeSpecialChars = (s: string) => s.replace(/[^a-z0-9]/g, '');
      const ensureMinLength = (s: string) => {
        if (s.length < 3) throw new Error('Too short');
        return s;
      };

      const sanitize = pipe(
        trim,
        lowercase,
        removeSpecialChars,
        ensureMinLength
      );

      expect(sanitize('  Hello-World!  ')).toBe('helloworld');
      expect(sanitize('TEST_123')).toBe('test123');
      expect(() => sanitize('  ab  ')).toThrow('Too short');
    });

    it('should handle async data processing pipeline', async () => {
      // Simulated async operations
      const fetchData = async (url: string) => {
        await new Promise(r => setTimeout(r, 1));
        return { url, data: 'raw data' };
      };

      const parseData = (response: { data: string }) => {
        return { parsed: response.data.toUpperCase() };
      };

      const enrichData = async (data: { parsed: string }) => {
        await new Promise(r => setTimeout(r, 1));
        return { ...data, timestamp: Date.now() };
      };

      const formatOutput = (data: { parsed: string; timestamp: number }) => {
        return `[${data.timestamp}] ${data.parsed}`;
      };

      const pipeline = pipeAsync(
        fetchData,
        parseData,
        enrichData,
        formatOutput
      );

      const result = await pipeline('https://api.example.com');

      expect(result).toMatch(/^\[\d+\] RAW DATA$/);
    });

    it('should handle error recovery in pipelines', () => {
      const riskyOperation = (x: number) => {
        if (x === 13) throw new Error('Unlucky!');
        return x;
      };

      const withFallback = (fn: (x: number) => number, fallback: number) =>
        (x: number) => {
          try {
            return fn(x);
          } catch {
            return fallback;
          }
        };

      const pipeline = pipe(
        (x: number) => x * 2,
        withFallback(riskyOperation, 0),
        (x: number) => x + 10
      );

      expect(pipeline(5)).toBe(20);  // (5 * 2) + 10
      expect(pipeline(6.5)).toBe(23); // (6.5 * 2) = 13, fallback to 0, + 10 = 10
    });

    it('should handle stateful transformations', () => {
      let callCount = 0;

      const statefulTransform = (x: number) => {
        callCount++;
        return x + callCount;
      };

      const pipeline = pipe(
        statefulTransform,
        statefulTransform,
        statefulTransform
      );

      const result1 = pipeline(0);
      const result2 = pipeline(0);

      expect(result1).toBe(6); // 0+1=1, 1+2=3, 3+3=6
      expect(result2).toBe(15); // 0+4=4, 4+5=9, 9+6=15
      expect(callCount).toBe(6);
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle large chains efficiently', () => {
      const increment = (x: number) => x + 1;

      // Create a pipeline of 100 increment functions
      const functions = Array(100).fill(increment);
      const pipeline = functions.reduce(
        (acc, fn) => pipe(acc, fn),
        identity as (x: number) => number
      );

      const start = performance.now();
      const result = pipeline(0);
      const duration = performance.now() - start;

      expect(result).toBe(100);
      expect(duration).toBeLessThan(10); // Should be very fast
    });

    it('should handle recursive composition', () => {
      const double = (x: number) => x * 2;

      const applyNTimes = (fn: (x: number) => number, n: number) => {
        if (n === 0) return identity as (x: number) => number;
        if (n === 1) return fn;
        return pipe(fn, applyNTimes(fn, n - 1));
      };

      const apply5Times = applyNTimes(double, 5);

      expect(apply5Times(1)).toBe(32); // 2^5
    });

    it('should handle functions that return functions', () => {
      const createAdder = (x: number) => (y: number) => x + y;
      const createMultiplier = (x: number) => (y: number) => x * y;

      const add5 = createAdder(5);
      const multiply3 = createMultiplier(3);

      const pipeline = pipe(add5, multiply3);

      expect(pipeline(10)).toBe(45); // (10 + 5) * 3
    });
  });
});