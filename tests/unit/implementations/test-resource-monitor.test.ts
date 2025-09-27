import { describe, it, expect, beforeEach } from 'vitest';
import { TestResourceMonitor } from '../../../src/implementations/resource-monitor';
import { InMemoryEventBus } from '../../../src/core/events/event-bus';
import { TestLogger } from '../../../src/implementations/logger';

describe('TestResourceMonitor', () => {
  let monitor: TestResourceMonitor;
  let eventBus: InMemoryEventBus;
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
    eventBus = new InMemoryEventBus(logger);
    monitor = new TestResourceMonitor(eventBus, logger);
  });

  describe('Configurable resources', () => {
    it('should use default resources', async () => {
      const result = await monitor.getResources();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          cpuUsage: 30,
          availableMemory: 8_000_000_000,
          totalMemory: 16_000_000_000,
          loadAverage: [1.2, 1.0, 0.8],
          workerCount: 0
        });
      }
    });

    it('should allow setting custom resources', async () => {
      monitor.setResources({
        cpuUsage: 75,
        availableMemory: 2_000_000_000,
        totalMemory: 8_000_000_000,
        loadAverage: [3.0, 2.5, 2.0],
        workerCount: 3
      });

      const result = await monitor.getResources();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.cpuUsage).toBe(75);
        expect(result.value.availableMemory).toBe(2_000_000_000);
        expect(result.value.workerCount).toBe(3);
      }
    });
  });

  describe('Spawn eligibility simulation', () => {
    it('should allow spawn by default', async () => {
      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should respect configured eligibility', async () => {
      monitor.setCanSpawn(false);

      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should track spawn checks', async () => {
      await monitor.canSpawnWorker();
      await monitor.canSpawnWorker();
      await monitor.canSpawnWorker();

      expect(monitor.getSpawnCheckCount()).toBe(3);
    });

    it('should allow resetting spawn check count', () => {
      monitor['spawnCheckCount'] = 5;
      monitor.resetSpawnCheckCount();

      expect(monitor.getSpawnCheckCount()).toBe(0);
    });
  });

  describe('Worker count management', () => {
    it('should track worker count', () => {
      expect(monitor.getCurrentWorkerCount()).toBe(0);

      monitor.incrementWorkerCount();
      expect(monitor.getCurrentWorkerCount()).toBe(1);

      monitor.incrementWorkerCount();
      expect(monitor.getCurrentWorkerCount()).toBe(2);

      monitor.decrementWorkerCount();
      expect(monitor.getCurrentWorkerCount()).toBe(1);
    });

    it('should allow direct setting', () => {
      monitor.setWorkerCount(5);
      expect(monitor.getCurrentWorkerCount()).toBe(5);
    });
  });

  describe('Threshold access', () => {
    it('should provide default thresholds', () => {
      expect(monitor.getCpuThreshold()).toBe(80);
      expect(monitor.getMemoryReserve()).toBe(1_000_000_000);
    });

    it('should allow setting thresholds', () => {
      monitor.setCpuThreshold(60);
      monitor.setMemoryReserve(2_000_000_000);

      expect(monitor.getCpuThreshold()).toBe(60);
      expect(monitor.getMemoryReserve()).toBe(2_000_000_000);
    });
  });

  describe('Test scenarios', () => {
    it('should simulate resource pressure', async () => {
      // Simulate gradual resource pressure
      monitor.setResources({
        cpuUsage: 50,
        availableMemory: 4_000_000_000,
        totalMemory: 16_000_000_000,
        loadAverage: [2.0, 1.5, 1.0],
        workerCount: 2
      });

      let result = await monitor.canSpawnWorker();
      expect(result.ok && result.value).toBe(true);

      // Increase pressure
      monitor.setResources({
        cpuUsage: 85,
        availableMemory: 900_000_000,
        totalMemory: 16_000_000_000,
        loadAverage: [3.4, 3.0, 2.5],
        workerCount: 4
      });

      monitor.setCanSpawn(false); // Simulate high pressure

      result = await monitor.canSpawnWorker();
      expect(result.ok && result.value).toBe(false);
    });

    it('should be useful for testing autoscaling logic', async () => {
      // Simulate autoscaling test scenario
      const checkScaling = async () => {
        const resources = await monitor.getResources();
        const canSpawn = await monitor.canSpawnWorker();

        if (!resources.ok || !canSpawn.ok) return false;

        if (resources.value.cpuUsage < 70 && resources.value.availableMemory > 2_000_000_000) {
          return canSpawn.value;
        }
        return false;
      };

      // Good conditions
      monitor.setResources({
        cpuUsage: 40,
        availableMemory: 5_000_000_000,
        totalMemory: 8_000_000_000,
        loadAverage: [1.6, 1.4, 1.2],
        workerCount: 2
      });

      expect(await checkScaling()).toBe(true);

      // Bad conditions
      monitor.setResources({
        cpuUsage: 85,
        availableMemory: 1_000_000_000,
        totalMemory: 8_000_000_000,
        loadAverage: [3.4, 3.0, 2.8],
        workerCount: 4
      });

      expect(await checkScaling()).toBe(false);
    });
  });
});