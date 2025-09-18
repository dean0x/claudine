import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StructuredLogger,
  ConsoleLogger,
  TestLogger,
  LogLevel
} from '../../../src/implementations/logger';

describe('StructuredLogger - REAL JSON Logging Behavior', () => {
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
        context: { userId: '123' }
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
      const logger = new StructuredLogger(
        { service: 'claudine', version: '1.0.0' },
        LogLevel.DEBUG,
        mockOutput
      );

      logger.info('Test', { requestId: 'abc' });

      expect(capturedLogs[0].context).toEqual({
        service: 'claudine',
        version: '1.0.0',
        requestId: 'abc'
      });
    });

    it('should merge contexts correctly', () => {
      const logger = new StructuredLogger(
        { app: 'test' },
        LogLevel.DEBUG,
        mockOutput
      );

      logger.debug('Message', { app: 'override', extra: 'value' });

      expect(capturedLogs[0].context).toEqual({
        app: 'override',
        extra: 'value'
      });
    });
  });

  describe('Error logging', () => {
    it('should include error details in log entry', () => {
      const logger = new StructuredLogger({}, LogLevel.ERROR, mockOutput);
      const error = new Error('Test error');
      error.name = 'TestError';

      logger.error('Operation failed', error, { operation: 'test' });

      const entry = capturedLogs[0];
      expect(entry.error).toEqual({
        name: 'TestError',
        message: 'Test error',
        stack: error.stack
      });
      expect(entry.context).toEqual({ operation: 'test' });
    });

    it('should handle error without stack trace', () => {
      const logger = new StructuredLogger({}, LogLevel.ERROR, mockOutput);
      const error = new Error('No stack');
      delete error.stack;

      logger.error('Error occurred', error);

      expect(capturedLogs[0].error).toEqual({
        name: 'Error',
        message: 'No stack',
        stack: undefined
      });
    });

    it('should log error message without Error object', () => {
      const logger = new StructuredLogger({}, LogLevel.ERROR, mockOutput);

      logger.error('Simple error message');

      expect(capturedLogs[0]).not.toHaveProperty('error');
      expect(capturedLogs[0].message).toBe('Simple error message');
    });
  });

  describe('Child logger creation', () => {
    it('should inherit parent context', () => {
      const parent = new StructuredLogger(
        { service: 'parent' },
        LogLevel.DEBUG,
        mockOutput
      );

      const child = parent.child({ module: 'child' });
      child.info('Child message');

      expect(capturedLogs[0].context).toEqual({
        service: 'parent',
        module: 'child'
      });
    });

    it('should inherit parent log level', () => {
      const parent = new StructuredLogger({}, LogLevel.WARN, mockOutput);
      const child = parent.child({ module: 'test' });

      child.info('Should not log');
      child.warn('Should log');

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].level).toBe('warn');
    });

    it('should share output function with parent', () => {
      const parent = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);
      const child = parent.child({ child: true });

      parent.info('Parent log');
      child.info('Child log');

      expect(capturedLogs).toHaveLength(2);
      expect(mockOutput).toHaveBeenCalledTimes(2);
    });

    it('should allow deep nesting of child loggers', () => {
      const root = new StructuredLogger({ app: 'test' }, LogLevel.DEBUG, mockOutput);
      const level1 = root.child({ level: 1 });
      const level2 = level1.child({ level: 2 });
      const level3 = level2.child({ level: 3 });

      level3.info('Deep nested log');

      expect(capturedLogs[0].context).toEqual({
        app: 'test',
        level: 3
      });
    });
  });

  describe('Log level filtering', () => {
    it('should filter DEBUG level correctly', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      expect(capturedLogs).toHaveLength(4);
    });

    it('should filter INFO level correctly', () => {
      const logger = new StructuredLogger({}, LogLevel.INFO, mockOutput);

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      expect(capturedLogs).toHaveLength(3);
      expect(capturedLogs.map(l => l.level)).toEqual(['info', 'warn', 'error']);
    });

    it('should filter WARN level correctly', () => {
      const logger = new StructuredLogger({}, LogLevel.WARN, mockOutput);

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      expect(capturedLogs).toHaveLength(2);
      expect(capturedLogs.map(l => l.level)).toEqual(['warn', 'error']);
    });

    it('should filter ERROR level correctly', () => {
      const logger = new StructuredLogger({}, LogLevel.ERROR, mockOutput);

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      expect(capturedLogs).toHaveLength(1);
      expect(capturedLogs[0].level).toBe('error');
    });
  });

  describe('Timestamp formatting', () => {
    it('should use ISO 8601 format', () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      logger.info('Test');

      const timestamp = capturedLogs[0].timestamp;
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('should have unique timestamps for sequential logs', async () => {
      const logger = new StructuredLogger({}, LogLevel.DEBUG, mockOutput);

      logger.info('Log 1');
      await new Promise(resolve => setTimeout(resolve, 2));
      logger.info('Log 2');

      expect(capturedLogs[0].timestamp).not.toBe(capturedLogs[1].timestamp);
    });
  });

  describe('Default output behavior', () => {
    it('should use console.error by default', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = new StructuredLogger({}, LogLevel.INFO);
      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const call = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.message).toBe('Test message');

      consoleSpy.mockRestore();
    });
  });
});

describe('ConsoleLogger - REAL Console Output Behavior', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('Basic console output', () => {
    it('should output to console.error with prefix', () => {
      const logger = new ConsoleLogger();

      logger.info('Test message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[0]).toContain('[Claudine] INFO:');
      expect(callArgs[0]).toContain('Test message');
      expect(callArgs[1]).toBe('');
    });

    it('should include context in output', () => {
      const logger = new ConsoleLogger();

      logger.debug('Debug message', { key: 'value' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(String),
        { key: 'value' }
      );
    });

    it('should use custom prefix', () => {
      const logger = new ConsoleLogger('[Custom]');

      logger.info('Message');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Custom] INFO:'),
        expect.any(String),
        ''
      );
    });
  });

  describe('Color support', () => {
    it('should include ANSI colors when enabled', () => {
      const logger = new ConsoleLogger('[Test]', true);

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      const calls = consoleErrorSpy.mock.calls;

      // Cyan for debug
      expect(calls[0][0]).toContain('\x1b[36m');
      // Green for info
      expect(calls[1][0]).toContain('\x1b[32m');
      // Yellow for warn
      expect(calls[2][0]).toContain('\x1b[33m');
      // Red for error
      expect(calls[3][0]).toContain('\x1b[31m');

      // All should reset
      calls.forEach(call => {
        expect(call[0]).toContain('\x1b[0m');
      });
    });

    it('should not include colors when disabled', () => {
      const logger = new ConsoleLogger('[Test]', false);

      logger.info('No color');

      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).not.toContain('\x1b[');
    });
  });

  describe('Error handling', () => {
    it('should log error object separately', () => {
      const logger = new ConsoleLogger();
      const error = new Error('Test error');

      logger.error('Error occurred', error);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    it('should handle error without Error object', () => {
      const logger = new ConsoleLogger();

      logger.error('Simple error');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Child logger creation', () => {
    it('should include module in prefix', () => {
      const parent = new ConsoleLogger('[Parent]');
      const child = parent.child({ module: 'child-module' });

      child.info('Child log');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Parent][child-module]'),
        expect.any(String),
        ''
      );
    });

    it('should inherit color settings', () => {
      const parent = new ConsoleLogger('[Parent]', true);
      const child = parent.child({ module: 'child' });

      child.info('Colored');

      expect(consoleErrorSpy.mock.calls[0][0]).toContain('\x1b[32m');
    });

    it('should handle child without module', () => {
      const parent = new ConsoleLogger('[Parent]');
      const child = parent.child({ other: 'value' });

      child.info('No module');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Parent]'),
        expect.any(String),
        ''
      );
    });
  });

  describe('All log levels', () => {
    it('should handle all log levels correctly', () => {
      const logger = new ConsoleLogger();

      logger.debug('Debug', { level: 'debug' });
      logger.info('Info', { level: 'info' });
      logger.warn('Warn', { level: 'warn' });
      logger.error('Error', null, { level: 'error' });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(4);

      const calls = consoleErrorSpy.mock.calls;
      expect(calls[0][0]).toContain('DEBUG:');
      expect(calls[1][0]).toContain('INFO:');
      expect(calls[2][0]).toContain('WARN:');
      expect(calls[3][0]).toContain('ERROR:');
    });
  });
});

describe('TestLogger - REAL Test Capture Behavior', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  describe('Log capture', () => {
    it('should capture all log entries', () => {
      logger.debug('Debug message', { debug: true });
      logger.info('Info message', { info: true });
      logger.warn('Warn message', { warn: true });
      logger.error('Error message', new Error('Test'), { error: true });

      expect(logger.logs).toHaveLength(4);

      expect(logger.logs[0]).toEqual({
        level: 'debug',
        message: 'Debug message',
        context: { debug: true }
      });

      expect(logger.logs[3]).toEqual({
        level: 'error',
        message: 'Error message',
        context: { error: true },
        error: expect.any(Error)
      });
    });

    it('should capture logs without context', () => {
      logger.info('No context');

      expect(logger.logs[0]).toEqual({
        level: 'info',
        message: 'No context',
        context: undefined
      });
    });

    it('should maintain log order', () => {
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`);
      }

      expect(logger.logs).toHaveLength(10);
      expect(logger.logs[0].message).toBe('Message 0');
      expect(logger.logs[9].message).toBe('Message 9');
    });
  });

  describe('Clear functionality', () => {
    it('should clear all captured logs', () => {
      logger.info('Log 1');
      logger.info('Log 2');
      expect(logger.logs).toHaveLength(2);

      logger.clear();

      expect(logger.logs).toHaveLength(0);
    });

    it('should allow logging after clear', () => {
      logger.info('Before clear');
      logger.clear();
      logger.info('After clear');

      expect(logger.logs).toHaveLength(1);
      expect(logger.logs[0].message).toBe('After clear');
    });
  });

  describe('hasLog helper', () => {
    it('should find logs by level and message', () => {
      logger.info('Test message');
      logger.error('Error message');

      expect(logger.hasLog('info', 'Test message')).toBe(true);
      expect(logger.hasLog('error', 'Error message')).toBe(true);
      expect(logger.hasLog('info', 'Error message')).toBe(false);
      expect(logger.hasLog('warn', 'Test message')).toBe(false);
    });

    it('should handle partial message matches correctly', () => {
      logger.info('This is a long message');

      // hasLog requires exact match
      expect(logger.hasLog('info', 'long message')).toBe(false);
      expect(logger.hasLog('info', 'This is a long message')).toBe(true);
    });
  });

  describe('Child logger', () => {
    it('should return same instance for testing', () => {
      const child = logger.child({ module: 'test' });

      expect(child).toBe(logger);
    });

    it('should share logs with parent', () => {
      const child = logger.child({ module: 'child' });

      child.info('Child log');

      expect(logger.logs).toHaveLength(1);
      expect(logger.logs[0].message).toBe('Child log');
    });
  });

  describe('Error capture', () => {
    it('should capture Error objects', () => {
      const error = new Error('Test error');
      error.name = 'CustomError';

      logger.error('Failed operation', error, { operation: 'test' });

      const log = logger.logs[0];
      expect(log.error).toBe(error);
      expect(log.error?.name).toBe('CustomError');
      expect(log.error?.message).toBe('Test error');
    });

    it('should handle error without Error object', () => {
      logger.error('Simple error');

      expect(logger.logs[0].error).toBeUndefined();
    });
  });

  describe('Usage in tests', () => {
    it('should be useful for verifying log output', () => {
      // Simulate a function that logs
      function doOperation(logger: TestLogger) {
        logger.info('Starting operation');
        try {
          throw new Error('Operation failed');
        } catch (error) {
          logger.error('Operation failed', error as Error);
        }
      }

      doOperation(logger);

      expect(logger.logs).toHaveLength(2);
      expect(logger.hasLog('info', 'Starting operation')).toBe(true);
      expect(logger.hasLog('error', 'Operation failed')).toBe(true);
      expect(logger.logs[1].error).toBeInstanceOf(Error);
    });

    it('should help test conditional logging', () => {
      function conditionalLog(logger: TestLogger, shouldLog: boolean) {
        if (shouldLog) {
          logger.warn('Condition met');
        }
      }

      conditionalLog(logger, false);
      expect(logger.logs).toHaveLength(0);

      conditionalLog(logger, true);
      expect(logger.logs).toHaveLength(1);
      expect(logger.hasLog('warn', 'Condition met')).toBe(true);
    });
  });
});

describe('Logger Integration Patterns', () => {
  it('should work with dependency injection', () => {
    class Service {
      constructor(private readonly logger: TestLogger) {}

      doWork(): void {
        this.logger.info('Starting work');
        this.logger.debug('Processing', { step: 1 });
        this.logger.info('Work completed');
      }
    }

    const logger = new TestLogger();
    const service = new Service(logger);

    service.doWork();

    expect(logger.logs).toHaveLength(3);
    expect(logger.logs[0].message).toBe('Starting work');
    expect(logger.logs[2].message).toBe('Work completed');
  });

  it('should support testing with multiple loggers', () => {
    const mainLogger = new TestLogger();
    const workerLogger = new TestLogger();

    mainLogger.info('Main process started');
    workerLogger.info('Worker started');
    mainLogger.info('Delegating to worker');
    workerLogger.info('Processing task');
    workerLogger.info('Task complete');
    mainLogger.info('Main process complete');

    expect(mainLogger.logs).toHaveLength(3);
    expect(workerLogger.logs).toHaveLength(3);
  });

  it('should handle concurrent logging', () => {
    const logger = new TestLogger();
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        Promise.resolve().then(() => {
          logger.info(`Async log ${i}`);
        })
      );
    }

    return Promise.all(promises).then(() => {
      expect(logger.logs).toHaveLength(10);
      const messages = logger.logs.map(l => l.message);
      expect(messages).toContain('Async log 0');
      expect(messages).toContain('Async log 9');
    });
  });
});

describe('Real-world Logger Scenarios', () => {
  it('should handle request tracing with context', () => {
    const rootLogger = new StructuredLogger(
      { service: 'api' },
      LogLevel.DEBUG,
      vi.fn()
    );

    const requestLogger = rootLogger.child({
      requestId: 'req-123',
      userId: 'user-456'
    });

    const dbLogger = requestLogger.child({
      component: 'database'
    });

    dbLogger.info('Executing query');

    const output = (rootLogger as any).output;
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          service: 'api',
          requestId: 'req-123',
          userId: 'user-456',
          component: 'database'
        }
      })
    );
  });

  it('should handle error aggregation', () => {
    const logger = new TestLogger();
    const errors: Error[] = [];

    for (let i = 0; i < 5; i++) {
      try {
        throw new Error(`Error ${i}`);
      } catch (error) {
        errors.push(error as Error);
        logger.error(`Operation ${i} failed`, error as Error, { index: i });
      }
    }

    const errorLogs = logger.logs.filter(l => l.level === 'error');
    expect(errorLogs).toHaveLength(5);
    errorLogs.forEach((log, i) => {
      expect(log.error?.message).toBe(`Error ${i}`);
      expect(log.context?.index).toBe(i);
    });
  });

  it('should support performance logging patterns', () => {
    const logger = new TestLogger();

    function measureOperation(name: string, fn: () => void) {
      const start = performance.now();
      logger.debug(`Starting ${name}`);

      fn();

      const duration = performance.now() - start;
      logger.info(`Completed ${name}`, { duration });
    }

    measureOperation('task-1', () => {
      // Simulate work
      for (let i = 0; i < 1000000; i++) {}
    });

    expect(logger.logs).toHaveLength(2);
    expect(logger.logs[1].context?.duration).toBeGreaterThan(0);
  });
});