import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SystemResourceMonitor,
  TestResourceMonitor
} from '../../../src/implementations/resource-monitor';
import { InMemoryEventBus } from '../../../src/core/events/event-bus';
import { TestLogger } from '../../../src/implementations/logger';
import * as os from 'os';

// Mock os module
vi.mock('os', () => ({
  default: {
    totalmem: vi.fn(),
    freemem: vi.fn(),
    loadavg: vi.fn(),
    cpus: vi.fn()
  },
  totalmem: vi.fn(),
  freemem: vi.fn(),
  loadavg: vi.fn(),
  cpus: vi.fn()
}));

describe('SystemResourceMonitor - REAL Resource Monitoring', () => {
  let monitor: SystemResourceMonitor;
  let eventBus: InMemoryEventBus;
  let logger: TestLogger;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    logger = new TestLogger();

    // Setup default mock values
    vi.mocked(os.totalmem).mockReturnValue(16_000_000_000); // 16GB
    vi.mocked(os.freemem).mockReturnValue(8_000_000_000);   // 8GB
    vi.mocked(os.loadavg).mockReturnValue([1.5, 1.2, 1.0]);
    vi.mocked(os.cpus).mockReturnValue(new Array(4).fill({})); // 4 CPUs

    monitor = new SystemResourceMonitor(
      80,              // 80% CPU threshold
      1_000_000_000,   // 1GB memory reserve
      eventBus,
      logger,
      100              // 100ms monitoring interval for tests
    );
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
        expect(resources.totalMemory).toBe(16_000_000_000);
        expect(resources.availableMemory).toBe(8_000_000_000);
        expect(resources.loadAverage).toEqual([1.5, 1.2, 1.0]);
        expect(resources.workerCount).toBe(0);
        expect(resources.cpuUsage).toBe(37.5); // (1.5/4) * 100
      }
    });

    it('should calculate CPU usage from load average', async () => {
      vi.mocked(os.loadavg).mockReturnValue([2.0, 1.5, 1.0]);
      vi.mocked(os.cpus).mockReturnValue(new Array(8).fill({})); // 8 CPUs

      const result = await monitor.getResources();

      if (result.ok) {
        expect(result.value.cpuUsage).toBe(25); // (2.0/8) * 100
      }
    });

    it('should handle high load correctly', async () => {
      vi.mocked(os.loadavg).mockReturnValue([16.0, 12.0, 8.0]);
      vi.mocked(os.cpus).mockReturnValue(new Array(4).fill({}));

      const result = await monitor.getResources();

      if (result.ok) {
        expect(result.value.cpuUsage).toBe(400); // (16.0/4) * 100
      }
    });

    it('should track worker count', async () => {
      monitor.incrementWorkerCount();
      monitor.incrementWorkerCount();

      const result = await monitor.getResources();

      if (result.ok) {
        expect(result.value.workerCount).toBe(2);
      }

      monitor.decrementWorkerCount();

      const result2 = await monitor.getResources();
      if (result2.ok) {
        expect(result2.value.workerCount).toBe(1);
      }
    });
  });

  describe('Spawn eligibility', () => {
    it('should allow spawn when resources are available', async () => {
      vi.mocked(os.loadavg).mockReturnValue([1.0, 1.0, 1.0]); // Low load
      vi.mocked(os.freemem).mockReturnValue(4_000_000_000);    // 4GB free

      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should deny spawn when CPU threshold exceeded', async () => {
      vi.mocked(os.loadavg).mockReturnValue([4.0, 3.0, 2.0]); // 100% per CPU
      vi.mocked(os.cpus).mockReturnValue(new Array(4).fill({}));

      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should deny spawn when memory below reserve', async () => {
      vi.mocked(os.freemem).mockReturnValue(500_000_000); // 500MB free

      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should deny spawn when load average too high', async () => {
      vi.mocked(os.loadavg).mockReturnValue([13.0, 10.0, 8.0]); // > 3x CPU count
      vi.mocked(os.cpus).mockReturnValue(new Array(4).fill({}));

      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should respect custom thresholds', async () => {
      const customMonitor = new SystemResourceMonitor(
        50,              // 50% CPU threshold
        2_000_000_000    // 2GB memory reserve
      );

      vi.mocked(os.loadavg).mockReturnValue([2.4, 2.0, 1.8]); // 60% CPU usage
      vi.mocked(os.cpus).mockReturnValue(new Array(4).fill({}));
      vi.mocked(os.freemem).mockReturnValue(1_500_000_000);   // 1.5GB free

      const result = await customMonitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false); // Both thresholds violated
      }
    });
  });

  describe('Threshold management', () => {
    it('should return configured thresholds', () => {
      const thresholds = monitor.getThresholds();

      expect(thresholds.maxCpuPercent).toBe(80);
      expect(thresholds.minMemoryBytes).toBe(1_000_000_000);
    });

    it('should use default thresholds', () => {
      const defaultMonitor = new SystemResourceMonitor();
      const thresholds = defaultMonitor.getThresholds();

      expect(thresholds.maxCpuPercent).toBe(80);
      expect(thresholds.minMemoryBytes).toBe(1_000_000_000);
    });
  });

  describe('Worker count management', () => {
    it('should increment worker count', () => {
      monitor.incrementWorkerCount();
      monitor.incrementWorkerCount();
      monitor.incrementWorkerCount();

      monitor.getResources().then(result => {
        if (result.ok) {
          expect(result.value.workerCount).toBe(3);
        }
      });
    });

    it('should decrement worker count', () => {
      monitor.incrementWorkerCount();
      monitor.incrementWorkerCount();
      monitor.decrementWorkerCount();

      monitor.getResources().then(result => {
        if (result.ok) {
          expect(result.value.workerCount).toBe(1);
        }
      });
    });

    it('should not go below zero workers', () => {
      monitor.decrementWorkerCount();
      monitor.decrementWorkerCount();

      monitor.getResources().then(result => {
        if (result.ok) {
          expect(result.value.workerCount).toBe(0);
        }
      });
    });
  });

  describe('Periodic monitoring', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start monitoring and emit events', async () => {
      let eventEmitted = false;
      eventBus.subscribe('SystemResourcesUpdated', async () => {
        eventEmitted = true;
      });

      monitor.startMonitoring();

      // Advance time to trigger monitoring
      await vi.advanceTimersByTimeAsync(100);

      expect(eventEmitted).toBe(true);
      expect(logger.hasLog('info', 'Starting resource monitoring')).toBe(true);
    });

    it('should emit events periodically', async () => {
      let eventCount = 0;
      eventBus.subscribe('SystemResourcesUpdated', async () => {
        eventCount++;
      });

      monitor.startMonitoring();

      // Trigger multiple monitoring cycles
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      expect(eventCount).toBe(3);
    });

    it('should include resource data in events', async () => {
      let capturedEvent: any = null;
      eventBus.subscribe('SystemResourcesUpdated', async (event) => {
        capturedEvent = event;
      });

      monitor.incrementWorkerCount();
      monitor.incrementWorkerCount();

      monitor.startMonitoring();
      await vi.advanceTimersByTimeAsync(100);

      expect(capturedEvent).toMatchObject({
        cpuPercent: expect.any(Number),
        memoryUsed: expect.any(Number),
        workerCount: 2
      });
    });

    it('should stop monitoring', async () => {
      let eventCount = 0;
      eventBus.subscribe('SystemResourcesUpdated', async () => {
        eventCount++;
      });

      monitor.startMonitoring();
      await vi.advanceTimersByTimeAsync(100);

      monitor.stopMonitoring();

      // Should not emit more events
      await vi.advanceTimersByTimeAsync(200);

      expect(eventCount).toBe(1);
      expect(logger.hasLog('info', 'Stopped resource monitoring')).toBe(true);
    });

    it('should not start monitoring twice', () => {
      monitor.startMonitoring();
      monitor.startMonitoring();

      const startLogs = logger.logs.filter(l =>
        l.message === 'Starting resource monitoring'
      );
      expect(startLogs).toHaveLength(1);
    });

    it('should not stop if not monitoring', () => {
      monitor.stopMonitoring();

      expect(logger.hasLog('info', 'Stopped resource monitoring')).toBe(false);
    });

    it('should handle monitoring without event bus', async () => {
      const monitorNoEvents = new SystemResourceMonitor(
        80,
        1_000_000_000,
        undefined,
        logger
      );

      monitorNoEvents.startMonitoring();
      await vi.advanceTimersByTimeAsync(100);

      // Should not crash
      expect(true).toBe(true);
    });

    it('should handle event emission failures', async () => {
      const failingBus = new InMemoryEventBus();
      failingBus.emit = vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('Emit failed')
      });

      const monitorWithFailingBus = new SystemResourceMonitor(
        80,
        1_000_000_000,
        failingBus,
        logger,
        50
      );

      monitorWithFailingBus.startMonitoring();
      await vi.advanceTimersByTimeAsync(50);

      expect(logger.hasLog('error', 'Failed to emit SystemResourcesUpdated event')).toBe(true);

      // Should continue monitoring despite failure
      await vi.advanceTimersByTimeAsync(50);
      expect(failingBus.emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should handle OS module failures gracefully', async () => {
      vi.mocked(os.loadavg).mockImplementation(() => {
        throw new Error('OS error');
      });

      const result = await monitor.getResources();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RESOURCE_MONITORING_FAILED');
        expect(result.error.message).toContain('OS error');
      }
    });

    it('should continue monitoring after resource check failure', async () => {
      vi.useFakeTimers();

      let checkCount = 0;
      vi.mocked(os.loadavg).mockImplementation(() => {
        checkCount++;
        if (checkCount === 1) {
          throw new Error('Temporary failure');
        }
        return [1.0, 1.0, 1.0];
      });

      let eventCount = 0;
      eventBus.subscribe('SystemResourcesUpdated', async () => {
        eventCount++;
      });

      monitor.startMonitoring();

      // First check fails
      await vi.advanceTimersByTimeAsync(100);
      expect(eventCount).toBe(0);

      // Second check succeeds
      await vi.advanceTimersByTimeAsync(100);
      expect(eventCount).toBe(1);

      vi.useRealTimers();
    });
  });
});

describe('TestResourceMonitor - Test Double Behavior', () => {
  let monitor: TestResourceMonitor;

  beforeEach(() => {
    monitor = new TestResourceMonitor();
  });

  describe('Configurable resources', () => {
    it('should return default resources', async () => {
      const result = await monitor.getResources();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          cpuUsage: 20,
          availableMemory: 8_000_000_000,
          totalMemory: 16_000_000_000,
          loadAverage: [1.5, 1.2, 1.0],
          workerCount: 0
        });
      }
    });

    it('should allow setting CPU usage', async () => {
      monitor.setCpuUsage(75);

      const result = await monitor.getResources();
      if (result.ok) {
        expect(result.value.cpuUsage).toBe(75);
      }
    });

    it('should allow setting available memory', async () => {
      monitor.setAvailableMemory(2_000_000_000);

      const result = await monitor.getResources();
      if (result.ok) {
        expect(result.value.availableMemory).toBe(2_000_000_000);
      }
    });

    it('should allow setting worker count', async () => {
      monitor.setWorkerCount(5);

      const result = await monitor.getResources();
      if (result.ok) {
        expect(result.value.workerCount).toBe(5);
      }
    });
  });

  describe('Spawn eligibility simulation', () => {
    it('should allow spawn with default settings', async () => {
      const result = await monitor.canSpawnWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should deny spawn when CPU too high', async () => {
      monitor.setCpuUsage(85);

      const result = await monitor.canSpawnWorker();
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should deny spawn when memory too low', async () => {
      monitor.setAvailableMemory(500_000_000);

      const result = await monitor.canSpawnWorker();
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should respect custom thresholds', async () => {
      const customMonitor = new TestResourceMonitor(50, 2_000_000_000);
      customMonitor.setCpuUsage(45);
      customMonitor.setAvailableMemory(3_000_000_000);

      const result = await customMonitor.canSpawnWorker();
      if (result.ok) {
        expect(result.value).toBe(true);
      }

      customMonitor.setCpuUsage(55);
      const result2 = await customMonitor.canSpawnWorker();
      if (result2.ok) {
        expect(result2.value).toBe(false);
      }
    });
  });

  describe('Worker count management', () => {
    it('should increment and decrement worker count', () => {
      monitor.incrementWorkerCount();
      monitor.incrementWorkerCount();

      monitor.getResources().then(r => {
        if (r.ok) expect(r.value.workerCount).toBe(2);
      });

      monitor.decrementWorkerCount();

      monitor.getResources().then(r => {
        if (r.ok) expect(r.value.workerCount).toBe(1);
      });
    });

    it('should not go negative', () => {
      monitor.decrementWorkerCount();

      monitor.getResources().then(r => {
        if (r.ok) expect(r.value.workerCount).toBe(0);
      });
    });
  });

  describe('Threshold access', () => {
    it('should return configured thresholds', () => {
      const thresholds = monitor.getThresholds();

      expect(thresholds.maxCpuPercent).toBe(80);
      expect(thresholds.minMemoryBytes).toBe(1_000_000_000);
    });

    it('should return custom thresholds', () => {
      const customMonitor = new TestResourceMonitor(60, 3_000_000_000);
      const thresholds = customMonitor.getThresholds();

      expect(thresholds.maxCpuPercent).toBe(60);
      expect(thresholds.minMemoryBytes).toBe(3_000_000_000);
    });
  });

  describe('Test scenarios', () => {
    it('should simulate gradual resource exhaustion', async () => {
      const results: boolean[] = [];

      for (let cpu = 0; cpu <= 100; cpu += 20) {
        monitor.setCpuUsage(cpu);
        const result = await monitor.canSpawnWorker();
        if (result.ok) {
          results.push(result.value);
        }
      }

      expect(results).toEqual([true, true, true, true, false, false]);
    });

    it('should simulate memory pressure', async () => {
      const memoryLevels = [
        8_000_000_000,  // 8GB - plenty
        2_000_000_000,  // 2GB - above reserve
        1_100_000_000,  // 1.1GB - just above
        900_000_000,    // 900MB - below reserve
        100_000_000     // 100MB - critical
      ];

      for (const memory of memoryLevels) {
        monitor.setAvailableMemory(memory);
        const result = await monitor.canSpawnWorker();
        if (result.ok) {
          const canSpawn = result.value;
          if (memory > 1_000_000_000) {
            expect(canSpawn).toBe(true);
          } else {
            expect(canSpawn).toBe(false);
          }
        }
      }
    });
  });
});