import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SystemResourceMonitor } from '../../../src/implementations/resource-monitor';
import { InMemoryEventBus } from '../../../src/core/events/event-bus';
import { TestLogger } from '../../../src/implementations/logger';
import { createTestConfiguration } from '../../fixtures/factories';
import * as os from 'os';

// Mock os module
let mockTotalmem = () => 16_000_000_000;
let mockFreemem = () => 8_000_000_000;
let mockLoadavg = () => [1.0, 1.0, 1.0];
let mockCpus = () => Array(8).fill({ times: { idle: 100, user: 100, nice: 0, sys: 50, irq: 0 } });

vi.mock('os', () => ({
  default: {
    totalmem: () => mockTotalmem(),
    freemem: () => mockFreemem(),
    loadavg: () => mockLoadavg(),
    cpus: () => mockCpus()
  },
  totalmem: () => mockTotalmem(),
  freemem: () => mockFreemem(),
  loadavg: () => mockLoadavg(),
  cpus: () => mockCpus()
}));

describe('SystemResourceMonitor', () => {
  let monitor: SystemResourceMonitor;
  let eventBus: InMemoryEventBus;
  let logger: TestLogger;

  const MEMORY_16GB = 16_000_000_000;
  const MEMORY_8GB = 8_000_000_000;
  const MEMORY_1GB = 1_000_000_000;

  beforeEach(() => {
    logger = new TestLogger();
    eventBus = new InMemoryEventBus(createTestConfiguration(), logger);

    // Setup default mock values
    mockTotalmem = () => MEMORY_16GB;
    mockFreemem = () => MEMORY_8GB;
    mockLoadavg = () => [1.5, 1.2, 1.0];
    mockCpus = () => new Array(4).fill({ times: { idle: 100, user: 100, nice: 0, sys: 50, irq: 0 } });

    const config = createTestConfiguration({
      cpuCoresReserved: 2,
      memoryReserve: MEMORY_1GB,
      resourceMonitorIntervalMs: 100
    });

    monitor = new SystemResourceMonitor(config, eventBus, logger);
  });

  afterEach(() => {
    monitor.stopMonitoring();
    vi.clearAllMocks();
  });

  describe('Resource querying', () => {
    it('should get current system resources', async () => {
      const result = await monitor.getResources();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const resources = result.value;
        expect(resources.totalMemory).toBe(MEMORY_16GB);
        expect(resources.availableMemory).toBe(MEMORY_8GB);
        expect(resources.loadAverage).toEqual([1.5, 1.2, 1.0]);
        expect(resources.workerCount).toBe(0);
        expect(resources.cpuUsage).toBe(37.5); // (1.5/4) * 100
      }
    });

    // Data-driven CPU usage tests
    const cpuUsageCases = [
      { load: [2.0, 1.5, 1.0], cpus: 8, expected: 25 },   // (2.0/8) * 100
      { load: [16.0, 12.0, 8.0], cpus: 4, expected: 100 }, // Capped at 100
      { load: [0.5, 0.3, 0.2], cpus: 4, expected: 12.5 },  // Low load
    ];

    it.each(cpuUsageCases)(
      'should calculate CPU usage correctly with load $load and $cpus CPUs',
      async ({ load, cpus, expected }) => {
        mockLoadavg = () => load;
        mockCpus = () => new Array(cpus).fill({ times: { idle: 100, user: 100, nice: 0, sys: 50, irq: 0 } });

        const result = await monitor.getResources();

        if (result.ok) {
          expect(result.value.cpuUsage).toBe(expected);
        }
      }
    );

    it('should handle edge cases gracefully', async () => {
      mockCpus = () => [];  // No CPUs

      const result = await monitor.getResources();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.cpuUsage).toBe(0);
      }
    });
  });

  describe('Spawn eligibility', () => {
    // Data-driven eligibility tests
    const eligibilityCases = [
      {
        name: 'sufficient resources',
        memory: MEMORY_8GB,
        load: [1.0, 1.0, 1.0],
        cpus: 4,
        workerCount: 0,
        expected: true
      },
      {
        name: 'low memory',
        memory: 500_000_000, // 500MB free
        load: [1.0, 1.0, 1.0],
        cpus: 4,
        workerCount: 0,
        expected: false
      },
      {
        name: 'high CPU usage',
        memory: MEMORY_8GB,
        load: [3.5, 3.0, 2.5], // 87.5% usage on 4 cores
        cpus: 4,
        workerCount: 0,
        expected: false
      },
      {
        name: 'at CPU threshold',
        memory: MEMORY_8GB,
        load: [3.2, 3.0, 2.8], // Exactly 80% on 4 cores
        cpus: 4,
        workerCount: 0,
        expected: false
      }
    ];

    it.each(eligibilityCases)(
      'should determine spawn eligibility correctly when $name',
      async ({ memory, load, cpus, expected }) => {
        mockFreemem = () => memory;
        mockLoadavg = () => load;
        mockCpus = () => new Array(cpus).fill({ times: { idle: 100, user: 100, nice: 0, sys: 50, irq: 0 } });

        const result = await monitor.canSpawnWorker();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(expected);
        }
      }
    );
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

    it('should not go below zero', () => {
      monitor.decrementWorkerCount();
      monitor.decrementWorkerCount();
      expect(monitor.getCurrentWorkerCount()).toBe(0);

      // Multiple decrements should stay at 0
      monitor.decrementWorkerCount();
      monitor.decrementWorkerCount();
      expect(monitor.getCurrentWorkerCount()).toBe(0);
      expect(monitor.getCurrentWorkerCount()).toBeGreaterThanOrEqual(0);
      expect(typeof monitor.getCurrentWorkerCount()).toBe('number');
    });

    it('should allow direct setting', () => {
      monitor.setWorkerCount(5);
      expect(monitor.getCurrentWorkerCount()).toBe(5);

      monitor.setWorkerCount(0);
      expect(monitor.getCurrentWorkerCount()).toBe(0);

      monitor.setWorkerCount(100);
      expect(monitor.getCurrentWorkerCount()).toBe(100);

      // Should handle negative values by setting to 0
      monitor.setWorkerCount(-5);
      expect(monitor.getCurrentWorkerCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Periodic monitoring', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // TODO: Implement threshold crossing event emission in SystemResourceMonitor
    // Currently the monitor tracks thresholds internally but doesn't emit events
    it.skip('should emit events when thresholds are crossed', async () => {
      const events: Array<{ type: string; data: any }> = [];

      eventBus.on('ResourceThresholdCrossed', (data) => {
        events.push({ type: 'ResourceThresholdCrossed', data });
      });

      monitor.startMonitoring();

      // Initial state: normal resources
      await vi.advanceTimersByTimeAsync(100);

      // Simulate high CPU
      mockLoadavg = () => [3.5, 3.0, 2.5]; // 87.5% usage
      await vi.advanceTimersByTimeAsync(100);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ResourceThresholdCrossed');
      expect(events[0].data.type).toBe('cpu_high');
      expect(events[0].data).toBeDefined();
      expect(typeof events[0].data.type).toBe('string');
      expect(Array.isArray(events)).toBe(true);
    });

    // TODO: Implement threshold recovery event emission in SystemResourceMonitor
    it.skip('should emit recovery events', async () => {
      const events: Array<{ type: string; data: any }> = [];

      eventBus.on('ResourceThresholdRecovered', (data) => {
        events.push({ type: 'ResourceThresholdRecovered', data });
      });

      monitor.startMonitoring();

      // Start with high CPU
      mockLoadavg = () => [3.5, 3.0, 2.5];
      await vi.advanceTimersByTimeAsync(100);

      // Return to normal
      mockLoadavg = () => [1.0, 1.0, 1.0];
      await vi.advanceTimersByTimeAsync(100);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ResourceThresholdRecovered');
      expect(events[0].data.type).toBe('cpu_normal');
    });

    it('should stop monitoring on command', () => {
      monitor.startMonitoring();
      expect(monitor['monitoringInterval']).toBeTruthy();

      monitor.stopMonitoring();
      expect(monitor['monitoringInterval']).toBeNull();
    });

    // TODO: Implement threshold event de-duplication in SystemResourceMonitor
    it.skip('should not emit duplicate threshold events', async () => {
      const events: any[] = [];
      eventBus.on('ResourceThresholdCrossed', (data) => events.push(data));

      monitor.startMonitoring();

      // Keep high CPU for multiple intervals
      mockLoadavg = () => [3.5, 3.0, 2.5];

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      // Should only emit once
      expect(events).toHaveLength(1);
    });
  });

  describe('Error handling', () => {
    it('should handle OS API errors gracefully', async () => {
      mockTotalmem = () => {
        throw new Error('OS API error');
      };

      const result = await monitor.getResources();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to get system resources');
      }
    });

    it('should continue monitoring after errors', async () => {
      vi.useFakeTimers();

      let errorCount = 0;
      mockLoadavg = () => {
        errorCount++;
        if (errorCount <= 2) {
          throw new Error('Temporary error');
        }
        return [1.0, 1.0, 1.0];
      };

      monitor.startMonitoring();

      // Advance through error periods
      await vi.advanceTimersByTimeAsync(300);

      // Should recover after errors clear
      const result = await monitor.getResources();
      expect(result.ok).toBe(true);

      vi.useRealTimers();
    });
  });
});