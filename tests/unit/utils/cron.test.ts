/**
 * Unit tests for cron utilities
 * ARCHITECTURE: Pure function tests - no side effects, no database
 * Pattern: Result pattern validation for all functions
 */

import { describe, it, expect } from 'vitest';
import {
  validateCronExpression,
  getNextRunTime,
  getNextRunTimes,
  isValidTimezone,
  validateTimezone,
  parseCronExpression,
} from '../../../src/utils/cron.js';

describe('Cron Utilities - Unit Tests', () => {
  describe('validateCronExpression()', () => {
    it('should accept valid 5-field cron expressions', () => {
      const validExpressions = [
        '* * * * *',        // Every minute
        '0 * * * *',        // Every hour
        '0 9 * * *',        // 9am daily
        '0 9 * * 1-5',      // 9am weekdays
        '0 0 1 * *',        // Midnight on 1st of month
        '*/5 * * * *',      // Every 5 minutes
        '0,15,30,45 * * * *', // Every 15 minutes
        '0 2 * * 0',        // 2am on Sundays
      ];

      for (const expr of validExpressions) {
        const result = validateCronExpression(expr);
        expect(result.ok, `Expression "${expr}" should be valid`).toBe(true);
      }
    });

    it('should reject invalid cron expressions', () => {
      const invalidExpressions = [
        'not-a-cron',       // Not a cron expression
        '60 * * * *',       // Invalid minute (0-59)
        '* 24 * * *',       // Invalid hour (0-23)
        '* * 32 * *',       // Invalid day (1-31)
        '* * * 13 *',       // Invalid month (1-12)
        '* * * * 8',        // Invalid weekday (0-7)
      ];

      for (const expr of invalidExpressions) {
        const result = validateCronExpression(expr);
        expect(result.ok, `Expression "${expr}" should be invalid`).toBe(false);
      }
    });

    it('should return error with context for invalid expression', () => {
      const result = validateCronExpression('not-a-cron');

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('Invalid cron expression');
    });
  });

  describe('getNextRunTime()', () => {
    it('should calculate next run time for simple expression', () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const result = getNextRunTime('0 11 * * *', 'UTC', now);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Next 11:00 UTC should be the same day
      const nextRun = new Date(result.value);
      expect(nextRun.getUTCHours()).toBe(11);
      expect(nextRun.getUTCMinutes()).toBe(0);
    });

    it('should respect timezone', () => {
      const now = new Date('2025-01-15T10:00:00Z');

      // 9am in New York = 2pm UTC in winter (EST = UTC-5)
      const result = getNextRunTime('0 9 * * *', 'America/New_York', now);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should return a future time
      expect(result.value).toBeGreaterThan(now.getTime());
    });

    it('should handle invalid cron expression', () => {
      const result = getNextRunTime('invalid', 'UTC');

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('should handle every-minute expression', () => {
      const now = new Date('2025-01-15T10:30:00Z');
      const result = getNextRunTime('* * * * *', 'UTC', now);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Next minute
      const nextRun = new Date(result.value);
      expect(nextRun.getUTCMinutes()).toBe(31);
    });
  });

  describe('getNextRunTimes()', () => {
    it('should return multiple future run times', () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const result = getNextRunTimes('0 * * * *', 'UTC', 5, now);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(5);

      // All times should be in ascending order
      for (let i = 1; i < result.value.length; i++) {
        expect(result.value[i]).toBeGreaterThan(result.value[i - 1]);
      }
    });

    it('should default to 5 run times', () => {
      const result = getNextRunTimes('0 12 * * *', 'UTC');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(5);
    });

    it('should handle invalid expression', () => {
      const result = getNextRunTimes('invalid', 'UTC');

      expect(result.ok).toBe(false);
    });
  });

  describe('isValidTimezone()', () => {
    it('should accept valid IANA timezones', () => {
      const validTimezones = [
        'UTC',
        'America/New_York',
        'America/Los_Angeles',
        'Europe/London',
        'Europe/Paris',
        'Asia/Tokyo',
        'Australia/Sydney',
        'Pacific/Auckland',
      ];

      for (const tz of validTimezones) {
        expect(isValidTimezone(tz), `Timezone "${tz}" should be valid`).toBe(true);
      }
    });

    it('should reject invalid timezones', () => {
      const invalidTimezones = [
        'Invalid/Zone',
        'NotATimezone',
        'US/Fake',
        '',
        'GMT+5',  // Not a valid IANA identifier
      ];

      for (const tz of invalidTimezones) {
        expect(isValidTimezone(tz), `Timezone "${tz}" should be invalid`).toBe(false);
      }
    });
  });

  describe('validateTimezone()', () => {
    it('should return ok for valid timezone', () => {
      const result = validateTimezone('America/New_York');
      expect(result.ok).toBe(true);
    });

    it('should return error for invalid timezone', () => {
      const result = validateTimezone('Invalid/Zone');

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('Invalid timezone');
    });
  });

  describe('parseCronExpression()', () => {
    it('should return parsed interval for valid expression', () => {
      const result = parseCronExpression('0 9 * * *', 'UTC');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The returned object should have next() method
      expect(typeof result.value.next).toBe('function');
    });

    it('should allow iterating over multiple occurrences', () => {
      const result = parseCronExpression('0 * * * *', 'UTC');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const first = result.value.next();
      const second = result.value.next();

      expect(second.getTime()).toBeGreaterThan(first.getTime());
    });

    it('should handle invalid expression', () => {
      const result = parseCronExpression('invalid', 'UTC');

      expect(result.ok).toBe(false);
    });
  });
});
