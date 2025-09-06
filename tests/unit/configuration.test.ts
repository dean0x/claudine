import { describe, it, expect } from 'vitest';
import { ConfigurationSchema, loadConfiguration, type Configuration, type TaskConfiguration } from '../../src/core/configuration.js';
import { TEST_CONSTANTS } from '../helpers/test-factories.js';

describe('ConfigurationSchema', () => {
  it('should validate valid configuration', () => {
    const validConfig = {
      timeout: TEST_CONSTANTS.THIRTY_MINUTES_MS,
      maxOutputBuffer: TEST_CONSTANTS.TEN_MB,
      cpuThreshold: 95,
      memoryReserve: TEST_CONSTANTS.ONE_GB,
      logLevel: 'info' as const
    };

    const result = ConfigurationSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    
    if (result.success) {
      expect(result.data.timeout).toBe(TEST_CONSTANTS.THIRTY_MINUTES_MS);
      expect(result.data.maxOutputBuffer).toBe(TEST_CONSTANTS.TEN_MB);
      expect(result.data.cpuThreshold).toBe(95);
      expect(result.data.memoryReserve).toBe(TEST_CONSTANTS.ONE_GB);
      expect(result.data.logLevel).toBe('info');
    }
  });

  it('should reject timeout below minimum', () => {
    const invalidConfig = {
      timeout: TEST_CONSTANTS.FIVE_HUNDRED_BYTES, // Below 1 second minimum
      maxOutputBuffer: TEST_CONSTANTS.TEN_MB,
      cpuThreshold: 80,
      memoryReserve: TEST_CONSTANTS.ONE_GB,
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
      expect(config.cpuThreshold).toBe(95); // 95% default (more permissive for dev)
      expect(config.memoryReserve).toBe(100000000); // 100MB default (lower for dev)
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
      expect(config.cpuThreshold).toBe(95); // Default 95% (dev-friendly)
      expect(config.memoryReserve).toBe(100000000); // Default 100MB (dev-friendly)
      expect(config.logLevel).toBe('info'); // Default info
    } finally {
      process.env = originalEnv;
    }
  });
});

describe('TaskConfiguration', () => {
  it('should validate partial task configuration', () => {
    const taskConfig: TaskConfiguration = {
      timeout: 3600000 // 1 hour
    };

    expect(taskConfig.timeout).toBe(3600000);
    expect(taskConfig.maxOutputBuffer).toBeUndefined();
  });

  it('should validate full task configuration', () => {
    const taskConfig: TaskConfiguration = {
      timeout: 3600000, // 1 hour
      maxOutputBuffer: 20971520 // 20MB
    };

    expect(taskConfig.timeout).toBe(3600000);
    expect(taskConfig.maxOutputBuffer).toBe(20971520);
  });
});