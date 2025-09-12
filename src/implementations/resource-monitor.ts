/**
 * System resource monitoring implementation
 * Tracks CPU, memory, and determines if we can spawn more workers
 */

import os from 'os';
import { ResourceMonitor, EventBus, Logger } from '../core/interfaces.js';
import { SystemResources } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

export class SystemResourceMonitor implements ResourceMonitor {
  private readonly cpuThreshold: number;
  private readonly memoryReserve: number;
  private workerCount = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  constructor(
    cpuThreshold = 80, // Max 80% CPU usage
    memoryReserve = 1_000_000_000, // Keep 1GB free
    private readonly eventBus?: EventBus,
    private readonly logger?: Logger,
    private readonly monitoringIntervalMs = 5000 // Emit events every 5 seconds
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
    
    // Debug logs removed to avoid interfering with output capture
    // console.error(`[ResourceMonitor] CPU: ${resources.cpuUsage.toFixed(1)}%, Memory: ${(resources.availableMemory / 1e9).toFixed(1)}GB, Workers: ${resources.workerCount}`);
    
    // Check CPU threshold
    if (resources.cpuUsage >= this.cpuThreshold) {
      // console.error(`[ResourceMonitor] Cannot spawn: CPU ${resources.cpuUsage.toFixed(1)}% >= ${this.cpuThreshold}% threshold`);
      return ok(false);
    }

    // Check memory reserve
    if (resources.availableMemory <= this.memoryReserve) {
      // console.error(`[ResourceMonitor] Cannot spawn: Memory ${(resources.availableMemory / 1e9).toFixed(1)}GB <= ${(this.memoryReserve / 1e9).toFixed(1)}GB reserve`);
      return ok(false);
    }

    // Check load average (be more permissive)
    const cpuCount = os.cpus().length;
    if (resources.loadAverage[0] > cpuCount * 3) {  // Changed from 2x to 3x
      // console.error(`[ResourceMonitor] Cannot spawn: Load ${resources.loadAverage[0].toFixed(1)} > ${cpuCount * 3} (3x CPU count)`);
      return ok(false);
    }

    // console.error(`[ResourceMonitor] Can spawn worker!`);
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

  /**
   * Start periodic resource monitoring and event publishing
   */
  startMonitoring(): void {
    if (this.isMonitoring || !this.eventBus) {
      return;
    }

    this.isMonitoring = true;
    this.logger?.info('Starting resource monitoring', {
      intervalMs: this.monitoringIntervalMs,
      cpuThreshold: this.cpuThreshold,
      memoryReserve: this.memoryReserve
    });

    this.scheduleResourceCheck();
  }

  /**
   * Stop periodic resource monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearTimeout(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.logger?.info('Stopped resource monitoring');
  }

  /**
   * Schedule the next resource check
   */
  private scheduleResourceCheck(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.monitoringInterval = setTimeout(
      () => this.performResourceCheck(),
      this.monitoringIntervalMs
    );
  }

  /**
   * Perform a resource check and emit events
   */
  private async performResourceCheck(): Promise<void> {
    if (!this.isMonitoring || !this.eventBus) {
      return;
    }

    try {
      const resourcesResult = await this.getResources();
      
      if (resourcesResult.ok) {
        const resources = resourcesResult.value;
        
        // Emit SystemResourcesUpdated event
        const eventResult = await this.eventBus.emit('SystemResourcesUpdated', {
          cpuPercent: resources.cpuUsage,
          memoryUsed: resources.totalMemory - resources.availableMemory,
          workerCount: resources.workerCount
        });

        if (!eventResult.ok) {
          this.logger?.error('Failed to emit SystemResourcesUpdated event', eventResult.error);
        } else {
          this.logger?.debug('Resource status published', {
            cpuPercent: resources.cpuUsage,
            memoryUsed: resources.totalMemory - resources.availableMemory,
            workerCount: resources.workerCount
          });
        }
      } else {
        this.logger?.error('Failed to get system resources for monitoring', resourcesResult.error);
      }

    } catch (error) {
      this.logger?.error('Resource monitoring check failed', error as Error);
    } finally {
      // Schedule next check
      this.scheduleResourceCheck();
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