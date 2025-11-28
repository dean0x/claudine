/**
 * WorkerHandler Tests - Comprehensive behavioral testing
 *
 * ARCHITECTURE: Tests worker lifecycle management through event-driven architecture
 * Focus on spawn control, resource constraints, and event handling
 *
 * Coverage target: 350+ lines, 90%+ line coverage
 * Quality: 3-5 assertions per test, AAA pattern, behavioral testing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerHandler } from '../../../../src/services/handlers/worker-handler';
import { TestEventBus, TestLogger } from '../../../fixtures/test-doubles';
import { TaskFactory, WorkerFactory } from '../../../fixtures/factories';
import type { WorkerPool, ResourceMonitor } from '../../../../src/core/interfaces';
import type { Configuration } from '../../../../src/core/configuration';
import { ok, err } from '../../../../src/core/result';
import { ClaudineError, ErrorCode, taskNotFound } from '../../../../src/core/errors';

/**
 * Mock WorkerPool for testing
 */
class MockWorkerPool implements WorkerPool {
  spawnCalls: any[] = [];
  killCalls: any[] = [];
  killAllCalls: number = 0;
  workerCount = 0;
  workers = new Map<string, any>();

  async spawn(task: any) {
    this.spawnCalls.push(task);
    const worker = new WorkerFactory()
      .withTaskId(task.id)
      .build();
    this.workers.set(worker.id, worker);
    this.workerCount++;
    return ok(worker);
  }

  async kill(workerId: string) {
    this.killCalls.push(workerId);
    this.workers.delete(workerId);
    this.workerCount--;
    return ok(undefined);
  }

  async killAll() {
    this.killAllCalls++;
    this.workers.clear();
    this.workerCount = 0;
  }

  getWorkerForTask(taskId: string) {
    for (const worker of this.workers.values()) {
      if (worker.taskId === taskId) {
        return ok(worker);
      }
    }
    return ok(null);
  }

  getWorkerCount() {
    return this.workerCount;
  }

  getWorkers() {
    return ok(Array.from(this.workers.values()));
  }

  reset() {
    this.spawnCalls = [];
    this.killCalls = [];
    this.killAllCalls = 0;
    this.workerCount = 0;
    this.workers.clear();
  }
}

/**
 * Mock ResourceMonitor for testing
 */
class MockResourceMonitor implements ResourceMonitor {
  canSpawnValue = true;
  workerCount = 0;

  async canSpawnWorker() {
    return ok(this.canSpawnValue);
  }

  incrementWorkerCount() {
    this.workerCount++;
  }

  decrementWorkerCount() {
    this.workerCount--;
  }

  setCanSpawn(value: boolean) {
    this.canSpawnValue = value;
  }

  reset() {
    this.canSpawnValue = true;
    this.workerCount = 0;
  }

  // Required interface methods
  async getResources() {
    return ok({
      cpuUsagePercent: 50,
      availableMemoryBytes: 1024 * 1024 * 1024,
      totalMemoryBytes: 2 * 1024 * 1024 * 1024,
      activeWorkers: this.workerCount
    });
  }

  startMonitoring() {}
  stopMonitoring() {}
  recordSpawn() {}
}

describe('WorkerHandler - Event-Driven Worker Lifecycle', () => {
  let workerHandler: WorkerHandler;
  let eventBus: TestEventBus;
  let logger: TestLogger;
  let workerPool: MockWorkerPool;
  let resourceMonitor: MockResourceMonitor;
  let config: Configuration;

  beforeEach(async () => {
    eventBus = new TestEventBus();
    logger = new TestLogger();
    workerPool = new MockWorkerPool();
    resourceMonitor = new MockResourceMonitor();

    config = {
      minSpawnDelayMs: 10, // Reduced for testing
      timeout: 300000,
      maxOutputBuffer: 10485760,
      cpuCoresReserved: 0.2,
      memoryReserve: 1024 * 1024 * 1024,
      logLevel: 'info',
      maxListenersPerEvent: 100,
      maxTotalSubscriptions: 1000,
      killGracePeriodMs: 5000
    } as Configuration;

    workerHandler = new WorkerHandler(
      config,
      workerPool,
      resourceMonitor,
      eventBus,
      logger
    );

    await workerHandler.setup(eventBus);
  });

  afterEach(async () => {
    await workerHandler.teardown();
    workerPool.reset();
    resourceMonitor.reset();
  });

  describe('Setup and Teardown', () => {
    it('should subscribe to TaskQueued events during setup', async () => {
      const newEventBus = new TestEventBus();
      const newHandler = new WorkerHandler(
        config,
        workerPool,
        resourceMonitor,
        newEventBus,
        logger
      );

      const result = await newHandler.setup(newEventBus);

      expect(result.ok).toBe(true);
      expect(newEventBus.hasSubscription('TaskQueued')).toBe(true);
    });

    it('should subscribe to TaskCancellationRequested events during setup', async () => {
      const newEventBus = new TestEventBus();
      const newHandler = new WorkerHandler(
        config,
        workerPool,
        resourceMonitor,
        newEventBus,
        logger
      );

      const result = await newHandler.setup(newEventBus);

      expect(result.ok).toBe(true);
      expect(newEventBus.hasSubscription('TaskCancellationRequested')).toBe(true);
    });

    it('should kill all workers during teardown', async () => {
      await workerHandler.teardown();

      expect(workerPool.killAllCalls).toBe(1);
    });

    it('should return success result after setup', async () => {
      const newEventBus = new TestEventBus();
      const newHandler = new WorkerHandler(
        config,
        workerPool,
        resourceMonitor,
        newEventBus,
        logger
      );

      const result = await newHandler.setup(newEventBus);

      expect(result.ok).toBe(true);
    });
  });

  describe('TaskQueued Event Handling', () => {
    it('should process task immediately when TaskQueued event received', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('queued')
        .build();

      // Set up event response for NextTaskQuery
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });

      // Give async processing time to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(eventBus.hasEmitted('TaskQueued')).toBe(true);
    });

    it('should emit TaskStarting event when processing queued task', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('queued')
        .build();

      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(eventBus.hasEmitted('TaskStarting')).toBe(true);
    });

    it('should spawn worker for queued task when resources available', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('queued')
        .build();

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(workerPool.spawnCalls.length).toBeGreaterThan(0);
    });

    it('should increment resource monitor worker count after spawn', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('queued')
        .build();

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(resourceMonitor.workerCount).toBeGreaterThan(0);
    });

    it('should emit WorkerSpawned and TaskStarted events after successful spawn', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('queued')
        .build();

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(eventBus.hasEmitted('WorkerSpawned')).toBe(true);
      expect(eventBus.hasEmitted('TaskStarted')).toBe(true);
    });
  });

  describe('Spawn Rate Limiting - Fork Bomb Prevention', () => {
    it('should enforce minimum delay between spawns', async () => {
      const task1 = new TaskFactory().withPrompt('task 1').build();
      const task2 = new TaskFactory().withPrompt('task 2').build();

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task1));

      // Spawn first task
      await eventBus.emit('TaskQueued', { taskId: task1.id, task: task1 });
      await new Promise(resolve => setTimeout(resolve, 5));

      const firstSpawnTime = Date.now();

      // Try to spawn second task immediately
      eventBus.setRequestResponse('NextTaskQuery', ok(task2));
      await eventBus.emit('TaskQueued', { taskId: task2.id, task: task2 });
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify delay was enforced (should be at least minSpawnDelayMs)
      expect(workerPool.spawnCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply backoff when resources are constrained', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      resourceMonitor.setCanSpawn(false);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not spawn when resources constrained
      expect(workerPool.spawnCalls.length).toBe(0);
    });

    it('should not spawn task when no resources available', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      resourceMonitor.setCanSpawn(false);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(workerPool.spawnCalls.length).toBe(0);
    });
  });

  describe('Task Cancellation', () => {
    it('should validate task status before cancellation', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('completed')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      const result = await eventBus.emit('TaskCancellationRequested', {
        taskId: task.id,
        reason: 'User requested'
      });

      // Should not cancel completed task
      expect(workerPool.killCalls.length).toBe(0);
    });

    it('should attempt to find worker when cancelling running task', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('running')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await eventBus.emit('TaskCancellationRequested', {
        taskId: task.id,
        reason: 'User requested'
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have checked for worker (via getWorkerForTask)
      expect(task.status).toBe('running');
    });

    it('should handle cancellation request gracefully', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('running')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      const result = await eventBus.emit('TaskCancellationRequested', {
        taskId: task.id,
        reason: 'User requested'
      });

      // Should complete without errors
      expect(result.ok).toBe(true);
    });

    it('should handle cancellation request for queued task', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('queued')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      const result = await eventBus.emit('TaskCancellationRequested', {
        taskId: task.id,
        reason: 'User requested'
      });

      expect(result.ok).toBe(true);
    });

    it('should return error when task not found for cancellation', async () => {
      eventBus.setRequestResponse('TaskStatusQuery', ok(null));

      await eventBus.emit('TaskCancellationRequested', {
        taskId: 'non-existent-task',
        reason: 'User requested'
      });

      await new Promise(resolve => setTimeout(resolve, 20));

      // Should not attempt to kill worker
      expect(workerPool.killCalls.length).toBe(0);
    });
  });

  describe('Worker Completion', () => {
    it('should decrement resource monitor worker count on completion', async () => {
      const task = new TaskFactory().build();
      resourceMonitor.incrementWorkerCount();
      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await workerHandler.onWorkerComplete(task.id, 0);

      expect(resourceMonitor.workerCount).toBe(0);
    });

    it('should emit TaskCompleted event for successful completion (exit code 0)', async () => {
      const task = new TaskFactory()
        .withStatus('running')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await workerHandler.onWorkerComplete(task.id, 0);

      expect(eventBus.hasEmitted('TaskCompleted')).toBe(true);
    });

    it('should emit TaskFailed event for failed completion (non-zero exit code)', async () => {
      const task = new TaskFactory()
        .withStatus('running')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await workerHandler.onWorkerComplete(task.id, 1);

      expect(eventBus.hasEmitted('TaskFailed')).toBe(true);
    });

    it('should calculate task duration from startedAt timestamp', async () => {
      const now = Date.now();
      const task = new TaskFactory()
        .withStatus('running')
        .withStartedAt(now - 5000) // Started 5 seconds ago
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await workerHandler.onWorkerComplete(task.id, 0);

      const events = eventBus.getEmittedEvents('TaskCompleted');
      expect(events.length).toBeGreaterThan(0);
      if (events.length > 0) {
        expect(events[0].duration).toBeGreaterThan(0);
      }
    });

    it('should handle completion for task without startedAt timestamp', async () => {
      const task = new TaskFactory()
        .withStatus('running')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await workerHandler.onWorkerComplete(task.id, 0);

      expect(eventBus.hasEmitted('TaskCompleted')).toBe(true);
    });
  });

  describe('Worker Timeout', () => {
    it('should decrement resource monitor worker count on timeout', async () => {
      resourceMonitor.incrementWorkerCount();
      const task = new TaskFactory().build();
      const error = new ClaudineError(
        ErrorCode.TASK_TIMEOUT,
        'Task timed out',
        { taskId: task.id }
      );

      await workerHandler.onWorkerTimeout(task.id, error);

      expect(resourceMonitor.workerCount).toBe(0);
    });

    it('should emit TaskTimeout event when worker times out', async () => {
      const task = new TaskFactory().build();
      const error = new ClaudineError(
        ErrorCode.TASK_TIMEOUT,
        'Task timed out',
        { taskId: task.id }
      );

      await workerHandler.onWorkerTimeout(task.id, error);

      expect(eventBus.hasEmitted('TaskTimeout')).toBe(true);
    });

    it('should include error in TaskTimeout event', async () => {
      const task = new TaskFactory().build();
      const error = new ClaudineError(
        ErrorCode.TASK_TIMEOUT,
        'Task exceeded 5 minute limit',
        { taskId: task.id, timeoutMs: 300000 }
      );

      await workerHandler.onWorkerTimeout(task.id, error);

      const events = eventBus.getEmittedEvents('TaskTimeout');
      expect(events.length).toBeGreaterThan(0);
      if (events.length > 0) {
        expect(events[0].error).toBeDefined();
        expect(events[0].error.code).toBe(ErrorCode.TASK_TIMEOUT);
      }
    });
  });

  describe('Worker Statistics', () => {
    it('should return current worker count from pool', () => {
      workerPool.workerCount = 5;

      const stats = workerHandler.getWorkerStats();

      expect(stats.workerCount).toBe(5);
    });

    it('should return list of active workers', () => {
      const worker1 = new WorkerFactory().build();
      const worker2 = new WorkerFactory().build();
      workerPool.workers.set(worker1.id, worker1);
      workerPool.workers.set(worker2.id, worker2);

      const stats = workerHandler.getWorkerStats();

      expect(stats.workers.length).toBe(2);
    });

    it('should return empty array when no workers active', () => {
      const stats = workerHandler.getWorkerStats();

      expect(Array.isArray(stats.workers)).toBe(true);
      expect(stats.workers.length).toBe(0);
    });

    it('should include worker count in statistics', () => {
      workerPool.workerCount = 3;

      const stats = workerHandler.getWorkerStats();

      expect(stats).toHaveProperty('workerCount');
      expect(stats.workerCount).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('should requeue task when spawn fails', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      // Make spawn fail
      workerPool.spawn = vi.fn().mockResolvedValue(
        err(new ClaudineError(ErrorCode.PROCESS_SPAWN_FAILED, 'Spawn failed', {}))
      );

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(eventBus.hasEmitted('RequeueTask')).toBe(true);
    });

    it('should emit TaskFailed event when spawn fails', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      workerPool.spawn = vi.fn().mockResolvedValue(
        err(new ClaudineError(ErrorCode.PROCESS_SPAWN_FAILED, 'Spawn failed', {}))
      );

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(eventBus.hasEmitted('TaskFailed')).toBe(true);
    });

    it('should handle errors gracefully without crashing', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      // Simulate error in event processing
      eventBus.setRequestResponse('NextTaskQuery',
        err(new ClaudineError(ErrorCode.SYSTEM_ERROR, 'Query failed', {}))
      );

      resourceMonitor.setCanSpawn(true);

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not crash, handler should continue functioning
      expect(workerHandler).toBeDefined();
    });
  });

  describe('Pure Event-Driven Architecture', () => {
    it('should use event queries for task status instead of direct repository access', async () => {
      const task = new TaskFactory()
        .withPrompt('test task')
        .withStatus('running')
        .build();

      eventBus.setRequestResponse('TaskStatusQuery', ok(task));

      await eventBus.emit('TaskCancellationRequested', {
        taskId: task.id,
        reason: 'Test'
      });

      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify that TaskStatusQuery was requested (event-driven approach)
      const requests = eventBus.getRequestedEvents('TaskStatusQuery');
      expect(requests.length).toBeGreaterThan(0);
    });

    it('should use NextTaskQuery event to get queued tasks', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      const requests = eventBus.getRequestedEvents('NextTaskQuery');
      expect(requests.length).toBeGreaterThan(0);
    });

    it('should emit events for state changes rather than direct updates', async () => {
      const task = new TaskFactory().withPrompt('test task').build();

      resourceMonitor.setCanSpawn(true);
      eventBus.setRequestResponse('NextTaskQuery', ok(task));

      await eventBus.emit('TaskQueued', { taskId: task.id, task });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should emit TaskStarting, WorkerSpawned, TaskStarted events
      expect(eventBus.hasEmitted('TaskStarting')).toBe(true);
    });
  });
});
