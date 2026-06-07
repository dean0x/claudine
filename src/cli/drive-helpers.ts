/**
 * Shared "drive-to-completion" helpers for self-contained CLI action commands.
 *
 * ARCHITECTURE (issue #205): Every CLI action command that creates work must HOST
 * that work to a terminal state in a process that outlives the user's shell — never
 * "emit event + process.exit(0)". There is exactly one bounded execution shape, and
 * `beat run` is its reference implementation:
 *
 *   1. Default invocation re-spawns the CLI as a DETACHED background process carrying
 *      {@link WORKER_FLAG}, polls its log file for the entity id, prints it, and exits.
 *   2. The detached worker bootstraps `mode: 'run'` (the only mode that wires the tmux
 *      worker subsystem — see bootstrap.ts), creates the work, then AWAITS a terminal
 *      event before disposing and exiting.
 *
 * DECISION (issue #205): There is no user-facing `--foreground`. With tmux-based workers
 * the agent runs inside a detached tmux session, so live output streaming to the parent
 * terminal is not meaningful — users observe progress via `beat status`/`beat logs`/
 * `beat dashboard` or by attaching to the tmux session. {@link WORKER_FLAG} is an internal
 * implementation detail used only by the re-spawn, never documented to users.
 */

import type { Container } from '../core/container.js';
import { LoopStatus } from '../core/domain.js';
import type { EventBus } from '../core/events/event-bus.js';
import type {
  AutobeatEvent,
  ChannelDestroyedEvent,
  LoopCancelledEvent,
  LoopCompletedEvent,
  OutputCapturedEvent,
  PipelineCancelledEvent,
  PipelineCompletedEvent,
  PipelineFailedEvent,
  TaskCancelledEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskTimeoutEvent,
} from '../core/events/events.js';
import type { LoopRepository } from '../core/interfaces.js';
import { createDetachLogDir, createDetachLogFile, type DetachPollOptions, pollLogFileForId, spawnDetachedProcess } from './detach-helpers.js';
import * as ui from './ui.js';

/**
 * Hidden internal flag marking a re-spawned background worker process.
 * Its presence tells a command handler "you are the detached worker — actually
 * execute and drive the work" instead of "detach and return the id".
 *
 * SECURITY/UX: Double-underscore prefix signals an internal flag; it is intentionally
 * absent from all help text and user-facing option parsing.
 */
export const WORKER_FLAG = '--__worker';

/** Returns true if the given arg list contains the internal worker flag. */
export function isWorkerInvocation(args: readonly string[]): boolean {
  return args.includes(WORKER_FLAG);
}

/** Remove the internal worker flag from an arg list (returns a new array). */
export function stripWorkerFlag(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== WORKER_FLAG);
}

// ============================================================================
// Terminal-event waiters
// ============================================================================

/**
 * Generic scaffolding for awaiting a terminal event on the shared EventBus.
 *
 * Manages the Promise lifecycle, a resolve-once guard, and subscription cleanup so
 * each concrete waiter only declares which events it cares about. The `register`
 * callback subscribes handlers and returns their subscription ids for teardown.
 *
 * Returns exit code 1 immediately if the EventBus cannot be resolved (defensive —
 * a worker process without an EventBus cannot make progress).
 */
function awaitTerminal(
  container: Container,
  register: (eventBus: EventBus, resolve: (exitCode: number) => void) => readonly string[],
): Promise<number> {
  const eventBusResult = container.get<EventBus>('eventBus');
  if (!eventBusResult.ok) {
    ui.error(`Failed to get event bus: ${eventBusResult.error.message}`);
    return Promise.resolve(1);
  }
  const eventBus = eventBusResult.value;

  return new Promise<number>((resolve) => {
    let resolved = false;
    let subscriptionIds: readonly string[] = [];

    const resolveOnce = (exitCode: number) => {
      if (resolved) return;
      resolved = true;
      for (const id of subscriptionIds) {
        eventBus.unsubscribe(id);
      }
      resolve(exitCode);
    };

    subscriptionIds = register(eventBus, resolveOnce);
  });
}

/**
 * Subscribe to EventBus events for a specific task and wait for terminal state.
 * Streams OutputCaptured for the task to stdout/stderr (lands in the detach log
 * file for the background worker). Returns the worker's exit code.
 */
export function waitForTaskCompletion(container: Container, taskId: string): Promise<number> {
  return awaitTerminal(container, (eventBus, resolve) => {
    const ids: string[] = [];
    const sub = <T extends AutobeatEvent>(type: T['type'], handler: (event: T) => void | Promise<void>): void => {
      const result = eventBus.subscribe<T>(type, async (event) => handler(event));
      if (result.ok) ids.push(result.value);
    };

    sub<OutputCapturedEvent>('OutputCaptured', (event) => {
      if (event.taskId !== taskId) return;
      const stream = event.outputType === 'stderr' ? process.stderr : process.stdout;
      stream.write(event.data);
    });
    sub<TaskCompletedEvent>('TaskCompleted', (event) => {
      if (event.taskId === taskId) resolve(event.exitCode);
    });
    sub<TaskFailedEvent>('TaskFailed', (event) => {
      if (event.taskId === taskId) resolve(event.exitCode ?? 1);
    });
    sub<TaskCancelledEvent>('TaskCancelled', (event) => {
      if (event.taskId === taskId) resolve(1);
    });
    sub<TaskTimeoutEvent>('TaskTimeout', (event) => {
      if (event.taskId === taskId) resolve(1);
    });

    return ids;
  });
}

/**
 * Wait for a loop to reach a terminal state.
 *
 * DECISION: There is no `LoopFailed` event — both COMPLETED and FAILED terminal
 * statuses emit `LoopCompleted` (the reason string distinguishes them), so on
 * `LoopCompleted` we re-read the loop record to map status → exit code. User
 * cancellation emits `LoopCancelled` (exit 1).
 */
export function waitForLoopCompletion(container: Container, loopId: string): Promise<number> {
  const loopRepoResult = container.get<LoopRepository>('loopRepository');
  return awaitTerminal(container, (eventBus, resolve) => {
    const ids: string[] = [];

    const completedSub = eventBus.subscribe<LoopCompletedEvent>('LoopCompleted', async (event) => {
      if (event.loopId !== loopId) return;
      let exitCode = 0;
      if (loopRepoResult.ok) {
        const loopResult = await loopRepoResult.value.findById(event.loopId);
        if (loopResult.ok && loopResult.value && loopResult.value.status === LoopStatus.FAILED) {
          exitCode = 1;
        }
      }
      resolve(exitCode);
    });
    if (completedSub.ok) ids.push(completedSub.value);

    const cancelledSub = eventBus.subscribe<LoopCancelledEvent>('LoopCancelled', async (event) => {
      if (event.loopId === loopId) resolve(1);
    });
    if (cancelledSub.ok) ids.push(cancelledSub.value);

    return ids;
  });
}

/** Wait for a pipeline to reach a terminal state. */
export function waitForPipelineCompletion(container: Container, pipelineId: string): Promise<number> {
  return awaitTerminal(container, (eventBus, resolve) => {
    const ids: string[] = [];
    const sub = <T extends AutobeatEvent>(type: T['type'], handler: (event: T) => void): void => {
      const result = eventBus.subscribe<T>(type, async (event) => handler(event));
      if (result.ok) ids.push(result.value);
    };

    sub<PipelineCompletedEvent>('PipelineCompleted', (event) => {
      if (event.pipelineId === pipelineId) resolve(0);
    });
    sub<PipelineFailedEvent>('PipelineFailed', (event) => {
      if (event.pipelineId === pipelineId) resolve(1);
    });
    sub<PipelineCancelledEvent>('PipelineCancelled', (event) => {
      if (event.pipelineId === pipelineId) resolve(1);
    });

    return ids;
  });
}

/**
 * Wait for a channel to be destroyed (its terminal state).
 * Used only for bounded channels (maxRounds reached / all members crashed).
 */
export function waitForChannelCompletion(container: Container, channelId: string): Promise<number> {
  return awaitTerminal(container, (eventBus, resolve) => {
    const result = eventBus.subscribe<ChannelDestroyedEvent>('ChannelDestroyed', async (event) => {
      if (event.channelId === channelId) resolve(0);
    });
    return result.ok ? [result.value] : [];
  });
}

// ============================================================================
// Foreground worker lifecycle
// ============================================================================

/**
 * Drive a created unit of work to completion inside the detached worker process,
 * then dispose the container and exit with the work's exit code.
 *
 * Shared lifecycle for every bounded command's worker path: install a SIGINT handler
 * that cancels the work, await the terminal event, then clean up. Returns `never` —
 * it always exits the process.
 *
 * @param onSigint cancel callback (e.g. `() => taskManager.cancel(id, reason)`)
 * @param wait     resolves with the exit code when the work reaches a terminal state
 */
export async function driveToCompletion(opts: {
  readonly container: Container;
  readonly wait: () => Promise<number>;
  readonly onSigint: () => void;
  readonly sigintMessage?: string;
}): Promise<never> {
  let cancelledBySigint = false;
  const sigintHandler = () => {
    process.stderr.write(opts.sigintMessage ?? '\nCancelling...\n');
    cancelledBySigint = true;
    opts.onSigint();
  };
  process.on('SIGINT', sigintHandler);

  const exitCode = await opts.wait();

  process.removeListener('SIGINT', sigintHandler);
  await opts.container.dispose();
  // SIGINT cancellation conventionally exits 130.
  process.exit(cancelledBySigint ? 130 : exitCode);
}

// ============================================================================
// Detach wrapper
// ============================================================================

export interface DetachSpec {
  /** Top-level command word, e.g. 'run' | 'loop' | 'pipeline' | 'channel' | 'retry' | 'resume'. */
  readonly command: string;
  /** Original user args for the command (the worker flag is appended automatically). */
  readonly args: readonly string[];
  /** Filename prefix for the detach log (e.g. 'loop'). */
  readonly logPrefix: string;
  /** Regex with one capture group extracting the entity id from the worker's log. */
  readonly idPattern: RegExp;
  /** Message printed when the id is found, e.g. (id) => `Loop started: ${id}`. */
  readonly foundMessage: (id: string) => string;
  /** Extra info lines printed after the id ('{id}' is substituted). */
  readonly infoLines: readonly string[];
  /** Optional human label for the timeout message (defaults to the command word). */
  readonly entityLabel?: string;
}

/**
 * Re-spawn the CLI as a detached background worker and poll its log for the entity id.
 *
 * This is the single detach path shared by every bounded action command — the
 * generalization of `beat run`'s original `handleDetachMode`. The detached child
 * runs the same command with {@link WORKER_FLAG} appended, which routes it into the
 * worker branch (bootstrap `mode: 'run'`, create, await terminal event, exit).
 */
export async function runDetached(spec: DetachSpec): Promise<void> {
  const logDir = createDetachLogDir();
  const { logFile, logFd } = createDetachLogFile(logDir, spec.logPrefix);

  const childArgs = [process.argv[1], spec.command, ...spec.args, WORKER_FLAG];
  const pid = spawnDetachedProcess(childArgs, logFd);

  ui.info(`Background process started (PID: ${pid})`);
  ui.info(`Log file: ${logFile}`);

  const pollOptions: DetachPollOptions = {
    idPattern: spec.idPattern,
    errorPattern: /^❌/m,
    foundMessage: spec.foundMessage,
    timeoutMessage: `${spec.entityLabel ?? spec.command} id not yet available (background process still starting)`,
    infoLines: spec.infoLines,
    maxAttempts: 75,
    pollIntervalMs: 200,
  };

  const result = await pollLogFileForId(logFile, pollOptions);
  if (result.type === 'error') {
    process.exit(1);
  }
  process.exit(0);
}
