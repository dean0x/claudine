import { describe, it, expect } from 'vitest';
import { ConfigurationSchema, loadConfiguration, type Configuration } from '../../src/core/configuration.js';

describe('ConfigurationSchema', () => {
  it('should validate valid configuration', () => {
    const validConfig = {
      timeout: 1800000,
      maxOutputBuffer: 10485760,
      cpuThreshold: 80,
      memoryReserve: 1073741824,
      logLevel: 'info' as const
    };

    const result = ConfigurationSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    
    if (result.success) {
      expect(result.data.timeout).toBe(1800000);
      expect(result.data.maxOutputBuffer).toBe(10485760);
      expect(result.data.cpuThreshold).toBe(80);
      expect(result.data.memoryReserve).toBe(1073741824);
      expect(result.data.logLevel).toBe('info');
    }
  });

  it('should reject timeout below minimum', () => {
    const invalidConfig = {
      timeout: 500, // Below 1 second minimum
      maxOutputBuffer: 10485760,
      cpuThreshold: 80,
      memoryReserve: 1073741824,
      logLevel: 'info' as const
    };

    const result = ConfigurationSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['timeout']);
      expect(result.error.issues[0].message).toContain('1000');
    }
  });

  it('should reject timeout above maximum', () => {
    const invalidConfig = {
      timeout: 24 * 60 * 60 * 1000 + 1, // Above 24 hours maximum
      maxOutputBuffer: 10485760,
      cpuThreshold: 80,
      memoryReserve: 1073741824,
      logLevel: 'info' as const
    };

    const result = ConfigurationSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['timeout']);
      expect(result.error.issues[0].message).toContain('86400000');
    }
  });

  it('should reject buffer size below minimum', () => {
    const invalidConfig = {
      timeout: 1800000,
      maxOutputBuffer: 500, // Below 1KB minimum
      cpuThreshold: 80,
      memoryReserve: 1073741824,
      logLevel: 'info' as const
    };

    const result = ConfigurationSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['maxOutputBuffer']);
      expect(result.error.issues[0].message).toContain('1024');
    }
  });

  it('should reject buffer size above maximum', () => {
    const invalidConfig = {
      timeout: 1800000,
      maxOutputBuffer: 1073741825, // Above 1GB maximum
      cpuThreshold: 80,
      memoryReserve: 1073741824,
      logLevel: 'info' as const
    };

    const result = ConfigurationSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['maxOutputBuffer']);
      expect(result.error.issues[0].message).toContain('1073741824');
    }
  });

  it('should reject invalid log level', () => {
    const invalidConfig = {
      timeout: 1800000,
      maxOutputBuffer: 10485760,
      cpuThreshold: 80,
      memoryReserve: 1073741824,
      logLevel: 'invalid' as any
    };

    const result = ConfigurationSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(['logLevel']);
    }
  });
});