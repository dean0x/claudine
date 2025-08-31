import { z } from 'zod';

export const ConfigurationSchema = z.object({
  timeout: z.number().min(1000).max(24 * 60 * 60 * 1000), // 1 second to 24 hours
  maxOutputBuffer: z.number().min(1024).max(1073741824), // 1KB to 1GB
  cpuThreshold: z.number().min(1).max(100),
  memoryReserve: z.number().min(0),
  logLevel: z.enum(['debug', 'info', 'warn', 'error'])
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

const DEFAULT_CONFIG: Configuration = {
  timeout: 1800000, // 30 minutes
  maxOutputBuffer: 10485760, // 10MB
  cpuThreshold: 80, // 80%
  memoryReserve: 1073741824, // 1GB
  logLevel: 'info'
};

export function loadConfiguration(): Configuration {
  // For now, just return defaults
  // TODO: Add environment variable and config file loading
  return { ...DEFAULT_CONFIG };
}