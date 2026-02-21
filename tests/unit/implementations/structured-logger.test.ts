import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StructuredLogger, LogLevel } from '../../../src/implementations/logger';
import { TEST_COUNTS } from '../../constants';

describe('StructuredLogger - JSON Logging Behavior', () => {
  let capturedLogs: any[] = [];
  let mockOutput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    capturedLogs = [];
    mockOutput = vi.fn((entry) => {
      capturedLogs.push(entry);
    });
  });

  describe('Basic logging operations', () => {
    it('should create log entry with correct structure', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      logger.info('Test message', { userId: '123' });

      expect(capturedLogs).toHaveLength(1);
      const entry = capturedLogs[0];

      expect(entry).toMatchObject({
        level: 'info',
        message: 'Test message',
        context: { userId: '123' },
      });
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should respect log levels', () => {
      const logger = new StructuredLogger({}, LogLevel.WARN, mockOutput);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(capturedLogs).toHaveLength(2);
      expect(capturedLogs[0].level).toBe('warn');
      expect(capturedLogs[1].level).toBe('error');
    });

    it('should include global context in all logs', () => {
      const globalContext = {
        service: 'api',
        version: '1.0.0',
      };
      const logger = new StructuredLogger(globalContext, LogLevel.DEBUG, mockOutput);

      logger.info('Test message', { requestId: 'abc123' });

      expect(capturedLogs[0].context).toEqual({
        service: 'api',
        version: '1.0.0',
        requestId: 'abc123',
      });
    });

    it('should handle messages without additional context', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      logger.info('Simple message');

      expect(capturedLogs[0]).toMatchObject({
        level: 'info',
        message: 'Simple message',
        context: {},
      });
    });
  });

  describe('Error logging', () => {
    it('should log error messages', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      // FIX: error() signature is (message, error?, context?) - context is 3rd param
      logger.error('Operation failed', undefined, { code: 'ERR_001' });

      const logged = capturedLogs[0];
      expect(logged.level).toBe('error');
      expect(logged.message).toBe('Operation failed');
      expect(logged.context.code).toBe('ERR_001');
    });

    it('should handle error context', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);
      const error = new Error('Test error');

      // FIX: error() signature is (message, error?, context?) - context is 3rd param
      logger.error('Request failed', undefined, { error: error.message });

      expect(capturedLogs[0].context.error).toBe('Test error');
    });
  });

  describe('Child logger creation', () => {
    it('should create child with additional context', () => {
      const parent = new StructuredLogger({ service: 'api' }, LogLevel.DEBUG, mockOutput);

      const child = parent.child({ module: 'auth' });

      child.info('Child log', { userId: '123' });

      expect(capturedLogs[0].context).toEqual({
        service: 'api',
        module: 'auth',
        userId: '123',
      });
    });

    it('should inherit log level from parent', () => {
      const parent = new StructuredLogger({}, LogLevel.WARN, mockOutput);
      const child = parent.child({ module: 'sub' });

      child.debug('Debug from child');
      child.info('Info from child');
      child.warn('Warn from child');

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].level).toBe('warn');
    });

    it('should share output with parent', () => {
      const parent = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);
      const child = parent.child({ module: 'sub' });

      parent.info('Parent log');
      child.info('Child log');

      expect(capturedLogs).toHaveLength(2);
      expect(capturedLogs[0].message).toBe('Parent log');
      expect(capturedLogs[1].message).toBe('Child log');
    });

    it('should handle nested child creation', () => {
      const root = new StructuredLogger({ app: 'myapp' }, LogLevel.DEBUG, mockOutput);

      const service = root.child({ service: 'api' });
      const module = service.child({ module: 'auth' });

      module.info('Nested log');

      expect(capturedLogs[0].context).toEqual({
        app: 'myapp',
        service: 'api',
        module: 'auth',
      });
    });
  });

  describe('Log level filtering', () => {
    const levels = [
      { method: 'debug' as const, level: LogLevel.DEBUG },
      { method: 'info' as const, level: LogLevel.INFO },
      { method: 'warn' as const, level: LogLevel.WARN },
      { method: 'error' as const, level: LogLevel.ERROR },
    ];

    levels.forEach(({ method, level }) => {
      it(`should filter ${method} logs based on level`, () => {
        const logger = new StructuredLogger({}, level, mockOutput);

        logger.debug('Debug message');
        logger.info('Info message');
        logger.warn('Warn message');
        logger.error('Error message');

        // Count how many logs should appear
        const expectedCount = levels.filter((l) => l.level >= level).length;
        expect(capturedLogs).toHaveLength(expectedCount);

        // Verify minimum level
        if (capturedLogs.length > 0) {
          const minLevel = levels.find((l) => l.level === level)?.method;
          expect(capturedLogs[0].level).toBe(minLevel);
        }
      });
    });
  });

  describe('Timestamp formatting', () => {
    it('should include ISO timestamp', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      const before = new Date().toISOString();
      logger.info('Test');
      const after = new Date().toISOString();

      const timestamp = capturedLogs[0].timestamp;
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(new Date(timestamp).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
    });
  });

  describe('Default output behavior', () => {
    it('should work without custom output function', () => {
      // Test that logger works with default output (stderr)
      const logger = new StructuredLogger({}, LogLevel.DEBUG);

      // Should not throw when logging
      expect(() => logger.info('Test message')).not.toThrow();
      expect(() => logger.debug('Debug message')).not.toThrow();
      expect(() => logger.warn('Warning message')).not.toThrow();
      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('should handle various payload sizes with default output', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG);

      const smallContext = { id: 1 };
      const mediumContext = { data: Array(100).fill('test') };
      const largeContext = { nested: { deep: { data: Array(TEST_COUNTS.STRESS_TEST).fill(0) } } };

      expect(() => logger.info('Small', smallContext)).not.toThrow();
      expect(() => logger.info('Medium', mediumContext)).not.toThrow();
      expect(() => logger.info('Large', largeContext)).not.toThrow();
    });
  });
});
