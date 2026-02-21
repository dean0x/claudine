import { describe, it, expect, beforeEach } from 'vitest';
import { TestLogger } from '../../../src/implementations/logger';

describe('TestLogger - Test Capture Behavior', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  describe('Log capture', () => {
    it('should capture all log entries', () => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      const logs = logger.logs;
      expect(logs).toHaveLength(4);
      expect(logs[0].message).toBe('Debug message');
      expect(logs[1].message).toBe('Info message');
      expect(logs[2].message).toBe('Warn message');
      expect(logs[3].message).toBe('Error message');
    });

    it('should capture context with logs', () => {
      logger.info('User action', { userId: '123', action: 'login' });

      const logs = logger.logs;
      expect(logs[0].context).toEqual({
        userId: '123',
        action: 'login',
      });
    });

    it('should capture correct log levels', () => {
      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      const logs = logger.logs;
      expect(logs[0].level).toBe('debug');
      expect(logs[1].level).toBe('info');
      expect(logs[2].level).toBe('warn');
      expect(logs[3].level).toBe('error');
    });
  });

  describe('Clear functionality', () => {
    it('should clear captured logs', () => {
      logger.info('Log 1');
      logger.info('Log 2');
      expect(logger.logs).toHaveLength(2);

      logger.clear();
      expect(logger.logs).toHaveLength(0);
    });

    it('should continue capturing after clear', () => {
      logger.info('Before clear');
      logger.clear();
      logger.info('After clear');

      const logs = logger.logs;
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('After clear');
    });
  });

  describe('hasLog helper', () => {
    it('should find logs by message', () => {
      logger.info('User logged in');
      logger.warn('Invalid input');

      expect(logger.hasLog('info', 'User logged in')).toBe(true);
      expect(logger.hasLog('warn', 'Invalid input')).toBe(true);
      expect(logger.hasLog('info', 'Non-existent')).toBe(false);
    });

    it('should find logs by partial message', () => {
      logger.error('Failed to connect to database');

      expect(logger.logs.some((l) => l.message.includes('Failed to connect'))).toBe(true);
      expect(logger.logs.some((l) => l.message.includes('database'))).toBe(true);
    });
  });

  describe('Child logger', () => {
    it('should share logs with parent', () => {
      const child = logger.child({ module: 'auth' });

      logger.info('Parent log');
      child.info('Child log', { action: 'login' });

      const logs = logger.logs;
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Parent log');
      expect(logs[1].message).toBe('Child log');
      // TestLogger child returns same instance, so context is passed in info call
      expect(logs[1].context).toEqual({ action: 'login' });
    });
  });

  describe('Error capture', () => {
    it('should capture error objects', () => {
      const error = new Error('Test error');
      logger.error('Operation failed', error);

      const logs = logger.logs;
      expect(logs[0].error).toBeDefined();
      expect(logs[0].error?.message).toBe('Test error');
      expect(logs[0].error?.stack).toBeDefined();
    });

    it('should capture error with context', () => {
      const error = new Error('Custom error');
      logger.error('Failed', error, { code: 'ERR_001', userId: '123' });

      const logs = logger.logs;
      expect(logs[0].error?.message).toBe('Custom error');
      expect(logs[0].context).toEqual({ code: 'ERR_001', userId: '123' });
    });
  });

  describe('Log ordering and filtering', () => {
    it('should maintain log order', () => {
      logger.info('First');
      logger.warn('Second');
      logger.error('Third');
      logger.debug('Fourth');

      const logs = logger.logs;
      expect(logs[0].message).toBe('First');
      expect(logs[1].message).toBe('Second');
      expect(logs[2].message).toBe('Third');
      expect(logs[3].message).toBe('Fourth');
    });

    it('should filter logs by level', () => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      const errorLogs = logger.logs.filter((l) => l.level === 'error');
      const warnLogs = logger.logs.filter((l) => l.level === 'warn');
      const infoLogs = logger.logs.filter((l) => l.level === 'info');

      expect(errorLogs).toHaveLength(1);
      expect(warnLogs).toHaveLength(1);
      expect(infoLogs).toHaveLength(1);
      expect(errorLogs[0].message).toBe('Error message');
    });

    it('should capture log metadata correctly', () => {
      logger.debug('Debug msg', { debug: true });
      logger.info('Info msg', { info: true });
      logger.warn('Warning msg', { warning: true });

      const logs = logger.logs;
      expect(logs[0].context).toEqual({ debug: true });
      expect(logs[1].context).toEqual({ info: true });
      expect(logs[2].context).toEqual({ warning: true });
    });
  });
});
