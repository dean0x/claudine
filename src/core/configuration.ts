import { z } from 'zod';

export const ConfigurationSchema = z.object({
  timeout: z.number().min(1000).max(24 * 60 * 60 * 1000), // 1 second to 24 hours
  maxOutputBuffer: z.number().min(1024).max(1073741824), // 1KB to 1GB
  cpuThreshold: z.number().min(1).max(100),
  memoryReserve: z.number().min(0),
  logLevel: z.enum(['debug', 'info', 'warn', 'error'])
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

// Per-task configuration (partial override)
export interface TaskConfiguration {
  readonly timeout?: number;
  readonly maxOutputBuffer?: number;
}

const DEFAULT_CONFIG: Configuration = {
  timeout: 1800000, // 30 minutes
  maxOutputBuffer: 10485760, // 10MB
  cpuThreshold: 80, // 80%
  memoryReserve: 1073741824, // 1GB
  logLevel: 'info'
};

function parseEnvNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseEnvLogLevel(value: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  if (!value) return 'info';
  return ['debug', 'info', 'warn', 'error'].includes(value) 
    ? value as 'debug' | 'info' | 'warn' | 'error'
    : 'info';
}

export function loadConfiguration(): Configuration {
  // Load from environment variables, fallback to defaults
  const envConfig = {
    timeout: parseEnvNumber(process.env.TASK_TIMEOUT, DEFAULT_CONFIG.timeout),
    maxOutputBuffer: parseEnvNumber(process.env.MAX_OUTPUT_BUFFER, DEFAULT_CONFIG.maxOutputBuffer),
    cpuThreshold: parseEnvNumber(process.env.CPU_THRESHOLD, DEFAULT_CONFIG.cpuThreshold),
    memoryReserve: parseEnvNumber(process.env.MEMORY_RESERVE, DEFAULT_CONFIG.memoryReserve),
    logLevel: parseEnvLogLevel(process.env.LOG_LEVEL)
  };

  // Validate the configuration and fallback to defaults if invalid
  const parseResult = ConfigurationSchema.safeParse(envConfig);
  
  if (parseResult.success) {
    return parseResult.data;
  } else {
    // If validation fails, fallback to defaults
    return { ...DEFAULT_CONFIG };
  }
}