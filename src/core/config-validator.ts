/**
 * Component-Level Configuration Validation
 *
 * ARCHITECTURE: Validates configuration against actual system state
 * - Goes beyond Zod schema validation (types, ranges)
 * - Checks configuration makes sense for the running system
 * - Provides actionable warnings, not errors
 * - Used at startup to alert operators of potential issues
 */

import os from 'os';
import { Configuration } from './configuration.js';
import { Logger } from './interfaces.js';

/**
 * Validation warning - non-fatal issues with configuration
 */
export interface ConfigValidationWarning {
  readonly field: string;
  readonly severity: 'warning' | 'info';
  readonly message: string;
  readonly suggestion: string;
  readonly currentValue: number | string | boolean;
  readonly recommendedValue?: number | string | boolean;
}

/**
 * System information for validation
 */
interface SystemInfo {
  totalCpuCores: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
}

/**
 * Get current system information
 */
function getSystemInfo(): SystemInfo {
  const totalMemoryBytes = os.totalmem();
  const availableMemoryBytes = os.freemem();
  const totalCpuCores = os.cpus().length;

  return {
    totalCpuCores,
    totalMemoryBytes,
    availableMemoryBytes,
  };
}

/**
 * Validate CPU configuration against system
 */
function validateCpuConfig(
  config: Configuration,
  system: SystemInfo
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Check if reserved cores exceed available
  if (config.cpuCoresReserved > system.totalCpuCores) {
    warnings.push({
      field: 'cpuCoresReserved',
      severity: 'warning',
      message: `Reserved CPU cores (${config.cpuCoresReserved}) exceeds available cores (${system.totalCpuCores})`,
      suggestion: `Reduce cpuCoresReserved to ${Math.max(1, system.totalCpuCores - 1)} or lower`,
      currentValue: config.cpuCoresReserved,
      recommendedValue: Math.max(1, system.totalCpuCores - 1),
    });
  }

  // Warn if reserving too many cores (>50% of total)
  const reservedPercent = (config.cpuCoresReserved / system.totalCpuCores) * 100;
  if (reservedPercent > 50) {
    warnings.push({
      field: 'cpuCoresReserved',
      severity: 'info',
      message: `Reserving ${reservedPercent.toFixed(0)}% of CPU cores (${config.cpuCoresReserved}/${system.totalCpuCores})`,
      suggestion: `Consider reducing to ${Math.ceil(system.totalCpuCores * 0.3)} cores (30%) for better worker availability`,
      currentValue: config.cpuCoresReserved,
      recommendedValue: Math.ceil(system.totalCpuCores * 0.3),
    });
  }

  // Warn if only 1 core reserved on multi-core system
  if (config.cpuCoresReserved === 1 && system.totalCpuCores > 4) {
    warnings.push({
      field: 'cpuCoresReserved',
      severity: 'info',
      message: `Only 1 core reserved on ${system.totalCpuCores}-core system`,
      suggestion: `Consider reserving 2 cores for better system stability`,
      currentValue: 1,
      recommendedValue: 2,
    });
  }

  return warnings;
}

/**
 * Validate memory configuration against system
 */
function validateMemoryConfig(
  config: Configuration,
  system: SystemInfo
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Check if reserved memory exceeds total
  if (config.memoryReserve > system.totalMemoryBytes) {
    const totalGB = (system.totalMemoryBytes / (1024 ** 3)).toFixed(1);
    const reservedGB = (config.memoryReserve / (1024 ** 3)).toFixed(1);
    warnings.push({
      field: 'memoryReserve',
      severity: 'warning',
      message: `Reserved memory (${reservedGB}GB) exceeds total system memory (${totalGB}GB)`,
      suggestion: `Reduce memoryReserve to ${Math.floor(system.totalMemoryBytes * 0.3)} bytes (~${(system.totalMemoryBytes * 0.3 / (1024 ** 3)).toFixed(1)}GB)`,
      currentValue: config.memoryReserve,
      recommendedValue: Math.floor(system.totalMemoryBytes * 0.3),
    });
  }

  // Warn if reserving too much memory (>40% of total)
  const reservedPercent = (config.memoryReserve / system.totalMemoryBytes) * 100;
  if (reservedPercent > 40) {
    const recommendedBytes = Math.floor(system.totalMemoryBytes * 0.25);
    const recommendedGB = (recommendedBytes / (1024 ** 3)).toFixed(1);
    warnings.push({
      field: 'memoryReserve',
      severity: 'info',
      message: `Reserving ${reservedPercent.toFixed(0)}% of total memory`,
      suggestion: `Consider reducing to ${recommendedBytes} bytes (~${recommendedGB}GB, 25% of total)`,
      currentValue: config.memoryReserve,
      recommendedValue: recommendedBytes,
    });
  }

  // Warn if very low memory reserve (<500MB)
  const minReserveBytes = 500 * 1024 * 1024;
  if (config.memoryReserve < minReserveBytes) {
    const currentMB = (config.memoryReserve / (1024 ** 2)).toFixed(0);
    warnings.push({
      field: 'memoryReserve',
      severity: 'warning',
      message: `Memory reserve is very low (${currentMB}MB)`,
      suggestion: `Increase to at least 1GB (1073741824 bytes) for system stability`,
      currentValue: config.memoryReserve,
      recommendedValue: 1024 * 1024 * 1024,
    });
  }

  return warnings;
}

/**
 * Validate timeout configuration
 */
function validateTimeoutConfig(
  config: Configuration
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Warn if timeout is very low (<5 minutes)
  const fiveMinutes = 5 * 60 * 1000;
  if (config.timeout < fiveMinutes) {
    const currentMinutes = (config.timeout / 60000).toFixed(1);
    warnings.push({
      field: 'timeout',
      severity: 'info',
      message: `Task timeout is low (${currentMinutes} minutes)`,
      suggestion: `Consider increasing to 1800000ms (30 minutes) for complex tasks`,
      currentValue: config.timeout,
      recommendedValue: 1800000,
    });
  }

  // Warn if timeout is at maximum (1 hour)
  const oneHour = 60 * 60 * 1000;
  if (config.timeout === oneHour) {
    warnings.push({
      field: 'timeout',
      severity: 'info',
      message: `Task timeout is at security maximum (1 hour)`,
      suggestion: `This is the highest allowed value. Tasks exceeding 1 hour will be terminated.`,
      currentValue: config.timeout,
    });
  }

  return warnings;
}

/**
 * Validate EventBus configuration
 */
function validateEventBusConfig(
  config: Configuration
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Warn if maxListenersPerEvent is too low
  if (config.maxListenersPerEvent! < 50) {
    warnings.push({
      field: 'maxListenersPerEvent',
      severity: 'warning',
      message: `EventBus listener limit is low (${config.maxListenersPerEvent})`,
      suggestion: `Increase to 100 to avoid listener limit errors`,
      currentValue: config.maxListenersPerEvent!,
      recommendedValue: 100,
    });
  }

  // Warn if maxTotalSubscriptions is too low
  if (config.maxTotalSubscriptions! < 500) {
    warnings.push({
      field: 'maxTotalSubscriptions',
      severity: 'warning',
      message: `EventBus total subscription limit is low (${config.maxTotalSubscriptions})`,
      suggestion: `Increase to 1000 to avoid subscription limit errors`,
      currentValue: config.maxTotalSubscriptions!,
      recommendedValue: 1000,
    });
  }

  return warnings;
}

/**
 * Validate output buffer configuration
 */
function validateOutputConfig(
  config: Configuration
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Warn if output buffer is very large (>100MB)
  const hundredMB = 100 * 1024 * 1024;
  if (config.maxOutputBuffer > hundredMB) {
    const currentMB = (config.maxOutputBuffer / (1024 ** 2)).toFixed(0);
    warnings.push({
      field: 'maxOutputBuffer',
      severity: 'info',
      message: `Output buffer is large (${currentMB}MB)`,
      suggestion: `Large buffers use more memory. Consider 10MB (10485760 bytes) for most tasks`,
      currentValue: config.maxOutputBuffer,
      recommendedValue: 10485760,
    });
  }

  // Warn if file storage threshold is too high (>10MB)
  const tenMB = 10 * 1024 * 1024;
  if (config.fileStorageThresholdBytes! > tenMB) {
    const currentMB = (config.fileStorageThresholdBytes! / (1024 ** 2)).toFixed(1);
    warnings.push({
      field: 'fileStorageThresholdBytes',
      severity: 'info',
      message: `File storage threshold is high (${currentMB}MB)`,
      suggestion: `Keep below 1MB (1048576 bytes) to reduce memory pressure`,
      currentValue: config.fileStorageThresholdBytes!,
      recommendedValue: 1048576,
    });
  }

  return warnings;
}

/**
 * Validate configuration against system capabilities
 *
 * ARCHITECTURE: Component-level validation
 * - Called at startup after Zod schema validation
 * - Returns warnings, not errors (non-fatal)
 * - Logs warnings but doesn't prevent startup
 * - Helps operators tune configuration
 */
export function validateConfiguration(
  config: Configuration,
  logger?: Logger
): ConfigValidationWarning[] {
  const system = getSystemInfo();
  const warnings: ConfigValidationWarning[] = [];

  // Validate each component
  warnings.push(...validateCpuConfig(config, system));
  warnings.push(...validateMemoryConfig(config, system));
  warnings.push(...validateTimeoutConfig(config));
  warnings.push(...validateEventBusConfig(config));
  warnings.push(...validateOutputConfig(config));

  // Log warnings if logger provided
  if (logger && warnings.length > 0) {
    logger.warn('Configuration validation warnings', {
      count: warnings.length,
      warnings: warnings.map(w => ({
        field: w.field,
        severity: w.severity,
        message: w.message,
      })),
    });

    // Log each warning with suggestions
    warnings.forEach(warning => {
      if (warning.severity === 'warning') {
        logger.warn(`Config: ${warning.field}`, {
          message: warning.message,
          suggestion: warning.suggestion,
          current: warning.currentValue,
          recommended: warning.recommendedValue,
        });
      } else {
        logger.info(`Config: ${warning.field}`, {
          message: warning.message,
          suggestion: warning.suggestion,
        });
      }
    });
  }

  return warnings;
}

/**
 * Format validation warnings for CLI display
 */
export function formatValidationWarnings(warnings: ConfigValidationWarning[]): string {
  if (warnings.length === 0) {
    return '✅ Configuration validation passed - no warnings';
  }

  const lines: string[] = [];
  lines.push(`⚠️  Configuration Validation: ${warnings.length} warning(s)\n`);

  warnings.forEach((w, i) => {
    const icon = w.severity === 'warning' ? '⚠️ ' : 'ℹ️ ';
    lines.push(`${i + 1}. ${icon}${w.field}`);
    lines.push(`   ${w.message}`);
    lines.push(`   💡 ${w.suggestion}`);
    if (w.recommendedValue !== undefined) {
      lines.push(`   Current: ${w.currentValue} → Recommended: ${w.recommendedValue}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
