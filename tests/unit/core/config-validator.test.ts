/**
 * Tests for component-level configuration validation
 *
 * TESTING PHILOSOPHY: Behavioral tests
 * - Test validation warnings are generated for problematic configs
 * - Test no warnings for valid configs
 * - Test severity levels (warning vs info)
 * - Test recommendations are helpful
 */

import os from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigValidationWarning,
  formatValidationWarnings,
  validateConfiguration,
} from '../../../src/core/config-validator.js';
import { Configuration } from '../../../src/core/configuration.js';
import { createTestConfiguration } from '../../fixtures/factories.js';

describe('Component-Level Configuration Validation', () => {
  // Mock system resources for consistent testing
  beforeEach(() => {
    vi.spyOn(os, 'cpus').mockReturnValue(
      new Array(8).fill({
        model: 'test',
        speed: 2400,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      }) as os.CpuInfo[],
    );
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * 1024 * 1024 * 1024); // 16GB
    vi.spyOn(os, 'freemem').mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB free
  });

  describe('CPU Configuration Validation', () => {
    it('should warn when reserved cores exceed available cores', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 16, // More than 8 available
      });

      const warnings = validateConfiguration(config);
      const cpuWarning = warnings.find((w) => w.field === 'cpuCoresReserved');

      expect(cpuWarning).toBeDefined();
      expect(cpuWarning!.severity).toBe('warning');
      expect(cpuWarning!.message).toContain('exceeds available cores');
      expect(cpuWarning!.recommendedValue).toBeDefined();
      expect(cpuWarning!.recommendedValue).toBeLessThanOrEqual(8);
    });

    it('should info when reserving >50% of cores', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 5, // 62.5% of 8 cores
      });

      const warnings = validateConfiguration(config);
      const cpuWarning = warnings.find((w) => w.field === 'cpuCoresReserved' && w.message.includes('%'));

      expect(cpuWarning).toBeDefined();
      expect(cpuWarning!.severity).toBe('info');
      expect(cpuWarning!.currentValue).toBe(5);
    });

    it('should info when only 1 core reserved on multi-core system', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 1, // Too low for 8-core system
      });

      const warnings = validateConfiguration(config);
      const cpuWarning = warnings.find((w) => w.field === 'cpuCoresReserved' && w.message.includes('Only 1 core'));

      expect(cpuWarning).toBeDefined();
      expect(cpuWarning!.severity).toBe('info');
      expect(cpuWarning!.recommendedValue).toBe(2);
    });

    it('should not warn for reasonable CPU reservation', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 2, // 25% of 8 cores - reasonable
      });

      const warnings = validateConfiguration(config);
      const cpuWarnings = warnings.filter((w) => w.field === 'cpuCoresReserved');

      expect(cpuWarnings).toHaveLength(0);
    });
  });

  describe('Memory Configuration Validation', () => {
    it('should warn when memory reserve exceeds total memory', () => {
      const config = createTestConfiguration({
        memoryReserve: 32 * 1024 * 1024 * 1024, // 32GB > 16GB available
      });

      const warnings = validateConfiguration(config);
      const memWarning = warnings.find((w) => w.field === 'memoryReserve');

      expect(memWarning).toBeDefined();
      expect(memWarning!.severity).toBe('warning');
      expect(memWarning!.message).toContain('exceeds total system memory');
      expect(memWarning!.recommendedValue).toBeDefined();
    });

    it('should info when reserving >40% of memory', () => {
      const config = createTestConfiguration({
        memoryReserve: 8 * 1024 * 1024 * 1024, // 8GB = 50% of 16GB
      });

      const warnings = validateConfiguration(config);
      const memWarning = warnings.find((w) => w.field === 'memoryReserve' && w.message.includes('%'));

      expect(memWarning).toBeDefined();
      expect(memWarning!.severity).toBe('info');
    });

    it('should warn when memory reserve is too low (<500MB)', () => {
      const config = createTestConfiguration({
        memoryReserve: 256 * 1024 * 1024, // 256MB - too low
      });

      const warnings = validateConfiguration(config);
      const memWarning = warnings.find((w) => w.field === 'memoryReserve' && w.message.includes('very low'));

      expect(memWarning).toBeDefined();
      expect(memWarning!.severity).toBe('warning');
      expect(memWarning!.recommendedValue).toBeGreaterThanOrEqual(1024 * 1024 * 1024);
    });

    it('should not warn for reasonable memory reservation', () => {
      const config = createTestConfiguration({
        memoryReserve: 2 * 1024 * 1024 * 1024, // 2GB = 12.5% of 16GB
      });

      const warnings = validateConfiguration(config);
      const memWarnings = warnings.filter((w) => w.field === 'memoryReserve');

      expect(memWarnings).toHaveLength(0);
    });
  });

  describe('Timeout Configuration Validation', () => {
    it('should info when timeout is very low (<5 minutes)', () => {
      const config = createTestConfiguration({
        timeout: 2 * 60 * 1000, // 2 minutes
      });

      const warnings = validateConfiguration(config);
      const timeoutWarning = warnings.find((w) => w.field === 'timeout');

      expect(timeoutWarning).toBeDefined();
      expect(timeoutWarning!.severity).toBe('info');
      expect(timeoutWarning!.message).toContain('low');
    });

    it('should info when timeout is at security maximum', () => {
      const config = createTestConfiguration({
        timeout: 60 * 60 * 1000, // 1 hour = maximum
      });

      const warnings = validateConfiguration(config);
      const timeoutWarning = warnings.find((w) => w.field === 'timeout');

      expect(timeoutWarning).toBeDefined();
      expect(timeoutWarning!.severity).toBe('info');
      expect(timeoutWarning!.message).toContain('maximum');
    });

    it('should not warn for reasonable timeout (5-60 minutes)', () => {
      const config = createTestConfiguration({
        timeout: 30 * 60 * 1000, // 30 minutes - sweet spot
      });

      const warnings = validateConfiguration(config);
      const timeoutWarnings = warnings.filter((w) => w.field === 'timeout');

      expect(timeoutWarnings).toHaveLength(0);
    });
  });

  describe('EventBus Configuration Validation', () => {
    it('should warn when maxListenersPerEvent is too low', () => {
      const config = createTestConfiguration({
        maxListenersPerEvent: 25, // Too low
      });

      const warnings = validateConfiguration(config);
      const listenerWarning = warnings.find((w) => w.field === 'maxListenersPerEvent');

      expect(listenerWarning).toBeDefined();
      expect(listenerWarning!.severity).toBe('warning');
      expect(listenerWarning!.recommendedValue).toBe(100);
    });

    it('should warn when maxTotalSubscriptions is too low', () => {
      const config = createTestConfiguration({
        maxTotalSubscriptions: 300, // Too low
      });

      const warnings = validateConfiguration(config);
      const subWarning = warnings.find((w) => w.field === 'maxTotalSubscriptions');

      expect(subWarning).toBeDefined();
      expect(subWarning!.severity).toBe('warning');
      expect(subWarning!.recommendedValue).toBe(1000);
    });

    it('should not warn for reasonable EventBus limits', () => {
      const config = createTestConfiguration({
        maxListenersPerEvent: 100,
        maxTotalSubscriptions: 1000,
      });

      const warnings = validateConfiguration(config);
      const eventBusWarnings = warnings.filter(
        (w) => w.field === 'maxListenersPerEvent' || w.field === 'maxTotalSubscriptions',
      );

      expect(eventBusWarnings).toHaveLength(0);
    });
  });

  describe('Output Configuration Validation', () => {
    it('should info when output buffer is very large (>100MB)', () => {
      const config = createTestConfiguration({
        maxOutputBuffer: 200 * 1024 * 1024, // 200MB
      });

      const warnings = validateConfiguration(config);
      const bufferWarning = warnings.find((w) => w.field === 'maxOutputBuffer');

      expect(bufferWarning).toBeDefined();
      expect(bufferWarning!.severity).toBe('info');
      expect(bufferWarning!.message).toContain('large');
    });

    it('should info when file storage threshold is high (>10MB)', () => {
      const config = createTestConfiguration({
        fileStorageThresholdBytes: 20 * 1024 * 1024, // 20MB
      });

      const warnings = validateConfiguration(config);
      const thresholdWarning = warnings.find((w) => w.field === 'fileStorageThresholdBytes');

      expect(thresholdWarning).toBeDefined();
      expect(thresholdWarning!.severity).toBe('info');
    });

    it('should not warn for reasonable output config', () => {
      const config = createTestConfiguration({
        maxOutputBuffer: 10 * 1024 * 1024, // 10MB
        fileStorageThresholdBytes: 100 * 1024, // 100KB
      });

      const warnings = validateConfiguration(config);
      const outputWarnings = warnings.filter(
        (w) => w.field === 'maxOutputBuffer' || w.field === 'fileStorageThresholdBytes',
      );

      expect(outputWarnings).toHaveLength(0);
    });
  });

  describe('Comprehensive Validation', () => {
    it('should return no warnings for optimal configuration', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 2,
        memoryReserve: 2 * 1024 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
        maxOutputBuffer: 10 * 1024 * 1024,
        maxListenersPerEvent: 100,
        maxTotalSubscriptions: 1000,
        fileStorageThresholdBytes: 100 * 1024,
      });

      const warnings = validateConfiguration(config);

      expect(warnings).toHaveLength(0);
    });

    it('should return multiple warnings for problematic configuration', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 16, // Too high
        memoryReserve: 32 * 1024 * 1024 * 1024, // Way too high
        timeout: 1 * 60 * 1000, // Too low
        maxListenersPerEvent: 10, // Too low
      });

      const warnings = validateConfiguration(config);

      expect(warnings.length).toBeGreaterThanOrEqual(4);
      expect(warnings.some((w) => w.field === 'cpuCoresReserved')).toBe(true);
      expect(warnings.some((w) => w.field === 'memoryReserve')).toBe(true);
      expect(warnings.some((w) => w.field === 'timeout')).toBe(true);
      expect(warnings.some((w) => w.field === 'maxListenersPerEvent')).toBe(true);
    });

    it('should categorize warnings by severity correctly', () => {
      const config = createTestConfiguration({
        cpuCoresReserved: 16, // WARNING - exceeds available
        memoryReserve: 8 * 1024 * 1024 * 1024, // INFO - high but not exceeding
      });

      const warnings = validateConfiguration(config);
      const warningCount = warnings.filter((w) => w.severity === 'warning').length;
      const infoCount = warnings.filter((w) => w.severity === 'info').length;

      expect(warningCount).toBeGreaterThanOrEqual(1);
      expect(infoCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Warning Formatting', () => {
    it('should format zero warnings with success message', () => {
      const formatted = formatValidationWarnings([]);

      expect(formatted).toContain('✅');
      expect(formatted).toContain('no warnings');
    });

    it('should format warnings with icons and suggestions', () => {
      const warnings: ConfigValidationWarning[] = [
        {
          field: 'cpuCoresReserved',
          severity: 'warning',
          message: 'Too many cores',
          suggestion: 'Reduce to 2',
          currentValue: 16,
          recommendedValue: 2,
        },
        {
          field: 'timeout',
          severity: 'info',
          message: 'Timeout is high',
          suggestion: 'Consider 30 minutes',
          currentValue: 3600000,
        },
      ];

      const formatted = formatValidationWarnings(warnings);

      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('ℹ️');
      expect(formatted).toContain('cpuCoresReserved');
      expect(formatted).toContain('timeout');
      expect(formatted).toContain('Too many cores');
      expect(formatted).toContain('💡');
      expect(formatted).toContain('Reduce to 2');
      expect(formatted).toContain('Current: 16');
      expect(formatted).toContain('Recommended: 2');
    });

    it('should include warning count in header', () => {
      const warnings: ConfigValidationWarning[] = [
        {
          field: 'test1',
          severity: 'warning',
          message: 'Test',
          suggestion: 'Fix it',
          currentValue: 1,
        },
        {
          field: 'test2',
          severity: 'info',
          message: 'Test',
          suggestion: 'Fix it',
          currentValue: 2,
        },
      ];

      const formatted = formatValidationWarnings(warnings);

      expect(formatted).toContain('2 warning(s)');
    });
  });
});
