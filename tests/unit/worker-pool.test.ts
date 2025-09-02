import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoscalingWorkerPool } from '../../src/implementations/worker-pool.js';
import { TaskId } from '../../src/core/domain.js';
import { taskTimeout } from '../../src/core/errors.js';
import type { ProcessSpawner, ResourceMonitor, Logger, OutputCapture } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, TEST_CONSTANTS, AssertionHelpers, MockVerification } from '../helpers/test-factories.js';

describe('AutoscalingWorkerPool Timer Management', () => {
  let workerPool: AutoscalingWorkerPool;
  let mockSpawner: ProcessSpawner;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockOutputCapture: OutputCapture;
  let onTaskTimeout: vi.Mock;

  beforeEach(() => {
    mockSpawner = MockFactory.processSpawner();
    mockMonitor = MockFactory.resourceMonitor(true);
    mockLogger = MockFactory.logger();
    mockOutputCapture = MockFactory.outputCapture();

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
      const task = TaskFactory.withTimeout(TEST_CONSTANTS.FIVE_SECONDS_MS);

      const result = await workerPool.spawn(task);
      
      AssertionHelpers.expectSuccessResult(result);
      expect(workerPool.hasTimer(task.id)).toBe(true);
    });

    it('should not set timer when task has no timeout', async () => {
      const task = TaskFactory.basic(); // No timeout specified

      const result = await workerPool.spawn(task);
      
      AssertionHelpers.expectSuccessResult(result);
      expect(workerPool.hasTimer(task.id)).toBe(false);
    });

    it('should call timeout handler when timer expires', async () => {
      vi.useFakeTimers();

      const task = TaskFactory.withTimeout(TEST_CONSTANTS.ONE_SECOND_MS);

      await workerPool.spawn(task);
      
      // Fast-forward time past timeout
      vi.advanceTimersByTime(TEST_CONSTANTS.ONE_SECOND_MS + TEST_CONSTANTS.TIMEOUT_BUFFER_MS);
      
      MockVerification.expectCalledOnceWith(
        onTaskTimeout,
        task.id,
        taskTimeout(task.id, TEST_CONSTANTS.ONE_SECOND_MS)
      );

      vi.useRealTimers();
    });

    it('should clear timer when worker completes naturally', async () => {
      const task = TaskFactory.withTimeout(TEST_CONSTANTS.FIVE_SECONDS_MS);

      const spawnResult = await workerPool.spawn(task);
      const worker = AssertionHelpers.expectSuccessResult(spawnResult);
      
      expect(workerPool.hasTimer(task.id)).toBe(true);

      // Simulate natural completion
      const killResult = await workerPool.kill(worker.id);
      AssertionHelpers.expectSuccessResult(killResult);
      
      expect(workerPool.hasTimer(task.id)).toBe(false);
    });

    it('should clear timer when worker is manually killed', async () => {
      const task = TaskFactory.withTimeout(TEST_CONSTANTS.FIVE_SECONDS_MS);

      const spawnResult = await workerPool.spawn(task);
      const worker = AssertionHelpers.expectSuccessResult(spawnResult);
      
      expect(workerPool.hasTimer(task.id)).toBe(true);

      // Kill worker manually
      const killResult = await workerPool.kill(worker.id);
      AssertionHelpers.expectSuccessResult(killResult);
      
      expect(workerPool.hasTimer(task.id)).toBe(false);
    });
  });
});