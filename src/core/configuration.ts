import { z } from 'zod';

/**
 * Configuration Schema with Zod
 *
 * ARCHITECTURE PRINCIPLE: "Parse, don't validate"
 * - Schema transforms input into complete, valid configuration
 * - Fields with .default() are required with fallbacks (not truly optional)
 * - After parse(), all fields guaranteed present (type-safe, no undefined)
 * - Single source of truth for validation AND defaults
 *
 * Reference: https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
 */
export const ConfigurationSchema = z.object({
  // Core settings - required fields
  timeout: z.number().min(1000).max(60 * 60 * 1000).default(1800000), // Default: 30min (SECURITY: max 1 hour)
  maxOutputBuffer: z.number().min(1024).max(1073741824).default(10485760), // Default: 10MB (max 1GB)
  cpuCoresReserved: z.number().min(1).max(32).default(2), // Default: 2 cores (SECURITY: max 32)
  memoryReserve: z.number().min(0).max(64 * 1024 * 1024 * 1024).default(2684354560), // Default: 2.5GB (SECURITY: max 64GB)
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // EventBus resource limits - prevent memory leaks
  maxListenersPerEvent: z.number().min(10).max(10000).default(100),
  maxTotalSubscriptions: z.number().min(100).max(100000).default(1000),
  // Worktree management settings (EXPERIMENTAL - default OFF)
  useWorktreesByDefault: z.boolean().default(false), // Default: OFF - worktrees are experimental, opt-in only
  maxWorktreeAgeDays: z.number().min(1).max(365).default(30), // Default: 30 days minimum age before auto-cleanup
  maxWorktrees: z.number().min(5).max(1000).default(50), // Default: reasonable limit for teams
  worktreeRequireSafetyCheck: z.boolean().default(true), // Default: always check safety before removal
  // Process management configuration
  killGracePeriodMs: z.number().min(1000).max(60000).default(5000), // Default: 5 second grace period
  resourceMonitorIntervalMs: z.number().min(1000).max(60000).default(5000), // Default: check every 5 seconds
  minSpawnDelayMs: z.number().min(10).max(10000).default(50), // Default: 50ms burst protection (reduced from 100ms for better responsiveness)
  // Event system configuration
  eventRequestTimeoutMs: z.number().min(1000).max(300000).default(5000), // Default: 5 second timeout
  eventCleanupIntervalMs: z.number().min(10000).max(600000).default(60000), // Default: cleanup every minute
  // Storage configuration
  fileStorageThresholdBytes: z.number().min(1024).max(10485760).default(102400), // Default: 100KB threshold
  // Retry behavior configuration
  retryInitialDelayMs: z.number().min(100).max(10000).default(1000), // Default: 1 second initial delay
  retryMaxDelayMs: z.number().min(5000).max(300000).default(30000), // Default: 30 second max delay
  // Recovery configuration
  taskRetentionDays: z.number().min(1).max(365).default(7) // Default: keep tasks for 7 days
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

// Per-task configuration (partial override)
export interface TaskConfiguration {
  readonly timeout?: number;
  readonly maxOutputBuffer?: number;
}

const DEFAULT_CONFIG: Configuration = {
  timeout: 1800000, // 30 minutes (within 1-hour security limit)
  maxOutputBuffer: 10485760, // 10MB
  cpuCoresReserved: 2, // Reserve 2 CPU cores for system stability (within 32-core security limit)
  memoryReserve: 2684354560, // 2.5GB - ensure adequate memory reserve for system stability (within 64GB security limit)
  logLevel: 'info',
  maxListenersPerEvent: 100, // Default: prevent memory leaks from excessive listeners
  maxTotalSubscriptions: 1000, // Default: global limit on subscriptions
  // Worktree management defaults (EXPERIMENTAL - OFF by default)
  useWorktreesByDefault: false, // Default: OFF - most users don't need worktree complexity
  maxWorktreeAgeDays: 30, // Default: 30 days minimum age before auto-cleanup (safer for developers)
  maxWorktrees: 50, // Default: reasonable limit for most development teams
  worktreeRequireSafetyCheck: true, // Default: always check safety before removal
  // Process management defaults
  killGracePeriodMs: 5000, // Default: 5 seconds grace period for process termination
  resourceMonitorIntervalMs: 5000, // Default: check resources every 5 seconds
  minSpawnDelayMs: 50, // Default: 50ms burst protection between worker spawns
  // Event system defaults
  eventRequestTimeoutMs: 5000, // Default: 5 second timeout for event requests
  eventCleanupIntervalMs: 60000, // Default: cleanup event history every minute
  // Storage defaults
  fileStorageThresholdBytes: 102400, // Default: 100KB threshold for file storage
  // Retry behavior defaults
  retryInitialDelayMs: 1000, // Default: 1 second initial retry delay
  retryMaxDelayMs: 30000, // Default: 30 second maximum retry delay
  // Recovery defaults
  taskRetentionDays: 7 // Default: keep tasks for 7 days before cleanup
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
  /**
   * ARCHITECTURE: "Parse, don't validate"
   * - We build a partial config from env vars
   * - Zod fills in defaults for missing fields via .default()
   * - Result is always complete and valid (type-safe, no undefined)
   * - No non-null assertions needed - Zod guarantees values
   */

  // Build partial config from environment variables (omit undefined to let Zod fill defaults)
  const envConfig: Record<string, unknown> = {};

  if (process.env.TASK_TIMEOUT) envConfig.timeout = parseEnvNumber(process.env.TASK_TIMEOUT, 0);
  if (process.env.MAX_OUTPUT_BUFFER) envConfig.maxOutputBuffer = parseEnvNumber(process.env.MAX_OUTPUT_BUFFER, 0);
  if (process.env.CPU_CORES_RESERVED) envConfig.cpuCoresReserved = parseEnvNumber(process.env.CPU_CORES_RESERVED, 0);
  if (process.env.MEMORY_RESERVE) envConfig.memoryReserve = parseEnvNumber(process.env.MEMORY_RESERVE, 0);
  if (process.env.LOG_LEVEL) envConfig.logLevel = parseEnvLogLevel(process.env.LOG_LEVEL);
  if (process.env.EVENTBUS_MAX_LISTENERS_PER_EVENT) envConfig.maxListenersPerEvent = parseEnvNumber(process.env.EVENTBUS_MAX_LISTENERS_PER_EVENT, 0);
  if (process.env.EVENTBUS_MAX_TOTAL_SUBSCRIPTIONS) envConfig.maxTotalSubscriptions = parseEnvNumber(process.env.EVENTBUS_MAX_TOTAL_SUBSCRIPTIONS, 0);
  if (process.env.USE_WORKTREES_BY_DEFAULT) envConfig.useWorktreesByDefault = process.env.USE_WORKTREES_BY_DEFAULT.toLowerCase() === 'true';
  if (process.env.WORKTREE_MAX_AGE_DAYS) envConfig.maxWorktreeAgeDays = parseEnvNumber(process.env.WORKTREE_MAX_AGE_DAYS, 0);
  if (process.env.WORKTREE_MAX_COUNT) envConfig.maxWorktrees = parseEnvNumber(process.env.WORKTREE_MAX_COUNT, 0);
  if (process.env.WORKTREE_REQUIRE_SAFETY_CHECK) envConfig.worktreeRequireSafetyCheck = process.env.WORKTREE_REQUIRE_SAFETY_CHECK.toLowerCase() === 'true';
  if (process.env.PROCESS_KILL_GRACE_PERIOD_MS) envConfig.killGracePeriodMs = parseEnvNumber(process.env.PROCESS_KILL_GRACE_PERIOD_MS, 0);
  if (process.env.RESOURCE_MONITOR_INTERVAL_MS) envConfig.resourceMonitorIntervalMs = parseEnvNumber(process.env.RESOURCE_MONITOR_INTERVAL_MS, 0);
  if (process.env.WORKER_MIN_SPAWN_DELAY_MS) envConfig.minSpawnDelayMs = parseEnvNumber(process.env.WORKER_MIN_SPAWN_DELAY_MS, 0);
  if (process.env.EVENT_REQUEST_TIMEOUT_MS) envConfig.eventRequestTimeoutMs = parseEnvNumber(process.env.EVENT_REQUEST_TIMEOUT_MS, 0);
  if (process.env.EVENT_CLEANUP_INTERVAL_MS) envConfig.eventCleanupIntervalMs = parseEnvNumber(process.env.EVENT_CLEANUP_INTERVAL_MS, 0);
  if (process.env.FILE_STORAGE_THRESHOLD_BYTES) envConfig.fileStorageThresholdBytes = parseEnvNumber(process.env.FILE_STORAGE_THRESHOLD_BYTES, 0);
  if (process.env.RETRY_INITIAL_DELAY_MS) envConfig.retryInitialDelayMs = parseEnvNumber(process.env.RETRY_INITIAL_DELAY_MS, 0);
  if (process.env.RETRY_MAX_DELAY_MS) envConfig.retryMaxDelayMs = parseEnvNumber(process.env.RETRY_MAX_DELAY_MS, 0);
  if (process.env.TASK_RETENTION_DAYS) envConfig.taskRetentionDays = parseEnvNumber(process.env.TASK_RETENTION_DAYS, 0);

  // Parse and validate - Zod fills in defaults for missing fields
  const parseResult = ConfigurationSchema.safeParse(envConfig);

  if (parseResult.success) {
    return parseResult.data; // Guaranteed complete and valid
  } else {
    // If validation fails (invalid env values), use pure defaults from schema
    return ConfigurationSchema.parse({}); // Empty object gets all defaults
  }
}