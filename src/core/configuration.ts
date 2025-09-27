import { z } from 'zod';

export const ConfigurationSchema = z.object({
  timeout: z.number().min(1000).max(24 * 60 * 60 * 1000), // 1 second to 24 hours
  maxOutputBuffer: z.number().min(1024).max(1073741824), // 1KB to 1GB
  cpuCoresReserved: z.number().min(1), // Number of CPU cores to keep free
  memoryReserve: z.number().min(0),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  // EventBus resource limits - configurable for different environments
  maxListenersPerEvent: z.number().min(10).max(10000).optional(),
  maxTotalSubscriptions: z.number().min(100).max(100000).optional()
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
  cpuCoresReserved: 2, // Reserve 2 CPU cores for system stability
  memoryReserve: 2684354560, // 2.5GB - ensure adequate memory reserve for system stability
  logLevel: 'info',
  maxListenersPerEvent: 100, // Default: prevent memory leaks from excessive listeners
  maxTotalSubscriptions: 1000 // Default: global limit on subscriptions
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
    cpuCoresReserved: parseEnvNumber(process.env.CPU_CORES_RESERVED, DEFAULT_CONFIG.cpuCoresReserved),
    memoryReserve: parseEnvNumber(process.env.MEMORY_RESERVE, DEFAULT_CONFIG.memoryReserve),
    logLevel: parseEnvLogLevel(process.env.LOG_LEVEL),
    maxListenersPerEvent: parseEnvNumber(process.env.EVENTBUS_MAX_LISTENERS_PER_EVENT, DEFAULT_CONFIG.maxListenersPerEvent!),
    maxTotalSubscriptions: parseEnvNumber(process.env.EVENTBUS_MAX_TOTAL_SUBSCRIPTIONS, DEFAULT_CONFIG.maxTotalSubscriptions!)
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