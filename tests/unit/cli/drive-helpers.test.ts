import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isWorkerInvocation,
  stripWorkerFlag,
  WORKER_FLAG,
  waitForChannelCompletion,
  waitForLoopCompletion,
  waitForPipelineCompletion,
  waitForTaskCompletion,
} from '../../../src/cli/drive-helpers.js';
import { loadConfiguration } from '../../../src/core/configuration.js';
import { Container } from '../../../src/core/container.js';
import { ChannelId, LoopId, LoopStatus, PipelineId, TaskId } from '../../../src/core/domain.js';
import { InMemoryEventBus } from '../../../src/core/events/event-bus.js';
import type {
  ChannelDestroyedEvent,
  LoopCancelledEvent,
  LoopCompletedEvent,
  PipelineCancelledEvent,
  PipelineCompletedEvent,
  PipelineFailedEvent,
  TaskCancelledEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
} from '../../../src/core/events/events.js';
import { ok } from '../../../src/core/result.js';

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

describe('drive-helpers — worker flag', () => {
  it('isWorkerInvocation detects the hidden worker flag', () => {
    expect(isWorkerInvocation(['analyze', WORKER_FLAG])).toBe(true);
    expect(isWorkerInvocation(['analyze', '--agent', 'claude'])).toBe(false);
  });

  it('stripWorkerFlag removes only the worker flag', () => {
    expect(stripWorkerFlag(['analyze', WORKER_FLAG, '--agent', 'claude'])).toEqual(['analyze', '--agent', 'claude']);
    expect(stripWorkerFlag(['analyze'])).toEqual(['analyze']);
  });

  it('WORKER_FLAG is an internal double-underscore flag', () => {
    expect(WORKER_FLAG.startsWith('--__')).toBe(true);
  });
});

describe('drive-helpers — terminal-event waiters', () => {
  let eventBus: InMemoryEventBus;
  let container: Container;

  const containerWith = (extra?: (c: Container) => void): Container => {
    const c = new Container();
    c.registerValue('eventBus', eventBus);
    extra?.(c);
    return c;
  };

  beforeEach(() => {
    eventBus = new InMemoryEventBus(loadConfiguration(), mockLogger);
    container = containerWith();
  });

  describe('waitForTaskCompletion', () => {
    it('resolves with the exit code from TaskCompleted', async () => {
      const taskId = TaskId('task-1');
      const promise = waitForTaskCompletion(container, taskId);
      await eventBus.emit<TaskCompletedEvent>('TaskCompleted', { taskId, exitCode: 0, duration: 1 });
      expect(await promise).toBe(0);
    });

    it('resolves with TaskFailed exit code, defaulting to 1', async () => {
      const taskId = TaskId('task-2');
      const promise = waitForTaskCompletion(container, taskId);
      await eventBus.emit<TaskFailedEvent>('TaskFailed', { taskId } as TaskFailedEvent);
      expect(await promise).toBe(1);
    });

    it('resolves with 1 on TaskCancelled', async () => {
      const taskId = TaskId('task-3');
      const promise = waitForTaskCompletion(container, taskId);
      await eventBus.emit<TaskCancelledEvent>('TaskCancelled', { taskId, reason: 'x' });
      expect(await promise).toBe(1);
    });

    it('ignores events for other task ids', async () => {
      const promise = waitForTaskCompletion(container, TaskId('task-mine'));
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      await eventBus.emit<TaskCompletedEvent>('TaskCompleted', {
        taskId: TaskId('task-other'),
        exitCode: 0,
        duration: 1,
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false);
    });
  });

  describe('waitForLoopCompletion', () => {
    const withLoopStatus = (status: LoopStatus) =>
      containerWith((c) => {
        c.registerValue('loopRepository', {
          findById: async () => ok({ status }),
        });
      });

    it('maps a COMPLETED loop to exit 0', async () => {
      const loopId = LoopId('loop-1');
      const c = withLoopStatus(LoopStatus.COMPLETED);
      const promise = waitForLoopCompletion(c, loopId);
      await eventBus.emit<LoopCompletedEvent>('LoopCompleted', { loopId, reason: 'done' });
      expect(await promise).toBe(0);
    });

    it('maps a FAILED loop to exit 1', async () => {
      const loopId = LoopId('loop-2');
      const c = withLoopStatus(LoopStatus.FAILED);
      const promise = waitForLoopCompletion(c, loopId);
      await eventBus.emit<LoopCompletedEvent>('LoopCompleted', { loopId, reason: 'max failures' });
      expect(await promise).toBe(1);
    });

    it('resolves with 1 on LoopCancelled', async () => {
      const loopId = LoopId('loop-3');
      const promise = waitForLoopCompletion(container, loopId);
      await eventBus.emit<LoopCancelledEvent>('LoopCancelled', { loopId });
      expect(await promise).toBe(1);
    });

    // FAIL HONESTLY: when the terminal loop status cannot be determined, the worker must
    // exit non-zero rather than silently reporting success and masking a failed loop.
    it('exits 1 when the loop repository is unavailable', async () => {
      const loopId = LoopId('loop-4');
      // container (default) has no loopRepository registered.
      const promise = waitForLoopCompletion(container, loopId);
      await eventBus.emit<LoopCompletedEvent>('LoopCompleted', { loopId, reason: 'done' });
      expect(await promise).toBe(1);
    });

    it('exits 1 when the status read fails', async () => {
      const loopId = LoopId('loop-5');
      const c = containerWith((cc) => {
        cc.registerValue('loopRepository', {
          findById: async () => ({ ok: false, error: new Error('db read failed') }),
        });
      });
      const promise = waitForLoopCompletion(c, loopId);
      await eventBus.emit<LoopCompletedEvent>('LoopCompleted', { loopId, reason: 'done' });
      expect(await promise).toBe(1);
    });

    it('exits 1 when the loop record is not found', async () => {
      const loopId = LoopId('loop-6');
      const c = containerWith((cc) => {
        cc.registerValue('loopRepository', { findById: async () => ok(null) });
      });
      const promise = waitForLoopCompletion(c, loopId);
      await eventBus.emit<LoopCompletedEvent>('LoopCompleted', { loopId, reason: 'done' });
      expect(await promise).toBe(1);
    });
  });

  describe('waitForPipelineCompletion', () => {
    it('maps PipelineCompleted → 0, Failed → 1, Cancelled → 1', async () => {
      const completed = waitForPipelineCompletion(container, PipelineId('pipeline-1'));
      await eventBus.emit<PipelineCompletedEvent>('PipelineCompleted', { pipelineId: PipelineId('pipeline-1') });
      expect(await completed).toBe(0);

      const failed = waitForPipelineCompletion(container, PipelineId('pipeline-2'));
      await eventBus.emit<PipelineFailedEvent>('PipelineFailed', {
        pipelineId: PipelineId('pipeline-2'),
        failedStepIndex: 0,
        taskId: TaskId('task-x'),
      });
      expect(await failed).toBe(1);

      const cancelled = waitForPipelineCompletion(container, PipelineId('pipeline-3'));
      await eventBus.emit<PipelineCancelledEvent>('PipelineCancelled', { pipelineId: PipelineId('pipeline-3') });
      expect(await cancelled).toBe(1);
    });
  });

  describe('waitForChannelCompletion', () => {
    it('resolves with 0 on ChannelDestroyed', async () => {
      const channelId = ChannelId('ch-1');
      const promise = waitForChannelCompletion(container, channelId);
      await eventBus.emit<ChannelDestroyedEvent>('ChannelDestroyed', { channelId, reason: 'max-rounds-reached' });
      expect(await promise).toBe(0);
    });
  });

  // RELIABILITY: a waiter whose every subscription fails must exit non-zero immediately
  // rather than leaving the detached worker process hung forever waiting for an event that
  // can never arrive. waitForChannelCompletion is the worst case (single subscription).
  describe('awaitTerminal — zero-subscription guard', () => {
    it('exits 1 (does not hang) when the event subscription fails', async () => {
      const failingBus = {
        subscribe: () => ({ ok: false as const, error: new Error('subscribe failed') }),
        unsubscribe: () => ({ ok: true as const, value: undefined }),
      };
      const c = new Container();
      c.registerValue('eventBus', failingBus);
      // Without the guard this promise would never settle; the test would time out.
      expect(await waitForChannelCompletion(c, ChannelId('ch-zero'))).toBe(1);
    });
  });
});
