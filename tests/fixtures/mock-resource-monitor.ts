import { ResourceMonitor, SystemResources } from '../../src/core/interfaces.js';
import { Result, ok } from '../../src/core/result.js';

/**
 * Mock resource monitor for integration testing
 * Allows controlled simulation of system resource states
 */
export class MockResourceMonitor implements ResourceMonitor {
  private cpuUsage = 30; // Default 30% CPU
  private freeMemory = 2_000_000_000; // Default 2GB free
  private totalMemory = 8_000_000_000; // Default 8GB total
  private workerCount = 0;

  async getResources(): Promise<Result<SystemResources>> {
    return ok({
      cpuUsage: this.cpuUsage,
      memoryUsage: this.totalMemory - this.freeMemory,
      totalMemory: this.totalMemory,
      freeMemory: this.freeMemory,
      loadAverage: [1.0, 1.0, 1.0] as readonly [number, number, number],
      workerCount: this.workerCount,
      timestamp: Date.now()
    });
  }

  async hasAvailableResources(): Promise<boolean> {
    return this.cpuUsage < 80 && this.freeMemory > 1_000_000_000;
  }

  async canSpawnWorker(): Promise<Result<boolean>> {
    // Check if we can spawn another worker based on resources
    const canSpawn = this.cpuUsage < 70 && this.freeMemory > 500_000_000 && this.workerCount < 10;
    return ok(canSpawn);
  }

  async getMetrics(): Promise<Result<SystemResources>> {
    return this.getResources();
  }

  updateWorkerCount(count: number): void {
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

  startMonitoring(): void {
    // No-op for mock
  }

  stopMonitoring(): void {
    // No-op for mock
  }

  // Test helper methods
  simulateHighCPU(percent: number): void {
    this.cpuUsage = percent;
  }

  simulateLowMemory(freeBytes: number): void {
    this.freeMemory = freeBytes;
  }

  resetResources(): void {
    this.cpuUsage = 30;
    this.freeMemory = 2_000_000_000;
    this.workerCount = 0;
  }

  setWorkerCount(count: number): void {
    this.workerCount = count;
  }
}