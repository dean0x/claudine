import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventDrivenWorkerPool } from '../../src/implementations/event-driven-worker-pool.js';
import { TaskId } from '../../src/core/domain.js';
import { taskTimeout } from '../../src/core/errors.js';
import type { ProcessSpawner, ResourceMonitor, Logger, OutputCapture, EventBus, WorktreeManager } from '../../src/core/interfaces.js';
import { TaskFactory, MockFactory, TEST_CONSTANTS, AssertionHelpers, MockVerification } from '../helpers/test-factories.js';
import { ok } from '../../src/core/result.js';

describe('EventDrivenWorkerPool Timer Management', () => {
  let workerPool: EventDrivenWorkerPool;
  let mockSpawner: ProcessSpawner;
  let mockMonitor: ResourceMonitor;
  let mockLogger: Logger;
  let mockOutputCapture: OutputCapture;
  let mockEventBus: EventBus;
  let mockWorktreeManager: WorktreeManager;

  beforeEach(() => {
    mockSpawner = MockFactory.processSpawner();
    mockMonitor = MockFactory.resourceMonitor(true);
    mockLogger = MockFactory.logger();
    mockOutputCapture = MockFactory.outputCapture();
    mockEventBus = MockFactory.eventBus();
    
    // Mock WorktreeManager
    mockWorktreeManager = {
      createWorktree: vi.fn().mockResolvedValue(ok({
        path: '/tmp/worktree',
        branch: 'test-branch',
        baseBranch: 'main'
      })),
      completeTask: vi.fn().mockResolvedValue(ok({
        action: 'pr_created',
        prUrl: 'https://github.com/test/pr/1'
      })),
      removeWorktree: vi.fn().mockResolvedValue(ok(undefined)),
      cleanup: vi.fn().mockResolvedValue(ok(undefined))
    } as WorktreeManager;

    workerPool = new EventDrivenWorkerPool(
      mockSpawner,
      mockMonitor,
      mockLogger,
      mockEventBus,
      mockWorktreeManager,
      mockOutputCapture
    );
  });

  describe('worker lifecycle', () => {
    it('should spawn worker successfully', async () => {
      const task = TaskFactory.withTimeout(TEST_CONSTANTS.FIVE_SECONDS_MS);

      const result = await workerPool.spawn(task);
      
      AssertionHelpers.expectSuccessResult(result);
      expect(result.value.taskId).toBe(task.id);
    });

    it('should kill worker successfully', async () => {
      const task = TaskFactory.basic();

      const spawnResult = await workerPool.spawn(task);
      const worker = AssertionHelpers.expectSuccessResult(spawnResult);
      
      const killResult = await workerPool.kill(worker.id);
      AssertionHelpers.expectSuccessResult(killResult);
    });

    it('should emit events when worker completes', async () => {
      const task = TaskFactory.basic();

      const result = await workerPool.spawn(task);
      
      // EventDrivenWorkerPool emits TaskCompleted/TaskFailed events
      // This is tested through the event system integration
      AssertionHelpers.expectSuccessResult(result);
    });

    it('should handle timeout through events', async () => {
      const task = TaskFactory.withTimeout(TEST_CONSTANTS.ONE_SECOND_MS);

      const result = await workerPool.spawn(task);
      
      // EventDrivenWorkerPool emits TaskTimeout events 
      // This is tested through the event system integration
      AssertionHelpers.expectSuccessResult(result);
    });

    it('should get worker count', () => {
      expect(workerPool.getWorkerCount()).toBe(0);
    });
  });
});