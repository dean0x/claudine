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
import { ChannelId, ChannelStatus, LoopId, LoopStatus, PipelineId, PipelineStatus } from '../core/domain.js';
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
import type { ChannelRepository, LoopRepository, PipelineRepository } from '../core/interfaces.js';
import {
  createDetachLogDir,
  createDetachLogFile,
  type DetachPollOptions,
  pollLogFileForId,
  spawnDetachedProcess,
} from './detach-helpers.js';
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

/**
 * Bounded grace period after SIGINT before a detached worker force-exits (130).
 * Backstop for a cancel callback that fails before emitting its terminal event — see
 * {@link driveToCompletion}. Generous enough for a normal cancel + terminal event to land.
 */
const SIGINT_FORCE_EXIT_MS = 8_000;

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
  register: (
    eventBus: EventBus,
    resolve: (exitCode: number) => void,
    onCleanup: (teardown: () => void) => void,
  ) => readonly string[],
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
    const cleanups: Array<() => void> = [];

    const resolveOnce = (exitCode: number) => {
      if (resolved) return;
      resolved = true;
      for (const id of subscriptionIds) {
        eventBus.unsubscribe(id);
      }
      // Tear down non-subscription resources (e.g. the cross-process DB-status poll timer) so
      // a resolved waiter never leaks a setInterval into the disposing worker process.
      for (const teardown of cleanups) {
        try {
          teardown();
        } catch {
          // best-effort: a failing teardown must not block resolution
        }
      }
      resolve(exitCode);
    };

    subscriptionIds = register(eventBus, resolveOnce, (teardown) => {
      cleanups.push(teardown);
    });

    // RELIABILITY (issue #205): the returned Promise resolves ONLY via resolveOnce. If every
    // eventBus.subscribe() call failed AND no fallback was registered, register() returns an
    // empty id list with no cleanups and nothing could ever resolve — the detached worker
    // would hang forever. Fail fast with a non-zero exit instead. A registered cleanup means a
    // DB-status poll is running as an independent resolution path, so a zero-subscription
    // waiter can still make progress and must NOT fast-fail.
    if (subscriptionIds.length === 0 && cleanups.length === 0) {
      ui.error('Failed to subscribe to terminal events — cannot drive work to completion');
      resolveOnce(1);
    }
  });
}

/**
 * Interval for the cross-process DB-status poll that backs the long-lived host waiters.
 *
 * RELIABILITY (issue #205): the in-process EventBus is a pure in-memory Map — a terminal event
 * emitted by a SEPARATE CLI process (`beat channel destroy`, `beat loop cancel`, `beat loop
 * pause --force`, or a step `beat cancel` for a pipeline) lands on that process's bus and is
 * invisible to the detached host worker. The shared SQLite row is the only authoritative
 * cross-process signal, so each long-lived waiter polls it as a fallback alongside its
 * in-process subscription. The in-process event still wins the resolve-once race on the happy
 * path; the poll only matters when the terminal transition happened in another process.
 */
const STATUS_POLL_INTERVAL_MS = 1_500;

/**
 * Register a self-guarded DB-status poll as an independent resolution path on a terminal-event
 * waiter. `probe` reads the entity's authoritative status from the shared DB and returns the
 * worker exit code once the entity is terminal, or null while it is still active.
 *
 * BOUND (reliability): each tick performs exactly one bounded DB read, gated by a re-entrancy
 * guard so reads never overlap. The poll is deliberately NOT capped by a tick count — the
 * authoritative upper bound is the work's own guaranteed terminal state (loops have
 * max-iterations / exit conditions, pipelines have finite steps, channels are destroyed), at
 * which point the timer is cleared via onCleanup. An artificial attempt cap would abandon a
 * legitimately long-running host mid-flight, so the terminal status — not a tick count — is the
 * bound. Transient read errors are swallowed and retried on the next tick.
 */
function registerStatusPoll(
  probe: () => Promise<number | null>,
  resolve: (exitCode: number) => void,
  onCleanup: (teardown: () => void) => void,
): void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void probe()
      .then((exitCode) => {
        if (exitCode !== null) resolve(exitCode);
      })
      .catch(() => {
        // transient DB read error — retry on the next tick rather than resolving falsely
      })
      .finally(() => {
        inFlight = false;
      });
  }, STATUS_POLL_INTERVAL_MS);
  onCleanup(() => clearInterval(timer));
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
  return awaitTerminal(container, (eventBus, resolve, onCleanup) => {
    const ids: string[] = [];

    const completedSub = eventBus.subscribe<LoopCompletedEvent>('LoopCompleted', async (event) => {
      if (event.loopId !== loopId) return;
      // LoopCompleted is emitted for BOTH COMPLETED and FAILED terminal statuses — the event
      // payload carries only a free-text `reason`, not the status — so re-read the loop record
      // to map status → exit code. completeLoop() persists the terminal status before emitting,
      // so the happy-path read is authoritative.
      //
      // FAIL HONESTLY (issue #205): if the status cannot be determined (repo unavailable, read
      // error, or record missing) we exit 1 rather than defaulting to 0. A false success would
      // mask a FAILED loop in scripts (`beat loop ... && deploy`); a false failure on a
      // genuinely-completed loop is the safer error to surface, and the cause is logged.
      if (!loopRepoResult.ok) {
        ui.error(`Cannot determine loop outcome (loop repository unavailable): ${loopRepoResult.error.message}`);
        resolve(1);
        return;
      }
      const loopResult = await loopRepoResult.value.findById(event.loopId);
      if (!loopResult.ok) {
        ui.error(`Cannot determine loop outcome (status read failed): ${loopResult.error.message}`);
        resolve(1);
        return;
      }
      if (!loopResult.value) {
        ui.error(`Cannot determine loop outcome (loop ${event.loopId} not found)`);
        resolve(1);
        return;
      }
      resolve(loopResult.value.status === LoopStatus.FAILED ? 1 : 0);
    });
    if (completedSub.ok) ids.push(completedSub.value);

    const cancelledSub = eventBus.subscribe<LoopCancelledEvent>('LoopCancelled', async (event) => {
      if (event.loopId === loopId) resolve(1);
    });
    if (cancelledSub.ok) ids.push(cancelledSub.value);

    // Cross-process fallback (issue #205): `beat loop cancel` / `beat loop pause --force` run in
    // a SEPARATE process that flips the loop's DB status (loop-handler persists CANCELLED) but
    // emits LoopCancelled on a bus this host never observes. Poll the shared loop record so the
    // host still terminates instead of hanging forever. completeLoop persists the terminal
    // status before emitting LoopCompleted, so the poll and the in-process event agree.
    if (loopRepoResult.ok) {
      const loopRepo = loopRepoResult.value;
      registerStatusPoll(
        async () => {
          const result = await loopRepo.findById(LoopId(loopId));
          if (!result.ok || !result.value) return null;
          if (result.value.status === LoopStatus.CANCELLED || result.value.status === LoopStatus.FAILED) return 1;
          if (result.value.status === LoopStatus.COMPLETED) return 0;
          return null;
        },
        resolve,
        onCleanup,
      );
    }

    return ids;
  });
}

/** Wait for a pipeline to reach a terminal state. */
export function waitForPipelineCompletion(container: Container, pipelineId: string): Promise<number> {
  const pipelineRepoResult = container.get<PipelineRepository>('pipelineRepository');
  return awaitTerminal(container, (eventBus, resolve, onCleanup) => {
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

    // Cross-process fallback (issue #205): cancelling a pipeline step via a separate `beat
    // cancel <step>` process flips the pipeline's DB status (pipeline-handler persists it) but
    // emits the terminal Pipeline event on that process's bus, invisible to this host. Poll the
    // shared pipeline record so the host still terminates instead of hanging.
    if (pipelineRepoResult.ok) {
      const pipelineRepo = pipelineRepoResult.value;
      registerStatusPoll(
        async () => {
          const result = await pipelineRepo.findById(PipelineId(pipelineId));
          if (!result.ok || !result.value) return null;
          if (result.value.status === PipelineStatus.COMPLETED) return 0;
          if (result.value.status === PipelineStatus.FAILED || result.value.status === PipelineStatus.CANCELLED) {
            return 1;
          }
          return null;
        },
        resolve,
        onCleanup,
      );
    }

    return ids;
  });
}

/**
 * Wait for a channel to be destroyed (its terminal state).
 *
 * A bounded channel (maxRounds reached / all members crashed) destroys itself in-process and
 * resolves via the ChannelDestroyed subscription. An OPEN-ENDED channel is destroyed by a
 * separate `beat channel destroy` process whose ChannelDestroyed event the host can never see
 * (the EventBus is in-process only), so the DB-status poll is the authoritative cross-process
 * terminal signal — destroyChannel persists DESTROYED before emitting.
 */
export function waitForChannelCompletion(container: Container, channelId: string): Promise<number> {
  const channelRepoResult = container.get<ChannelRepository>('channelRepository');
  return awaitTerminal(container, (eventBus, resolve, onCleanup) => {
    const ids: string[] = [];
    const sub = eventBus.subscribe<ChannelDestroyedEvent>('ChannelDestroyed', async (event) => {
      if (event.channelId === channelId) resolve(0);
    });
    if (sub.ok) ids.push(sub.value);

    if (channelRepoResult.ok) {
      const channelRepo = channelRepoResult.value;
      registerStatusPoll(
        async () => {
          const result = await channelRepo.findById(ChannelId(channelId));
          if (!result.ok || !result.value) return null;
          return result.value.status === ChannelStatus.DESTROYED ? 0 : null;
        },
        resolve,
        onCleanup,
      );
    }

    return ids;
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
    // SAFETY NET (issue #205): onSigint is fire-and-forget — it requests cancellation but
    // unblocking depends on the cancel path emitting the work's terminal event. If that path
    // errors BEFORE emitting (e.g. destroyChannel/cancelLoop returns err on a DB write), the
    // wait() Promise would never resolve and the worker would hang after Ctrl-C instead of
    // exiting. Force a bounded exit so SIGINT always terminates the process promptly.
    const forceExit = setTimeout(() => {
      process.stderr.write('Cancellation did not complete in time — force exiting.\n');
      process.exit(130);
    }, SIGINT_FORCE_EXIT_MS);
    forceExit.unref();
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
