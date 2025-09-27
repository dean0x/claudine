/**
 * Integration test for event-driven architecture
 * Tests the coordination between EventBus, handlers, and services
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryEventBus } from '../../src/core/events/event-bus.js';
import { TaskManagerService } from '../../src/services/task-manager.js';
import { EventDrivenWorkerPool } from '../../src/implementations/event-driven-worker-pool.js';
import { PriorityTaskQueue } from '../../src/implementations/task-queue.js';
import { loadConfiguration } from '../../src/core/configuration.js';
import { SQLiteTaskRepository } from '../../src/implementations/task-repository.js';
import { Database } from '../../src/implementations/database.js';
import { TestLogger } from '../fixtures/test-doubles.js';
import { MockProcessSpawner } from '../fixtures/mock-process-spawner.js';
import { BufferedOutputCapture } from '../../src/implementations/output-capture.js';
import { createTestTask as createTask } from '../fixtures/test-data.js';
import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Task, WorkerId } from '../../src/core/domain.js';

describe('Integration: Event-driven task delegation flow', () => {
  it('should coordinate task delegation through events', async () => {
  // Setup test database
  const tempDir = await mkdtemp(join(tmpdir(), 'claudine-test-'));
  const dbPath = join(tempDir, 'test.db');

  // Initialize components
  const logger = new TestLogger(); // Quiet for tests
  const eventBus = new InMemoryEventBus(logger);
  // Database constructor automatically initializes the database
  const database = new Database(dbPath);
  const repository = new SQLiteTaskRepository(database);
  const queue = new PriorityTaskQueue(logger);
  const { MockResourceMonitor } = await import('../fixtures/mock-resource-monitor.js');
  const resourceMonitor = new MockResourceMonitor();
  const processSpawner = new MockProcessSpawner();
  const outputCapture = new BufferedOutputCapture(10 * 1024 * 1024, eventBus);

  // Initialize worker pool with test worktree manager
  // Note: WorktreeManager is not fully implemented yet, using minimal stub for integration test
  const worktreeManager: any = {
    createWorktree: async () => ({ ok: false, error: new Error('Worktree creation not implemented in test') }),
    cleanupWorktree: async () => ({ ok: true, value: undefined }),
    removeWorktree: async () => ({ ok: true, value: undefined }),
    completeTask: async () => ({ ok: true, value: { merged: false, prUrl: null } })
  };

  const workerPool = new EventDrivenWorkerPool(
    processSpawner,    // spawner
    resourceMonitor,   // monitor
    logger,           // logger
    eventBus,         // eventBus
    worktreeManager,  // worktreeManager
    outputCapture     // outputCapture
  );

  // Initialize task manager with all required parameters
  const config = loadConfiguration();
  const taskManager = new TaskManagerService(
    eventBus,
    repository,  // repository for backwards compatibility
    logger,      // logger is required
    config,      // config is required
    outputCapture // optional output capture
  );

  // Track events
  const events: string[] = [];
  const taskStates = new Map<string, string>();

  // Subscribe to events
  eventBus.on('TaskDelegated', () => events.push('TaskDelegated'));
  eventBus.on('TaskQueued', () => events.push('TaskQueued'));
  eventBus.on('WorkerSpawned', () => events.push('WorkerSpawned'));
  eventBus.on('TaskCompleted', (data) => {
    events.push('TaskCompleted');
    taskStates.set(data.taskId, 'completed');
  });
  eventBus.on('TaskFailed', (data) => {
    events.push('TaskFailed');
    taskStates.set(data.taskId, 'failed');
  });

  // Setup persistence handler
  eventBus.on('TaskDelegated', async (data) => {
    const saveResult = await repository.save(data.task);
    if (!saveResult.ok) {
      throw new Error(`Failed to save task: ${saveResult.error.message}`);
    }
  });

  // Setup queue handler
  eventBus.on('TaskDelegated', async (data) => {
    queue.enqueue(data.task);
    eventBus.emit('TaskQueued', { task: data.task });
  });

  // Setup worker handler
  eventBus.on('TaskQueued', async (data) => {
    const canSpawn = await resourceMonitor.hasAvailableResources();
    if (canSpawn) {
      const result = await workerPool.spawn(data.task);
      if (result.ok) {
        eventBus.emit('WorkerSpawned', { workerId: result.value.id, task: data.task });
      }
    }
  });

  // Setup query handler for TaskStatusQuery
  eventBus.onRequest('TaskStatusQuery', async (event) => {
    const { taskId } = event;
    if (taskId) {
      const result = await repository.findById(taskId);
      if (result.ok) {
        return { ok: true, value: { task: result.value } };
      }
    }
    return { ok: false, error: new Error('Task not found') };
  });

  try {
    // Test 1: Delegate a simple task
    const request1 = {
      prompt: 'echo "Integration test"',
      priority: 'P0' as const
    };

    const delegateResult = await taskManager.delegate(request1);
    expect(delegateResult.ok).toBe(true);
    const task1 = delegateResult.ok ? delegateResult.value : null;
    expect(task1).toBeTruthy();

    // Wait for async events to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify event sequence
    expect(events).toContain('TaskDelegated');
    expect(events).toContain('TaskQueued');
    expect(events).toContain('WorkerSpawned');

    // Test 2: Query task status via event bus
    // Give time for the task to be saved to database
    await new Promise(resolve => setTimeout(resolve, 50));
    const statusResult = await eventBus.request('TaskStatusQuery', { taskId: task1!.id });
    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      expect(statusResult.value.task?.id).toBe(task1!.id);
    }

    // Test 3: Handle task completion
    processSpawner.simulateCompletion(task1!.id, 'Integration test output');
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(events).toContain('TaskCompleted');
    expect(taskStates.get(task1!.id)).toBe('completed');

    // Test 4: Multiple tasks with different priorities
    const requestP2 = { prompt: 'P2 task', priority: 'P2' as const };
    const requestP0 = { prompt: 'P0 task', priority: 'P0' as const };
    const requestP1 = { prompt: 'P1 task', priority: 'P1' as const };

    await taskManager.delegate(requestP2);
    await taskManager.delegate(requestP0);
    await taskManager.delegate(requestP1);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify queue ordering (P0 should be dequeued first)
    const dequeueResult = queue.dequeue();
    expect(dequeueResult.ok).toBe(true);
    if (dequeueResult.ok) {
      const nextTask = dequeueResult.value;
      expect(nextTask).toBeTruthy();
      if (nextTask) {
        expect(nextTask.priority).toBe('P0');
      }
    }

    // Test 5: Error handling
    const errorRequest = { prompt: 'error task' };
    const errorResult = await taskManager.delegate(errorRequest);
    const errorTask = errorResult.ok ? errorResult.value : null;
    expect(errorTask).toBeTruthy();

    processSpawner.simulateError(errorTask!.id, new Error('Simulated error'));
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(events).toContain('TaskFailed');
    expect(taskStates.get(errorTask!.id)).toBe('failed');

    // Test 6: Concurrent event handling
    const concurrentRequests = Array.from({ length: 5 }, (_, i) =>
      ({ prompt: `Concurrent task ${i}` })
    );

    await Promise.all(concurrentRequests.map(request => taskManager.delegate(request)));
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify all tasks were queued
    const queuedCount = events.filter(e => e === 'TaskQueued').length;
    expect(queuedCount).toBeGreaterThanOrEqual(5);

  } finally {
    // Cleanup
    eventBus.dispose();
    database.close();
    await rm(tempDir, { recursive: true, force: true });
  }
  });
});

describe('Integration: Request-response pattern with timeout', () => {
  it('should handle timeouts correctly', async () => {
  const logger = new TestLogger();
  const eventBus = new InMemoryEventBus(logger);

  // Setup handler that responds slowly
  eventBus.onRequest('SlowQuery', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { ok: true, value: 'slow response' };
  });

  // Setup handler that never responds
  eventBus.onRequest('HangingQuery', async () => {
    await new Promise(() => {}); // Never resolves
    return { ok: true, value: 'never' };
  });

  try {
    // Test normal response
    const result = await eventBus.request('SlowQuery', {}, 200);
    expect(result.ok).toBe(true);

    // Test timeout
    const timeoutResult = await eventBus.request('HangingQuery', {}, 50);
    expect(timeoutResult.ok).toBe(false);
    if (!timeoutResult.ok) {
      expect(timeoutResult.error.message).toContain('timeout');
    }

  } finally {
    eventBus.dispose();
  }
  });
});

describe('Integration: Event handler registration and cleanup', () => {
  it('should manage event handlers correctly', async () => {
  const logger = new TestLogger();
  const eventBus = new InMemoryEventBus(logger);
  const received: number[] = [];

  // Register multiple handlers
  const sub1 = eventBus.on('TestEvent', (data) => received.push(data.value));
  const sub2 = eventBus.on('TestEvent', (data) => received.push(data.value * 2));
  const sub3 = eventBus.on('TestEvent', (data) => received.push(data.value * 3));

  // Emit event
  eventBus.emit('TestEvent', { value: 10 });
  await new Promise(resolve => setTimeout(resolve, 10));

  expect(received.length).toBe(3);
  expect(received).toContain(10);
  expect(received).toContain(20);
  expect(received).toContain(30);

  // Unsubscribe one handler
  eventBus.off('TestEvent', sub2);
  received.length = 0;

  eventBus.emit('TestEvent', { value: 5 });
  await new Promise(resolve => setTimeout(resolve, 10));

  expect(received.length).toBe(2);
  expect(received).toContain(5);
  expect(received).toContain(15);
  expect(received).not.toContain(10);

  eventBus.dispose();
  });
});