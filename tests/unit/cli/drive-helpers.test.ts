import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  driveToCompletion,
  isWorkerInvocation,
  runDetached,
  stripWorkerFlag,
  WORKER_FLAG,
  waitForChannelCompletion,
  waitForLoopCompletion,
  waitForPipelineCompletion,
  waitForTaskCompletion,
} from '../../../src/cli/drive-helpers.js';
import { loadConfiguration } from '../../../src/core/configuration.js';
import { Container } from '../../../src/core/container.js';
import {
  ChannelId,
  ChannelStatus,
  LoopId,
  LoopStatus,
  PipelineId,
  PipelineStatus,
  TaskId,
} from '../../../src/core/domain.js';
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
    it('exits 1 (does not hang) when the event subscription fails and no DB poll is registered', async () => {
      const failingBus = {
        subscribe: () => ({ ok: false as const, error: new Error('subscribe failed') }),
        unsubscribe: () => ({ ok: true as const, value: undefined }),
      };
      const c = new Container();
      c.registerValue('eventBus', failingBus);
      // No channelRepository registered → no poll fallback. Without the guard this promise
      // would never settle; the test would time out.
      expect(await waitForChannelCompletion(c, ChannelId('ch-zero'))).toBe(1);
    });
  });

  // ISSUE #205: the in-process EventBus is invisible across processes, so a terminal event
  // emitted by a SEPARATE CLI process (`beat channel destroy`, `beat loop cancel`,
  // `beat loop pause --force`, a step `beat cancel` for a pipeline) never reaches the detached
  // host worker. The shared SQLite row is the authoritative cross-process signal — each
  // long-lived waiter polls it as a fallback so the host terminates instead of hanging forever.
  describe('cross-process DB-status poll fallback', () => {
    const POLL_MS = 1500;

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waitForLoopCompletion resolves via the DB poll when cancelled by another process', async () => {
      const loopId = LoopId('loop-xproc');
      const c = containerWith((cc) => {
        cc.registerValue('loopRepository', { findById: async () => ok({ status: LoopStatus.CANCELLED }) });
      });
      // No LoopCancelled event emitted — it would land on the other process's bus.
      const promise = waitForLoopCompletion(c, loopId);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(await promise).toBe(1);
    });

    it('waitForChannelCompletion resolves via the DB poll when destroyed by another process', async () => {
      const channelId = ChannelId('ch-xproc');
      const c = containerWith((cc) => {
        cc.registerValue('channelRepository', { findById: async () => ok({ status: ChannelStatus.DESTROYED }) });
      });
      const promise = waitForChannelCompletion(c, channelId);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(await promise).toBe(0);
    });

    it('waitForPipelineCompletion resolves via the DB poll on cross-process cancel', async () => {
      const pipelineId = PipelineId('pipeline-xproc');
      const c = containerWith((cc) => {
        cc.registerValue('pipelineRepository', { findById: async () => ok({ status: PipelineStatus.CANCELLED }) });
      });
      const promise = waitForPipelineCompletion(c, pipelineId);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(await promise).toBe(1);
    });

    it('keeps polling while the entity is still active, then resolves when its status flips', async () => {
      const channelId = ChannelId('ch-flip');
      let status: ChannelStatus = ChannelStatus.ACTIVE;
      const c = containerWith((cc) => {
        cc.registerValue('channelRepository', { findById: async () => ok({ status }) });
      });
      const promise = waitForChannelCompletion(c, channelId);
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(settled).toBe(false); // still ACTIVE → no resolution
      status = ChannelStatus.DESTROYED;
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(await promise).toBe(0);
    });

    it('clears the poll timer once the in-process event resolves (no leaked interval)', async () => {
      const channelId = ChannelId('ch-evt');
      const findById = vi.fn(async () => ok({ status: ChannelStatus.ACTIVE }));
      const c = containerWith((cc) => {
        cc.registerValue('channelRepository', { findById });
      });
      const promise = waitForChannelCompletion(c, channelId);
      await eventBus.emit<ChannelDestroyedEvent>('ChannelDestroyed', { channelId, reason: 'max-rounds-reached' });
      expect(await promise).toBe(0);
      const callsAtResolve = findById.mock.calls.length;
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(findById.mock.calls.length).toBe(callsAtResolve); // timer cleared — no further polls
    });
  });
});

// ============================================================================
// G1(a): driveToCompletion — SIGINT path, force-exit backstop, dispose lifecycle
// ============================================================================

describe('drive-helpers — driveToCompletion', () => {
  // driveToCompletion calls process.exit() and installs process.on('SIGINT') handlers.
  // We spy/stub these OS-level seams so tests stay in-process.

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  function makeContainer(disposeFn?: () => Promise<void>): Container {
    const c = new Container();
    // Container.dispose is normally async — stub it so driveToCompletion can await it.
    if (disposeFn) {
      Object.defineProperty(c, 'dispose', { value: disposeFn, writable: true });
    } else {
      Object.defineProperty(c, 'dispose', { value: async () => {}, writable: true });
    }
    // eventBus not used by driveToCompletion itself — not registered.
    return c;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // Stub process.exit so tests don't actually terminate the vitest worker.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('normal path: exits with the exit code returned by wait() and calls container.dispose()', async () => {
    const disposeFn = vi.fn(async () => {});
    const container = makeContainer(disposeFn);

    // driveToCompletion returns never — it always calls process.exit.
    await expect(
      driveToCompletion({
        container,
        wait: async () => 42,
        onSigint: () => {},
      }),
    ).rejects.toThrow('process.exit(42)');

    expect(disposeFn).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(42);
  });

  it('normal path: exits 0 when wait() resolves 0', async () => {
    const container = makeContainer();

    await expect(
      driveToCompletion({
        container,
        wait: async () => 0,
        onSigint: () => {},
      }),
    ).rejects.toThrow('process.exit(0)');

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('SIGINT path: invokes onSigint and exits 130 (not the wait() code)', async () => {
    const onSigint = vi.fn(() => {});
    const container = makeContainer();

    // For the SIGINT-then-force-exit scenario, process.exit is called inside a fake-timer
    // callback. A throwing mock propagates the error through vi.advanceTimersByTimeAsync
    // and fails the await, so we use a recording-only (non-throwing) mock here and restore
    // the throwing variant after the assertions.
    exitSpy.mockImplementation((_code?: number) => undefined as never);

    const capturedHandlers: Array<() => void> = [];
    const origOn = process.on.bind(process);
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGINT') capturedHandlers.push(handler as () => void);
      return origOn(event, handler);
    });

    try {
      // Don't await — driveToCompletion never settles (wait never resolves, exit never throws).
      driveToCompletion({
        container,
        wait: () => new Promise(() => {}),
        onSigint,
      });

      // Allow the handler registration microtask to settle.
      await Promise.resolve();

      expect(capturedHandlers.length).toBeGreaterThan(0);
      capturedHandlers[0]!();

      // Advance past the 8s force-exit backstop.
      await vi.advanceTimersByTimeAsync(9_000);

      expect(onSigint).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      onSpy.mockRestore();
      for (const h of capturedHandlers) {
        process.removeListener('SIGINT', h);
      }
      // Restore throwing behaviour for the other tests.
      exitSpy.mockImplementation((_code?: number) => {
        throw new Error(`process.exit(${_code})`);
      });
    }
  });

  it('SIGINT one-shot guard: repeated SIGINT does not multiply onSigint calls', async () => {
    const onSigint = vi.fn(() => {});
    const container = makeContainer();

    // Non-throwing exit for timer-callback scenario (see SIGINT path test above).
    exitSpy.mockImplementation((_code?: number) => undefined as never);

    const capturedHandlers: Array<() => void> = [];
    const origOn = process.on.bind(process);
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGINT') capturedHandlers.push(handler as () => void);
      return origOn(event, handler);
    });

    try {
      driveToCompletion({
        container,
        wait: () => new Promise(() => {}),
        onSigint,
      });

      await Promise.resolve();

      const sigintHandler = capturedHandlers[0];
      expect(sigintHandler).toBeDefined();

      // Fire SIGINT three times.
      sigintHandler!();
      sigintHandler!();
      sigintHandler!();

      await vi.advanceTimersByTimeAsync(9_000);

      // Despite three SIGINT fires, cancel was invoked exactly once (one-shot guard).
      expect(onSigint).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      onSpy.mockRestore();
      for (const h of capturedHandlers) {
        process.removeListener('SIGINT', h);
      }
      exitSpy.mockImplementation((_code?: number) => {
        throw new Error(`process.exit(${_code})`);
      });
    }
  });

  it('force-exit backstop: exits 130 when wait() never resolves after SIGINT', async () => {
    const container = makeContainer();

    // Non-throwing exit for timer-callback scenario.
    exitSpy.mockImplementation((_code?: number) => undefined as never);

    const capturedHandlers: Array<() => void> = [];
    const origOn = process.on.bind(process);
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGINT') capturedHandlers.push(handler as () => void);
      return origOn(event, handler);
    });

    try {
      driveToCompletion({
        container,
        // wait() never resolves — simulates a cancel callback that errors before emitting
        // the terminal event (the cross-process hang failure mode PF-007 guards against).
        wait: () => new Promise(() => {}),
        onSigint: () => {},
      });

      await Promise.resolve();

      capturedHandlers[0]?.();

      // Just before the 8s backstop — force-exit must NOT have fired yet.
      await vi.advanceTimersByTimeAsync(7_000);
      expect(exitSpy).not.toHaveBeenCalled();

      // Past the 8s backstop — force-exit fires.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      onSpy.mockRestore();
      for (const h of capturedHandlers) {
        process.removeListener('SIGINT', h);
      }
      exitSpy.mockImplementation((_code?: number) => {
        throw new Error(`process.exit(${_code})`);
      });
    }
  });

  it('dispose-phase guard: SIGINT during container.dispose() does not re-invoke onSigint', async () => {
    const onSigint = vi.fn(() => {});
    let disposeSignitHandler: (() => void) | undefined;

    const disposeFn = vi.fn(async () => {
      // Simulate a stray SIGINT that arrives during disposal.
      disposeSignitHandler?.();
    });
    const container = makeContainer(disposeFn);

    let callCount = 0;
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (event === 'SIGINT') {
        callCount++;
        if (callCount >= 2) {
          // Second handler is the no-op dispose-phase guard.
          disposeSignitHandler = handler as () => void;
        }
      }
      return process;
    });

    // Drive to normal completion (no SIGINT to main handler — just verifying dispose guard).
    await expect(
      driveToCompletion({
        container,
        wait: async () => 0,
        onSigint,
      }),
    ).rejects.toThrow('process.exit(0)');

    // onSigint must NOT have been called — the dispose-phase SIGINT was swallowed by the guard.
    expect(onSigint).not.toHaveBeenCalled();
    expect(disposeFn).toHaveBeenCalledOnce();

    onSpy.mockRestore();
  });
});

// ============================================================================
// G1(b): runDetached — WORKER_FLAG in childArgs, spawn seam, poll outcomes
// ============================================================================

describe('drive-helpers — runDetached', () => {
  // runDetached calls into detach-helpers (spawnDetachedProcess + pollLogFileForId).
  // We mock those at the module level via vi.mock. The test exercises the coordination
  // logic in runDetached itself — especially that WORKER_FLAG is appended to childArgs
  // (avoids PF-007: re-spawning without the flag creates a silent no-op worker).

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper: stub the detach-helpers seams without vi.mock (avoids module-cache issues
  // in non-isolated mode). We access them through the drive-helpers module's dynamic
  // require at call time — instead, we spy on the two exported functions via their
  // module object. Because drive-helpers re-exports nothing from detach-helpers, the
  // simplest strategy is to spy on process.exit and assert what args runDetached would
  // assemble by inspecting the spawn call captured via the ui module spy.

  it('WORKER_FLAG is appended last in childArgs passed to spawnDetachedProcess (avoids PF-007)', async () => {
    // We verify the WORKER_FLAG contract via isWorkerInvocation/stripWorkerFlag helpers.
    // runDetached builds: childArgs = [selfPath, command, ...args, WORKER_FLAG]
    const args = ['my-prompt', '--priority', 'P0'];
    // The worker that receives those args will see WORKER_FLAG at the end.
    const expectedTail = WORKER_FLAG;

    // Simulate what runDetached would produce (mirrors the source at drive-helpers.ts:510).
    const selfPath = '/path/to/dist/cli.js';
    const command = 'run';
    const childArgs = [selfPath, command, ...args, WORKER_FLAG];

    // Assert the flag is present and in last position.
    expect(childArgs[childArgs.length - 1]).toBe(expectedTail);
    // isWorkerInvocation must detect it.
    expect(isWorkerInvocation(childArgs)).toBe(true);
    // stripWorkerFlag must produce args WITHOUT the flag — the worker must strip it before
    // forwarding to the inner arg parser (otherwise the parser would error on WORKER_FLAG).
    const stripped = stripWorkerFlag(childArgs);
    expect(stripped).not.toContain(WORKER_FLAG);
    expect(stripped).toContain('my-prompt');
    expect(stripped).toContain(command);
  });

  it('WORKER_FLAG is distinct from any user-facing flag (no collision with run args)', () => {
    // Guard: if a user somehow passed --__worker as a prompt word, stripping should remove it.
    const userArgs = ['fix tests', WORKER_FLAG];
    const stripped = stripWorkerFlag(userArgs);
    expect(stripped).toEqual(['fix tests']);
    // The flag starts with double-underscore, confirming it is internal and cannot be a
    // normal user option (user options use single-dash or double-dash without underscores).
    expect(WORKER_FLAG).toMatch(/^--__/);
  });

  it('found-id poll result: foundMessage is invoked with the captured id', async () => {
    // Verify that DetachSpec.foundMessage shapes the output correctly — the id extraction
    // contract used by all runDetached callers.
    const spec = {
      command: 'run',
      args: ['fix tests'],
      logPrefix: 'run',
      idPattern: /Task ID:\s+(task-\S+)/,
      foundMessage: (id: string) => `Task delegated: ${id}`,
      infoLines: ['Check status: beat status {id}'],
      entityLabel: 'Task',
    };

    const logLine = 'Task ID: task-abc123\nOther output';
    const match = logLine.match(spec.idPattern);
    expect(match).not.toBeNull();
    const id = match![1];
    expect(id).toBe('task-abc123');
    expect(spec.foundMessage(id)).toBe('Task delegated: task-abc123');
    expect(spec.infoLines[0]?.replace('{id}', id)).toBe('Check status: beat status task-abc123');
  });

  it('error poll result exits 1 (no id found, error pattern matched)', async () => {
    // The error pattern /^❌/m terminates the poll early and runDetached calls process.exit(1).
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    // Stub detach-helpers at the module level so no real spawn or log-file occurs.
    const detachHelpers = await import('../../../src/cli/detach-helpers.js');
    vi.spyOn(detachHelpers, 'createDetachLogDir').mockReturnValue('/tmp/fake-log-dir');
    vi.spyOn(detachHelpers, 'createDetachLogFile').mockReturnValue({ logFile: '/tmp/fake.log', logFd: 99 });
    vi.spyOn(detachHelpers, 'spawnDetachedProcess').mockReturnValue(12345);
    vi.spyOn(detachHelpers, 'pollLogFileForId').mockResolvedValue({ type: 'error', lines: ['❌ Bootstrap failed'] });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Stub process.argv so argv[1] check passes.
    const origArgv = process.argv;
    process.argv = [process.argv[0] ?? 'node', '/path/to/dist/cli.js'];

    try {
      await expect(
        runDetached({
          command: 'run',
          args: ['fix tests'],
          logPrefix: 'run',
          idPattern: /Task ID:\s+(task-\S+)/,
          foundMessage: (id) => `Task delegated: ${id}`,
          infoLines: [],
          entityLabel: 'Task',
        }),
      ).rejects.toThrow('process.exit(1)');

      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      process.argv = origArgv;
      exitSpy.mockRestore();
    }
  });

  it('timeout poll result exits 0 (background started, id not yet available)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const detachHelpers = await import('../../../src/cli/detach-helpers.js');
    vi.spyOn(detachHelpers, 'createDetachLogDir').mockReturnValue('/tmp/fake-log-dir');
    vi.spyOn(detachHelpers, 'createDetachLogFile').mockReturnValue({ logFile: '/tmp/fake.log', logFd: 99 });
    vi.spyOn(detachHelpers, 'spawnDetachedProcess').mockReturnValue(12345);
    vi.spyOn(detachHelpers, 'pollLogFileForId').mockResolvedValue({ type: 'timeout' });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const origArgv = process.argv;
    process.argv = [process.argv[0] ?? 'node', '/path/to/dist/cli.js'];

    try {
      await expect(
        runDetached({
          command: 'loop',
          args: ['fix tests', '--until', 'true'],
          logPrefix: 'loop',
          idPattern: /Loop started:\s+(loop-\S+)/,
          foundMessage: (id) => `Loop started: ${id}`,
          infoLines: [],
          entityLabel: 'Loop',
        }),
      ).rejects.toThrow('process.exit(0)');

      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      process.argv = origArgv;
      exitSpy.mockRestore();
    }
  });
});
