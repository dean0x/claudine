/**
 * System resource monitoring implementation
 * Tracks CPU, memory, and determines if we can spawn more workers
 */

import * as os from 'os';
import { ResourceMonitor, Logger } from '../core/interfaces.js';
import { EventBus } from '../core/events/event-bus.js';
import { SystemResources } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import { Configuration } from '../core/configuration.js';

export class SystemResourceMonitor implements ResourceMonitor {
  private readonly cpuCoresReserved: number;
  private readonly memoryReserve: number;
  private readonly maxWorkers: number;
  private readonly monitoringIntervalMs: number;
  private workerCount = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  // Per-worker resource estimates based on measurements
  private readonly MEMORY_PER_WORKER_MB = 450; // ~410MB observed + buffer
  private readonly CORES_PER_WORKER = 0.15; // ~11-15% of one core observed

  constructor(
    config: Configuration,
    private readonly eventBus?: EventBus,
    private readonly logger?: Logger
  ) {
    this.cpuCoresReserved = config.cpuCoresReserved;
    this.memoryReserve = config.memoryReserve;
    this.monitoringIntervalMs = config.resourceMonitorIntervalMs!;

    // Dynamic max workers based on system resources
    const totalCores = os.cpus().length;
    const availableCores = Math.max(1, totalCores - this.cpuCoresReserved);
    const maxWorkersByCores = Math.floor(availableCores / this.CORES_PER_WORKER);

    // Use environment override or calculate based on cores
    this.maxWorkers = parseInt(process.env.MAX_WORKERS || String(maxWorkersByCores), 10);
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
    // Check max workers limit first
    if (this.workerCount >= this.maxWorkers) {
      this.logger?.debug('Cannot spawn: Max workers limit reached', {
        currentWorkers: this.workerCount,
        maxWorkers: this.maxWorkers
      });
      return ok(false);
    }

    const resourcesResult = await this.getResources();

    if (!resourcesResult.ok) {
      return resourcesResult;
    }

    const resources = resourcesResult.value;
    const totalCores = os.cpus().length;

    // Calculate available CPU cores based on current usage
    const usedCores = (resources.cpuUsage / 100) * totalCores;
    const availableCores = totalCores - usedCores - this.cpuCoresReserved;

    // Check if we have enough cores for another worker
    if (availableCores < this.CORES_PER_WORKER) {
      this.logger?.debug('Cannot spawn: Insufficient CPU cores available', {
        totalCores,
        usedCores: usedCores.toFixed(2),
        reservedCores: this.cpuCoresReserved,
        availableCores: availableCores.toFixed(2),
        requiredCores: this.CORES_PER_WORKER
      });
      return ok(false);
    }

    // Check if we have enough memory for another worker
    const requiredMemory = this.memoryReserve + (this.MEMORY_PER_WORKER_MB * 1024 * 1024);
    if (resources.availableMemory <= requiredMemory) {
      this.logger?.debug('Cannot spawn: Insufficient memory for new worker', {
        availableMemory: resources.availableMemory,
        requiredMemory,
        memoryPerWorkerMB: this.MEMORY_PER_WORKER_MB
      });
      return ok(false);
    }

    // Check load average against available cores
    const maxLoad = totalCores - this.cpuCoresReserved;
    if (resources.loadAverage[0] > maxLoad) {
      this.logger?.debug('Cannot spawn: System load too high', {
        loadAverage: resources.loadAverage[0],
        maxLoad,
        totalCores,
        reservedCores: this.cpuCoresReserved
      });
      return ok(false);
    }

    this.logger?.info('Can spawn worker', {
      totalCores,
      usedCores: usedCores.toFixed(2),
      availableCores: availableCores.toFixed(2),
      availableMemoryGB: (resources.availableMemory / 1e9).toFixed(2),
      workerCount: this.workerCount,
      maxWorkers: this.maxWorkers
    });
    return ok(true);
  }

  getThresholds(): { readonly maxCpuPercent: number; readonly minMemoryBytes: number } {
    // Convert reserved cores to percentage for backward compatibility
    const totalCores = os.cpus().length;
    const maxUsableCores = totalCores - this.cpuCoresReserved;
    const maxCpuPercent = (maxUsableCores / totalCores) * 100;

    return {
      maxCpuPercent,
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

  getCurrentWorkerCount(): number {
    return this.workerCount;
  }

  setWorkerCount(count: number): void {
    this.workerCount = Math.max(0, count);
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
      cpuCoresReserved: this.cpuCoresReserved,
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

    // Handle edge case: no CPUs detected
    if (cpuCount === 0) {
      return 0;
    }

    const loadPercent = (loadAverage / cpuCount) * 100;

    // Cap at 100% to avoid misleading values
    return Math.min(100, loadPercent);
  }
}

/**
 * Test implementation with configurable resources
 */
export class TestResourceMonitor implements ResourceMonitor {
  private cpuUsage = 30;
  private availableMemory = 8_000_000_000;
  private totalMemory = 16_000_000_000;
  private loadAvg: readonly [number, number, number] = [1.2, 1.0, 0.8];
  private workerCount = 0;
  private cpuThreshold = 80;
  private memoryReserve = 1_000_000_000;
  private canSpawn = true;
  private spawnCheckCount = 0;

  constructor(
    private readonly eventBus?: EventBus,
    private readonly logger?: Logger,
    cpuThreshold = 80,
    memoryReserve = 1_000_000_000
  ) {
    this.cpuThreshold = cpuThreshold;
    this.memoryReserve = memoryReserve;
  }

  async getResources(): Promise<Result<SystemResources>> {
    return ok({
      cpuUsage: this.cpuUsage,
      availableMemory: this.availableMemory,
      totalMemory: this.totalMemory,
      loadAverage: this.loadAvg,
      workerCount: this.workerCount,
    });
  }

  async canSpawnWorker(): Promise<Result<boolean>> {
    this.spawnCheckCount++;
    if (!this.canSpawn) {
      return ok(false);
    }
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
  setResources(resources: Partial<SystemResources>): void {
    if (resources.cpuUsage !== undefined) this.cpuUsage = resources.cpuUsage;
    if (resources.availableMemory !== undefined) this.availableMemory = resources.availableMemory;
    if (resources.totalMemory !== undefined) this.totalMemory = resources.totalMemory;
    if (resources.loadAverage !== undefined) this.loadAvg = resources.loadAverage;
    if (resources.workerCount !== undefined) this.workerCount = resources.workerCount;
  }

  setCpuUsage(percent: number): void {
    this.cpuUsage = percent;
  }

  setAvailableMemory(bytes: number): void {
    this.availableMemory = bytes;
  }

  setWorkerCount(count: number): void {
    this.workerCount = Math.max(0, count);
  }

  getCurrentWorkerCount(): number {
    return this.workerCount;
  }

  incrementWorkerCount(): void {
    this.workerCount++;
  }

  decrementWorkerCount(): void {
    if (this.workerCount > 0) {
      this.workerCount--;
    }
  }

  setCanSpawn(canSpawn: boolean): void {
    this.canSpawn = canSpawn;
  }

  getSpawnCheckCount(): number {
    return this.spawnCheckCount;
  }

  resetSpawnCheckCount(): void {
    this.spawnCheckCount = 0;
  }

  getCpuThreshold(): number {
    return this.cpuThreshold;
  }

  setCpuThreshold(threshold: number): void {
    this.cpuThreshold = threshold;
  }

  getMemoryReserve(): number {
    return this.memoryReserve;
  }

  setMemoryReserve(reserve: number): void {
    this.memoryReserve = reserve;
  }
}