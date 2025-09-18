import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConfigurationSchema,
  loadConfiguration,
  type Configuration,
  type TaskConfiguration
} from '../../../src/core/configuration';

describe('ConfigurationSchema - REAL Validation Behavior', () => {
  describe('Valid configurations', () => {
    it('should accept valid configuration', () => {
      const config = {
        timeout: 60000,
        maxOutputBuffer: 1048576,
        cpuThreshold: 80,
        memoryReserve: 1000000000,
        logLevel: 'info' as const
      };

      const result = ConfigurationSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it('should accept minimum valid values', () => {
      const config = {
        timeout: 1000,
        maxOutputBuffer: 1024,
        cpuThreshold: 1,
        memoryReserve: 0,
        logLevel: 'debug' as const
      };

      const result = ConfigurationSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept maximum valid values', () => {
      const config = {
        timeout: 24 * 60 * 60 * 1000, // 24 hours
        maxOutputBuffer: 1073741824,   // 1GB
        cpuThreshold: 100,
        memoryReserve: Number.MAX_SAFE_INTEGER,
        logLevel: 'error' as const
      };

      const result = ConfigurationSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept all valid log levels', () => {
      const logLevels = ['debug', 'info', 'warn', 'error'] as const;

      logLevels.forEach(level => {
        const config = {
          timeout: 30000,
          maxOutputBuffer: 1048576,
          cpuThreshold: 80,
          memoryReserve: 1000000000,
          logLevel: level
        };

        const result = ConfigurationSchema.safeParse(config);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Invalid configurations', () => {
    it('should reject timeout below minimum', () => {
      const config = {
        timeout: 999,
        maxOutputBuffer: 1048576,
        cpuThreshold: 80,
        memoryReserve: 1000000000,
        logLevel: 'info' as const
      };

      const result = ConfigurationSchema.safeParse(config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('timeout');
      }
    });

    it('should reject timeout above maximum', () => {
      const config = {
        timeout: 24 * 60 * 60 * 1000 + 1,
        maxOutputBuffer: 1048576,
        cpuThreshold: 80,
        memoryReserve: 1000000000,
        logLevel: 'info' as const
      };

      const result = ConfigurationSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it('should reject invalid maxOutputBuffer', () => {
      const invalidBuffers = [
        1023,         // Below minimum
        1073741825,   // Above maximum
        -1,           // Negative
        0             // Zero
      ];

      invalidBuffers.forEach(buffer => {
        const config = {
          timeout: 30000,
          maxOutputBuffer: buffer,
          cpuThreshold: 80,
          memoryReserve: 1000000000,
          logLevel: 'info' as const
        };

        const result = ConfigurationSchema.safeParse(config);
        expect(result.success).toBe(false);
      });
    });

    it('should reject invalid CPU thresholds', () => {
      const invalidThresholds = [0, -1, 101, 200];

      invalidThresholds.forEach(threshold => {
        const config = {
          timeout: 30000,
          maxOutputBuffer: 1048576,
          cpuThreshold: threshold,
          memoryReserve: 1000000000,
          logLevel: 'info' as const
        };

        const result = ConfigurationSchema.safeParse(config);
        expect(result.success).toBe(false);
      });
    });

    it('should reject negative memory reserve', () => {
      const config = {
        timeout: 30000,
        maxOutputBuffer: 1048576,
        cpuThreshold: 80,
        memoryReserve: -1,
        logLevel: 'info' as const
      };

      const result = ConfigurationSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it('should reject invalid log levels', () => {
      const invalidLevels = ['trace', 'verbose', 'DEBUG', 'INFO', 'invalid', ''];

      invalidLevels.forEach(level => {
        const config = {
          timeout: 30000,
          maxOutputBuffer: 1048576,
          cpuThreshold: 80,
          memoryReserve: 1000000000,
          logLevel: level
        };

        const result = ConfigurationSchema.safeParse(config);
        expect(result.success).toBe(false);
      });
    });

    it('should reject non-numeric values', () => {
      const config = {
        timeout: '30000' as any,
        maxOutputBuffer: 'large' as any,
        cpuThreshold: true as any,
        memoryReserve: null as any,
        logLevel: 'info'
      };

      const result = ConfigurationSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const partialConfigs = [
        { timeout: 30000 },
        { maxOutputBuffer: 1048576 },
        { cpuThreshold: 80 },
        { memoryReserve: 1000000000 },
        { logLevel: 'info' },
        {}
      ];

      partialConfigs.forEach(partial => {
        const result = ConfigurationSchema.safeParse(partial);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      const config: Configuration = {
        timeout: 30000,
        maxOutputBuffer: 1048576,
        cpuThreshold: 80,
        memoryReserve: 1000000000,
        logLevel: 'info'
      };

      // Type checks (these would fail compilation if types were wrong)
      const timeout: number = config.timeout;
      const buffer: number = config.maxOutputBuffer;
      const cpu: number = config.cpuThreshold;
      const memory: number = config.memoryReserve;
      const level: 'debug' | 'info' | 'warn' | 'error' = config.logLevel;

      expect(timeout).toBe(30000);
      expect(buffer).toBe(1048576);
      expect(cpu).toBe(80);
      expect(memory).toBe(1000000000);
      expect(level).toBe('info');
    });
  });
});

describe('loadConfiguration - REAL Configuration Loading', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear relevant env vars
    delete process.env.TASK_TIMEOUT;
    delete process.env.MAX_OUTPUT_BUFFER;
    delete process.env.CPU_THRESHOLD;
    delete process.env.MEMORY_RESERVE;
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Default configuration', () => {
    it('should load defaults when no environment variables set', () => {
      const config = loadConfiguration();

      expect(config).toEqual({
        timeout: 1800000,        // 30 minutes
        maxOutputBuffer: 10485760, // 10MB
        cpuThreshold: 95,
        memoryReserve: 100000000, // 100MB
        logLevel: 'info'
      });
    });
  });

  describe('Environment variable loading', () => {
    it('should load configuration from environment', () => {
      process.env.TASK_TIMEOUT = '60000';
      process.env.MAX_OUTPUT_BUFFER = '2097152';
      process.env.CPU_THRESHOLD = '70';
      process.env.MEMORY_RESERVE = '2000000000';
      process.env.LOG_LEVEL = 'debug';

      const config = loadConfiguration();

      expect(config).toEqual({
        timeout: 60000,
        maxOutputBuffer: 2097152,
        cpuThreshold: 70,
        memoryReserve: 2000000000,
        logLevel: 'debug'
      });
    });

    it('should handle partial environment configuration', () => {
      process.env.TASK_TIMEOUT = '120000';
      process.env.LOG_LEVEL = 'warn';

      const config = loadConfiguration();

      expect(config.timeout).toBe(120000);
      expect(config.logLevel).toBe('warn');
      expect(config.maxOutputBuffer).toBe(10485760); // Default
      expect(config.cpuThreshold).toBe(95);          // Default
      expect(config.memoryReserve).toBe(100000000);  // Default
    });

    it('should handle invalid number parsing', () => {
      process.env.TASK_TIMEOUT = 'not-a-number';
      process.env.MAX_OUTPUT_BUFFER = 'abc';
      process.env.CPU_THRESHOLD = '';
      process.env.MEMORY_RESERVE = 'null';

      const config = loadConfiguration();

      // Should use defaults for invalid numbers
      expect(config.timeout).toBe(1800000);
      expect(config.maxOutputBuffer).toBe(10485760);
      expect(config.cpuThreshold).toBe(95);
      expect(config.memoryReserve).toBe(100000000);
    });

    it('should handle invalid log level', () => {
      process.env.LOG_LEVEL = 'INVALID';

      const config = loadConfiguration();

      expect(config.logLevel).toBe('info'); // Default
    });

    it('should handle case-sensitive log levels', () => {
      process.env.LOG_LEVEL = 'DEBUG'; // Uppercase

      const config = loadConfiguration();

      expect(config.logLevel).toBe('info'); // Falls back to default
    });
  });

  describe('Validation fallback', () => {
    it('should fallback to defaults on invalid timeout', () => {
      process.env.TASK_TIMEOUT = '500'; // Below minimum

      const config = loadConfiguration();

      expect(config.timeout).toBe(1800000); // Default
    });

    it('should fallback to defaults on invalid CPU threshold', () => {
      process.env.CPU_THRESHOLD = '150'; // Above maximum

      const config = loadConfiguration();

      expect(config.cpuThreshold).toBe(95); // Default
    });

    it('should fallback to defaults on invalid memory reserve', () => {
      process.env.MEMORY_RESERVE = '-1000'; // Negative

      const config = loadConfiguration();

      expect(config.memoryReserve).toBe(100000000); // Default
    });

    it('should fallback to all defaults on any validation failure', () => {
      // One invalid value causes entire config to fallback
      process.env.TASK_TIMEOUT = '30000';     // Valid
      process.env.CPU_THRESHOLD = '80';       // Valid
      process.env.MEMORY_RESERVE = '-1';      // Invalid!
      process.env.LOG_LEVEL = 'debug';        // Valid

      const config = loadConfiguration();

      // All values should be defaults due to validation failure
      expect(config).toEqual({
        timeout: 1800000,
        maxOutputBuffer: 10485760,
        cpuThreshold: 95,
        memoryReserve: 100000000,
        logLevel: 'info'
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle float values by truncating', () => {
      process.env.TASK_TIMEOUT = '30000.999';
      process.env.CPU_THRESHOLD = '80.5';

      const config = loadConfiguration();

      expect(config.timeout).toBe(30000);
      expect(config.cpuThreshold).toBe(80);
    });

    it('should handle very large numbers', () => {
      process.env.MEMORY_RESERVE = String(Number.MAX_SAFE_INTEGER);

      const config = loadConfiguration();

      expect(config.memoryReserve).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle zero values appropriately', () => {
      process.env.MEMORY_RESERVE = '0'; // Valid (minimum is 0)

      const config = loadConfiguration();

      expect(config.memoryReserve).toBe(0);
    });

    it('should handle whitespace in environment variables', () => {
      process.env.TASK_TIMEOUT = '  60000  ';
      process.env.LOG_LEVEL = '  debug  ';

      const config = loadConfiguration();

      expect(config.timeout).toBe(60000);
      expect(config.logLevel).toBe('info'); // Doesn't trim, so invalid
    });
  });

  describe('Configuration consistency', () => {
    it('should always return valid configuration', () => {
      // Try many different invalid combinations
      const invalidConfigs = [
        { TASK_TIMEOUT: '-1', CPU_THRESHOLD: '200' },
        { MAX_OUTPUT_BUFFER: '0', MEMORY_RESERVE: '-999' },
        { LOG_LEVEL: '123', TASK_TIMEOUT: 'infinity' },
        { CPU_THRESHOLD: 'NaN', MEMORY_RESERVE: 'undefined' }
      ];

      invalidConfigs.forEach(envVars => {
        process.env = { ...originalEnv, ...envVars };

        const config = loadConfiguration();

        // Should always return valid config (defaults)
        const validation = ConfigurationSchema.safeParse(config);
        expect(validation.success).toBe(true);
      });
    });

    it('should be deterministic', () => {
      process.env.TASK_TIMEOUT = '45000';
      process.env.LOG_LEVEL = 'warn';

      const config1 = loadConfiguration();
      const config2 = loadConfiguration();

      expect(config1).toEqual(config2);
    });
  });
});

describe('TaskConfiguration - Interface Testing', () => {
  it('should allow partial configuration', () => {
    const taskConfig: TaskConfiguration = {
      timeout: 60000
    };

    expect(taskConfig.timeout).toBe(60000);
    expect(taskConfig.maxOutputBuffer).toBeUndefined();
  });

  it('should allow empty configuration', () => {
    const taskConfig: TaskConfiguration = {};

    expect(taskConfig.timeout).toBeUndefined();
    expect(taskConfig.maxOutputBuffer).toBeUndefined();
  });

  it('should be readonly', () => {
    const taskConfig: TaskConfiguration = {
      timeout: 60000,
      maxOutputBuffer: 1048576
    };

    // TypeScript would prevent these at compile time
    // @ts-expect-error - Testing readonly
    expect(() => { taskConfig.timeout = 30000; }).toThrow();
  });
});

describe('Real-world configuration scenarios', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should handle production configuration', () => {
    process.env.TASK_TIMEOUT = '3600000';     // 1 hour
    process.env.MAX_OUTPUT_BUFFER = '52428800'; // 50MB
    process.env.CPU_THRESHOLD = '80';
    process.env.MEMORY_RESERVE = '2147483648'; // 2GB
    process.env.LOG_LEVEL = 'error';

    const config = loadConfiguration();

    expect(config.timeout).toBe(3600000);
    expect(config.maxOutputBuffer).toBe(52428800);
    expect(config.cpuThreshold).toBe(80);
    expect(config.memoryReserve).toBe(2147483648);
    expect(config.logLevel).toBe('error');
  });

  it('should handle development configuration', () => {
    process.env.TASK_TIMEOUT = '5000';        // 5 seconds
    process.env.MAX_OUTPUT_BUFFER = '1048576'; // 1MB
    process.env.CPU_THRESHOLD = '95';
    process.env.MEMORY_RESERVE = '100000000';  // 100MB
    process.env.LOG_LEVEL = 'debug';

    const config = loadConfiguration();

    expect(config.timeout).toBe(5000);
    expect(config.maxOutputBuffer).toBe(1048576);
    expect(config.cpuThreshold).toBe(95);
    expect(config.memoryReserve).toBe(100000000);
    expect(config.logLevel).toBe('debug');
  });

  it('should handle CI/CD configuration', () => {
    process.env.TASK_TIMEOUT = '600000';      // 10 minutes
    process.env.MAX_OUTPUT_BUFFER = '10485760'; // 10MB
    process.env.CPU_THRESHOLD = '90';
    process.env.MEMORY_RESERVE = '500000000';   // 500MB
    process.env.LOG_LEVEL = 'info';

    const config = loadConfiguration();

    expect(config).toMatchObject({
      timeout: 600000,
      maxOutputBuffer: 10485760,
      cpuThreshold: 90,
      memoryReserve: 500000000,
      logLevel: 'info'
    });
  });
});