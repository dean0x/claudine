/**
 * System resource monitoring implementation
 * Tracks CPU, memory, and determines if we can spawn more workers
 */

import os from 'os';
import { ResourceMonitor } from '../core/interfaces.js';
import { SystemResources } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

export class SystemResourceMonitor implements ResourceMonitor {
  private readonly cpuThreshold: number;
  private readonly memoryReserve: number;
  private workerCount = 0;

  constructor(
    cpuThreshold = 80, // Max 80% CPU usage
    memoryReserve = 1_000_000_000 // Keep 1GB free
  ) {
    this.cpuThreshold = cpuThreshold;
    this.memoryReserve = memoryReserve;
  }

  async getResources(): Promise<Result<SystemResources>> {
    return tryCatchAsync(
      async () => {
        const cpuUsage = await this.getCpuUsage();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const loadAvgArray = os.loadavg();
        const loadAverage: readonly [number, number, number] = [
          loadAvgArray[0],
          loadAvgArray[1],
          loadAvgArray[2]
        ];

        return {
          cpuUsage,
          availableMemory: freeMemory,
          totalMemory,
          loadAverage,
          workerCount: this.workerCount,
        };
      },
      (error) => new ClaudineError(
        ErrorCode.RESOURCE_MONITORING_FAILED,
        `Failed to get system resources: ${error}`
      )
    );
  }

  async canSpawnWorker(): Promise<Result<boolean>> {
    const resourcesResult = await this.getResources();
    
    if (!resourcesResult.ok) {
      return resourcesResult;
    }

    const resources = resourcesResult.value;
    
    // Check CPU threshold
    if (resources.cpuUsage >= this.cpuThreshold) {
      return ok(false);
    }

    // Check memory reserve
    if (resources.availableMemory <= this.memoryReserve) {
      return ok(false);
    }

    // Check load average (don't spawn if load is too high)
    const cpuCount = os.cpus().length;
    if (resources.loadAverage[0] > cpuCount * 2) {
      return ok(false);
    }

    return ok(true);
  }

  getThresholds(): { readonly maxCpuPercent: number; readonly minMemoryBytes: number } {
    return {
      maxCpuPercent: this.cpuThreshold,
      minMemoryBytes: this.memoryReserve,
    };
  }

  incrementWorkerCount(): void {
    this.workerCount++;
  }

  decrementWorkerCount(): void {
    if (this.workerCount > 0) {
      this.workerCount--;
    }
  }

  private async getCpuUsage(): Promise<number> {
    const startUsage = process.cpuUsage();
    const startTime = Date.now();

    // Wait a bit to measure
    await new Promise(resolve => setTimeout(resolve, 100));

    const endUsage = process.cpuUsage(startUsage);
    const endTime = Date.now();

    const userPercent = 100 * (endUsage.user / 1000) / (endTime - startTime);
    const systemPercent = 100 * (endUsage.system / 1000) / (endTime - startTime);

    // Also factor in overall system load
    const loadAverage = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPercent = (loadAverage / cpuCount) * 100;

    // Return the higher of process usage or system load
    return Math.max(userPercent + systemPercent, loadPercent);
  }
}

/**
 * Test implementation with configurable resources
 */
export class TestResourceMonitor implements ResourceMonitor {
  private cpuUsage = 20;
  private availableMemory = 8_000_000_000;
  private workerCount = 0;

  constructor(
    private readonly cpuThreshold = 80,
    private readonly memoryReserve = 1_000_000_000
  ) {}

  async getResources(): Promise<Result<SystemResources>> {
    return ok({
      cpuUsage: this.cpuUsage,
      availableMemory: this.availableMemory,
      totalMemory: 16_000_000_000,
      loadAverage: [1.5, 1.2, 1.0],
      workerCount: this.workerCount,
    });
  }

  async canSpawnWorker(): Promise<Result<boolean>> {
    return ok(
      this.cpuUsage < this.cpuThreshold &&
      this.availableMemory > this.memoryReserve
    );
  }

  getThresholds() {
    return {
      maxCpuPercent: this.cpuThreshold,
      minMemoryBytes: this.memoryReserve,
    };
  }

  // Test helpers
  setCpuUsage(percent: number): void {
    this.cpuUsage = percent;
  }

  setAvailableMemory(bytes: number): void {
    this.availableMemory = bytes;
  }

  setWorkerCount(count: number): void {
    this.workerCount = count;
  }
}