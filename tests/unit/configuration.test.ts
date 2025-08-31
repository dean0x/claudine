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

describe('loadConfiguration', () => {
  it('should load default configuration when no environment variables or config file', () => {
    // Mock process.env to be empty for this test
    const originalEnv = process.env;
    process.env = {};

    try {
      const config = loadConfiguration();
      
      expect(config.timeout).toBe(1800000); // 30 minutes default
      expect(config.maxOutputBuffer).toBe(10485760); // 10MB default
      expect(config.cpuThreshold).toBe(80); // 80% default
      expect(config.memoryReserve).toBe(1073741824); // 1GB default
      expect(config.logLevel).toBe('info'); // info default
    } finally {
      process.env = originalEnv;
    }
  });

  it('should load configuration from environment variables', () => {
    const originalEnv = process.env;
    process.env = {
      TASK_TIMEOUT: '3600000', // 1 hour
      MAX_OUTPUT_BUFFER: '20971520', // 20MB
      CPU_THRESHOLD: '90', // 90%
      MEMORY_RESERVE: '2147483648', // 2GB
      LOG_LEVEL: 'debug'
    };

    try {
      const config = loadConfiguration();
      
      expect(config.timeout).toBe(3600000); // 1 hour
      expect(config.maxOutputBuffer).toBe(20971520); // 20MB
      expect(config.cpuThreshold).toBe(90); // 90%
      expect(config.memoryReserve).toBe(2147483648); // 2GB
      expect(config.logLevel).toBe('debug'); // debug
    } finally {
      process.env = originalEnv;
    }
  });

  it('should fallback to defaults for invalid environment values', () => {
    const originalEnv = process.env;
    process.env = {
      TASK_TIMEOUT: 'invalid',
      MAX_OUTPUT_BUFFER: 'not-a-number',
      CPU_THRESHOLD: '200', // Above max
      MEMORY_RESERVE: '-100', // Below min
      LOG_LEVEL: 'invalid-level'
    };

    try {
      const config = loadConfiguration();
      
      // Should fallback to defaults for invalid values
      expect(config.timeout).toBe(1800000); // Default 30 minutes
      expect(config.maxOutputBuffer).toBe(10485760); // Default 10MB
      expect(config.cpuThreshold).toBe(80); // Default 80%
      expect(config.memoryReserve).toBe(1073741824); // Default 1GB
      expect(config.logLevel).toBe('info'); // Default info
    } finally {
      process.env = originalEnv;
    }
  });
});