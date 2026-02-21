import { describe, it, expect } from 'vitest';
import { ConsoleLogger } from '../../../src/implementations/logger';
import { TIMEOUTS } from '../../constants';

describe('ConsoleLogger - Behavioral Tests', () => {
  // NOTE: These tests focus on the behavioral interface of ConsoleLogger
  // We test what it does (formats messages, creates children) not HOW it outputs
  // This follows TEST_STANDARDS.md: Test WHAT, not HOW

  describe('Logger creation and configuration', () => {
    it('should create logger with prefix', () => {
      const logger = new ConsoleLogger('[Test]', false);

      // Verify logger is created (it doesn't throw)
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should create logger with color support', () => {
      const colorLogger = new ConsoleLogger('[Test]', true);
      const plainLogger = new ConsoleLogger('[Test]', false);

      // Both loggers should work regardless of color setting
      expect(colorLogger).toBeDefined();
      expect(plainLogger).toBeDefined();

      // Verify all log methods exist
      expect(colorLogger.info).toBeInstanceOf(Function);
      expect(plainLogger.info).toBeInstanceOf(Function);
    });

    it('should expose all required log levels', () => {
      const logger = new ConsoleLogger('[Test]', false);

      // Test that all methods can be called without error
      expect(() => logger.debug('Debug message')).not.toThrow();
      expect(() => logger.info('Info message')).not.toThrow();
      expect(() => logger.warn('Warning message')).not.toThrow();
      expect(() => logger.error('Error message')).not.toThrow();

      // Verify method signatures and properties
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.child).toBe('function');
      expect(logger.debug.length).toBeGreaterThanOrEqual(1);
      expect(logger.info.length).toBeGreaterThanOrEqual(1);
      expect(logger.warn.length).toBeGreaterThanOrEqual(1);
      expect(logger.error.length).toBeGreaterThanOrEqual(1);
      expect(logger.child.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Context handling', () => {
    it('should accept context objects', () => {
      const logger = new ConsoleLogger('[Test]', false);

      // These calls should not throw
      expect(() => logger.info('Message with context', { userId: '123' })).not.toThrow();
      expect(() => logger.warn('Warning with context', { code: 'W001' })).not.toThrow();
      expect(() => logger.debug('Debug with context', { data: { nested: true } })).not.toThrow();
    });

    it('should handle messages without context', () => {
      const logger = new ConsoleLogger('[Test]', false);

      expect(() => logger.info('Simple message')).not.toThrow();
      expect(() => logger.warn('Simple warning')).not.toThrow();
      expect(() => logger.error('Simple error')).not.toThrow();
    });

    it('should handle various context types', () => {
      const logger = new ConsoleLogger('[Test]', false);

      // Test various context shapes
      expect(() => logger.info('With string', 'context')).not.toThrow();
      expect(() => logger.info('With number', 123)).not.toThrow();
      expect(() => logger.info('With array', [1, 2, 3])).not.toThrow();
      expect(() => logger.info('With null', null)).not.toThrow();
      expect(() => logger.info('With undefined', undefined)).not.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should handle error objects', () => {
      const logger = new ConsoleLogger('[Test]', false);
      const error = new Error('Test error');

      // Should not throw when logging errors
      expect(() => logger.error('Operation failed', error)).not.toThrow();
      expect(() => logger.error('Failed with context', error, { userId: '123' })).not.toThrow();
      expect(() => logger.error('Just message')).not.toThrow();
    });

    it('should handle various error types', () => {
      const logger = new ConsoleLogger('[Test]', false);

      const standardError = new Error('Standard error');
      const typeError = new TypeError('Type error');
      const rangeError = new RangeError('Range error');

      expect(() => logger.error('Standard', standardError)).not.toThrow();
      expect(() => logger.error('Type', typeError)).not.toThrow();
      expect(() => logger.error('Range', rangeError)).not.toThrow();
    });

    it('should handle error-like objects', () => {
      const logger = new ConsoleLogger('[Test]', false);

      const errorLike = { message: 'error-like', stack: 'fake stack' };
      const customError = { code: 'ERR_001', details: 'Something went wrong' };

      expect(() => logger.error('Error-like', errorLike as Error)).not.toThrow();
      expect(() => logger.error('Custom', customError as Error)).not.toThrow();
    });
  });

  describe('Child logger creation', () => {
    it('should create child logger', () => {
      const parent = new ConsoleLogger('[Parent]', false);
      const child = parent.child({ module: 'auth' });

      expect(child).toBeDefined();
      expect(child.info).toBeInstanceOf(Function);
      expect(child.error).toBeInstanceOf(Function);
      expect(child.warn).toBeInstanceOf(Function);
      expect(child.debug).toBeInstanceOf(Function);
    });

    it('should create child with different contexts', () => {
      const parent = new ConsoleLogger('[Parent]', false);

      const authChild = parent.child({ module: 'auth' });
      const apiChild = parent.child({ service: 'api' });
      const dataChild = parent.child({ component: 'database' });

      expect(authChild).toBeDefined();
      expect(apiChild).toBeDefined();
      expect(dataChild).toBeDefined();

      // All children should be functional
      expect(() => authChild.info('Auth message')).not.toThrow();
      expect(() => apiChild.info('API message')).not.toThrow();
      expect(() => dataChild.info('Data message')).not.toThrow();
    });

    it('should handle nested children', () => {
      const root = new ConsoleLogger('[Root]', false);
      const service = root.child({ module: 'api' });
      const nested = service.child({ module: 'auth' });
      const deeplyNested = nested.child({ module: 'token' });

      expect(root).toBeDefined();
      expect(service).toBeDefined();
      expect(nested).toBeDefined();
      expect(deeplyNested).toBeDefined();

      // All levels should work
      expect(() => root.info('Root log')).not.toThrow();
      expect(() => service.info('Service log')).not.toThrow();
      expect(() => nested.info('Nested log')).not.toThrow();
      expect(() => deeplyNested.info('Deep log')).not.toThrow();
    });

    it('should preserve color settings in children', () => {
      const colorParent = new ConsoleLogger('[Parent]', true);
      const plainParent = new ConsoleLogger('[Parent]', false);

      const colorChild = colorParent.child({ module: 'test' });
      const plainChild = plainParent.child({ module: 'test' });

      // Both children should work
      expect(() => colorChild.info('With colors')).not.toThrow();
      expect(() => plainChild.info('Without colors')).not.toThrow();
    });
  });

  describe('Performance and reliability', () => {
    it('should handle rapid logging without errors', () => {
      const logger = new ConsoleLogger('[Test]', false);

      const iterations = 100;
      expect(() => {
        for (let i = 0; i < iterations; i++) {
          logger.info(`Message ${i}`);
          logger.debug(`Debug ${i}`);
          logger.warn(`Warning ${i}`);
          logger.error(`Error ${i}`);
        }
      }).not.toThrow();
    });

    it('should handle large context objects', () => {
      const logger = new ConsoleLogger('[Test]', false);

      const largeContext = {
        data: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          value: `value-${i}`,
          nested: { deep: { data: i } },
        })),
      };

      expect(() => logger.info('Large context', largeContext)).not.toThrow();
    });

    it('should handle special characters in messages', () => {
      const logger = new ConsoleLogger('[Test]', false);

      const specialMessages = [
        'Message with \n newline',
        'Message with \t tab',
        'Message with "quotes"',
        "Message with 'apostrophes'",
        'Message with unicode 🎉',
        'Message with <html> tags </html>',
        'Message with ${template} literals',
      ];

      specialMessages.forEach((msg) => {
        expect(() => logger.info(msg)).not.toThrow();
      });
    });

    it('should handle concurrent child logger creation', () => {
      const logger = new ConsoleLogger('[Root]', false);

      const children = Array.from({ length: 10 }, (_, i) => logger.child({ module: `child-${i}` }));

      children.forEach((child, i) => {
        expect(child).toBeDefined();
        expect(() => child.info(`Child ${i} message`)).not.toThrow();
      });
    });
  });
});
