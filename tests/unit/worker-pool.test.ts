import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoscalingWorkerPool } from '../../src/implementations/worker-pool.js';
import { createTask, TaskId } from '../../src/core/domain.js';
import { ok, err } from '../../src/core/result.js';
import { taskTimeout, ErrorCode } from '../../src/core/errors.js';
import type { ProcessSpawner, ResourceMonitor, Logger, OutputCapture } from '../../src/core/interfaces.js';

describe('AutoscalingWorkerPool Timer Management', () => {
  let workerPool: AutoscalingWorkerPool;
  let mockSpawner: ProcessSpawner;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockOutputCapture: OutputCapture;
  let onTaskTimeout: vi.Mock;

  beforeEach(() => {
    const mockProcess = {
      pid: 1234,
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() }
    };

    mockSpawner = {
      spawn: vi.fn().mockReturnValue(ok({ 
        process: mockProcess,
        pid: 1234 
      })),
      kill: vi.fn().mockReturnValue(ok(undefined))
    } as ProcessSpawner;

    mockMonitor = {
      canSpawnWorker: vi.fn().mockResolvedValue(ok(true)),
      incrementWorkerCount: vi.fn(),
      decrementWorkerCount: vi.fn()
    } as any;

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as any;

    mockOutputCapture = {} as OutputCapture;

    onTaskTimeout = vi.fn();

    workerPool = new AutoscalingWorkerPool(
      mockSpawner,
      mockMonitor,
      mockLogger,
      mockOutputCapture
    );

    workerPool.setTaskTimeoutHandler(onTaskTimeout);
  });

  describe('timeout management', () => {
    it('should set timer when task has timeout configured', async () => {
      const task = createTask({
        prompt: 'test task',
        timeout: 5000 // 5 seconds
      });

      const result = await workerPool.spawn(task);
      
      expect(result.ok).toBe(true);
      expect(workerPool.hasTimer(task.id)).toBe(true);
    });

    it('should not set timer when task has no timeout', async () => {
      const task = createTask({
        prompt: 'test task'
        // no timeout specified
      });

      const result = await workerPool.spawn(task);
      
      expect(result.ok).toBe(true);
      expect(workerPool.hasTimer(task.id)).toBe(false);
    });

    it('should call timeout handler when timer expires', async () => {
      vi.useFakeTimers();

      const task = createTask({
        prompt: 'test task',
        timeout: 1000 // 1 second
      });

      await workerPool.spawn(task);
      
      // Fast-forward time past timeout
      vi.advanceTimersByTime(1100);
      
      expect(onTaskTimeout).toHaveBeenCalledWith(
        task.id,
        taskTimeout(task.id, 1000)
      );

      vi.useRealTimers();
    });

    it('should clear timer when worker completes naturally', async () => {
      const task = createTask({
        prompt: 'test task',
        timeout: 5000
      });

      const spawnResult = await workerPool.spawn(task);
      expect(spawnResult.ok).toBe(true);
      
      const worker = spawnResult.value;
      expect(workerPool.hasTimer(task.id)).toBe(true);

      // Simulate natural completion
      await workerPool.kill(worker.id);
      
      expect(workerPool.hasTimer(task.id)).toBe(false);
    });

    it('should clear timer when worker is manually killed', async () => {
      const task = createTask({
        prompt: 'test task',
        timeout: 5000
      });

      const spawnResult = await workerPool.spawn(task);
      expect(spawnResult.ok).toBe(true);
      
      const worker = spawnResult.value;
      expect(workerPool.hasTimer(task.id)).toBe(true);

      // Kill worker manually
      await workerPool.kill(worker.id);
      
      expect(workerPool.hasTimer(task.id)).toBe(false);
    });
  });
});