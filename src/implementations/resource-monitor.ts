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
    
    // Log current state for debugging
    console.error(`[ResourceMonitor] CPU: ${resources.cpuUsage.toFixed(1)}%, Memory: ${(resources.availableMemory / 1e9).toFixed(1)}GB, Workers: ${resources.workerCount}`);
    
    // Check CPU threshold
    if (resources.cpuUsage >= this.cpuThreshold) {
      console.error(`[ResourceMonitor] Cannot spawn: CPU ${resources.cpuUsage.toFixed(1)}% >= ${this.cpuThreshold}% threshold`);
      return ok(false);
    }

    // Check memory reserve
    if (resources.availableMemory <= this.memoryReserve) {
      console.error(`[ResourceMonitor] Cannot spawn: Memory ${(resources.availableMemory / 1e9).toFixed(1)}GB <= ${(this.memoryReserve / 1e9).toFixed(1)}GB reserve`);
      return ok(false);
    }

    // Check load average (be more permissive)
    const cpuCount = os.cpus().length;
    if (resources.loadAverage[0] > cpuCount * 3) {  // Changed from 2x to 3x
      console.error(`[ResourceMonitor] Cannot spawn: Load ${resources.loadAverage[0].toFixed(1)} > ${cpuCount * 3} (3x CPU count)`);
      return ok(false);
    }

    console.error(`[ResourceMonitor] Can spawn worker!`);
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
    // Use load average as primary metric (more stable than instant CPU)
    const loadAverage = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPercent = (loadAverage / cpuCount) * 100;

    // Return load percentage
    return loadPercent;
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
  
  incrementWorkerCount(): void {
    this.workerCount++;
  }
  
  decrementWorkerCount(): void {
    if (this.workerCount > 0) {
      this.workerCount--;
    }
  }
}