/**
 * Unit tests for TmuxConnector.waitForReady()
 *
 * Uses vi.useFakeTimers() + vi.advanceTimersByTimeAsync() to control async delays
 * without real wall-clock waits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutobeatError, ErrorCode } from '../../../../src/core/errors.js';
import type { Logger } from '../../../../src/core/interfaces.js';
import { err, ok } from '../../../../src/core/result.js';
import { TmuxConnector, type TmuxConnectorDeps } from '../../../../src/implementations/tmux/tmux-connector.js';
import type {
  TmuxHandle,
  TmuxHooksPort,
  TmuxSessionManagerPort,
  TmuxValidatorPort,
} from '../../../../src/implementations/tmux/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeHandle(sessionName = 'beat-task-test'): TmuxHandle {
  return { sessionName, taskId: 'task-test', sessionsDir: '/tmp/sessions' };
}

function makeDefaultFsDeps(): Pick<TmuxConnectorDeps, 'readFileSync' | 'readFile' | 'readdirSync'> {
  return {
    readFileSync: vi.fn().mockReturnValue(''),
    readFile: vi.fn().mockResolvedValue(''),
    readdirSync: vi.fn().mockReturnValue([]),
  };
}

function makeValidValidator(): TmuxValidatorPort {
  return {
    validate: vi.fn().mockReturnValue(ok({ version: '3.4', path: 'tmux', jqPath: '/usr/bin/jq' })),
  } as unknown as TmuxValidatorPort;
}

function makeValidHooks(): TmuxHooksPort {
  return {
    generateSetupShim: vi.fn().mockReturnValue(
      ok({
        shimPath: '/tmp/shim.sh',
        sessionDir: '/tmp/sessions/task-test',
        messagesDir: '/tmp/sessions/task-test/messages',
      }),
    ),
    initTaskDirectory: vi
      .fn()
      .mockReturnValue(ok({ sessionDir: '/tmp/sessions/task-test', messagesDir: '/tmp/sessions/task-test/messages' })),
    cleanup: vi.fn().mockReturnValue(ok(undefined)),
  } as unknown as TmuxHooksPort;
}

function makeWatch(): TmuxConnectorDeps['watch'] {
  return vi.fn().mockReturnValue({ close: vi.fn(), on: vi.fn() }) as unknown as TmuxConnectorDeps['watch'];
}

/**
 * Build a TmuxConnector where sessionManager.capturePaneContent
 * returns successive values on each call. Accepts an array of return values;
 * if there are fewer values than calls, the last value is repeated.
 */
function makeConnectorWithCapture(
  captureValues: Array<string | Error>,
  isAliveValues: boolean[] = [],
): { connector: TmuxConnector; sessionManager: TmuxSessionManagerPort; logger: Logger } {
  const logger = makeLogger();
  let captureCallCount = 0;
  let aliveCallCount = 0;

  const sessionManager: TmuxSessionManagerPort = {
    createSession: vi.fn().mockReturnValue(ok({ sessionName: 'beat-task-test' })),
    destroySession: vi.fn().mockReturnValue(ok(undefined)),
    sendKeys: vi.fn().mockReturnValue(ok(undefined)),
    sendControlKeys: vi.fn().mockReturnValue(ok(undefined)),
    isAlive: vi.fn().mockImplementation(() => {
      const val = aliveCallCount < isAliveValues.length ? isAliveValues[aliveCallCount] : true;
      aliveCallCount++;
      return ok(val);
    }),
    listSessions: vi.fn().mockReturnValue(ok([])),
    getSessionEnvironment: vi.fn().mockReturnValue(ok(undefined)),
    setSessionEnvironment: vi.fn().mockReturnValue(ok(undefined)),
    pasteContent: vi.fn().mockReturnValue(ok(undefined)),
    capturePaneContent: vi.fn().mockImplementation(() => {
      const val =
        captureCallCount < captureValues.length
          ? captureValues[captureCallCount]
          : captureValues[captureValues.length - 1];
      captureCallCount++;
      return val instanceof Error ? err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, val.message)) : ok(val);
    }),
  } as unknown as TmuxSessionManagerPort;

  const connector = new TmuxConnector({
    ...makeDefaultFsDeps(),
    sessionManager,
    hooks: makeValidHooks(),
    validator: makeValidValidator(),
    logger,
    watch: makeWatch(),
  });

  return { connector, sessionManager, logger };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TmuxConnector.waitForReady()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ok() immediately when the pane has enough content on the first poll', async () => {
    // capturePaneContent returns 100 chars of content on the first call
    const { connector, logger } = makeConnectorWithCapture(['A'.repeat(100)]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 100,
      pollIntervalMs: 50,
      maxAttempts: 10,
      contentThreshold: 50,
    });

    // Advance past initial delay
    await vi.advanceTimersByTimeAsync(100);
    // First poll fires — content is sufficient
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'TUI ready',
      expect.objectContaining({ sessionName: 'beat-task-test', attempt: 1 }),
    );
  });

  it('returns ok() after N polls when content threshold is met on the Nth attempt', async () => {
    // First 3 calls return short content; 4th returns enough
    const { connector, sessionManager, logger } = makeConnectorWithCapture([
      'short',
      'still short',
      'still short',
      'A'.repeat(60),
    ]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 10,
      contentThreshold: 50,
    });

    // Initial delay = 0, then 3 failed polls + 1 success
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }

    const result = await promise;
    expect(result.ok).toBe(true);
    // Verify exactly 4 polls were made (not fewer — guards against threshold bug)
    expect(vi.mocked(sessionManager.capturePaneContent).mock.calls.length).toBe(4);
    // Verify the TUI-ready log carries the correct attempt count
    expect(logger.info).toHaveBeenCalledWith(
      'TUI ready',
      expect.objectContaining({ sessionName: 'beat-task-test', attempt: 4 }),
    );
  });

  it('returns ok() (best-effort) when all poll attempts are exhausted without threshold being met', async () => {
    // Always returns short content
    const { connector, logger } = makeConnectorWithCapture(['short']);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 3,
      contentThreshold: 50,
    });

    // Advance through all 3 poll intervals
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'waitForReady timed out — proceeding with best-effort delivery',
      expect.objectContaining({ sessionName: 'beat-task-test', maxAttempts: 3 }),
    );
  });

  it('returns err() immediately when the session dies during polling', async () => {
    // isAlive[0] = true  → early liveness check (before the loop) passes
    // isAlive[1] = false → loop attempt 0 liveness check returns err() immediately
    const { connector, sessionManager } = makeConnectorWithCapture(['short', 'short'], [true, false]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    // Resolve the initialDelayMs=0 setTimeout so the loop can start
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toMatch(/died during TUI initialization/);
    // capturePaneContent is never reached — isAlive returns false before the content check
    expect(sessionManager.capturePaneContent).not.toHaveBeenCalled();
  });

  it('respects custom options for all fields', async () => {
    // capturePaneContent returns 15 chars — above the custom threshold of 10
    const { connector } = makeConnectorWithCapture(['A'.repeat(15)]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 3,
      contentThreshold: 10,
    });

    // First poll at t=0
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('treats zero-length pane content as not-ready and continues polling', async () => {
    // Empty string × 2, then sufficient content
    const { connector } = makeConnectorWithCapture(['', '', 'A'.repeat(60)]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('treats whitespace-only pane content as not-ready after trim', async () => {
    // Whitespace-only is trimmed to empty; then sufficient content
    const { connector } = makeConnectorWithCapture(['   \n\n  ', 'A'.repeat(60)]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('treats capturePaneContent errors as not-ready and continues polling', async () => {
    // First call returns an error; second returns sufficient content
    const { connector } = makeConnectorWithCapture([new Error('capture failed'), 'A'.repeat(60)]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('uses default options when no options are provided', async () => {
    // Provide enough content after the initial delay
    const { connector } = makeConnectorWithCapture(['A'.repeat(60)]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle);

    // Advance past default initial delay (1500ms) + one poll interval (500ms)
    await vi.advanceTimersByTimeAsync(1500 + 500);

    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('session death detected by early liveness check returns err()', async () => {
    // isAlive returns false on the first call (the pre-loop early liveness check)
    const { connector } = makeConnectorWithCapture(['short'], [false]);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    // Flush microtasks — initial delay is 0ms so the early liveness check fires immediately
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toMatch(/died during initial startup delay/);
  });

  it('does not make more than maxAttempts polls before timing out', async () => {
    // capturePaneContent returns short content
    const { connector, sessionManager } = makeConnectorWithCapture(['short']);
    const handle = makeHandle();

    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    // Advance well past 5 × 10ms
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result.ok).toBe(true); // best-effort
    // capturePaneContent should have been called at most 5 times (one per attempt)
    expect(vi.mocked(sessionManager.capturePaneContent).mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('returns err() immediately when isAlive itself returns err()', async () => {
    // isAlive returns an err() result (as opposed to ok(false)) on the first in-loop call
    const logger = makeLogger();
    const sessionManager: TmuxSessionManagerPort = {
      createSession: vi.fn().mockReturnValue(ok({ sessionName: 'beat-task-xxx' })),
      destroySession: vi.fn().mockReturnValue(ok(undefined)),
      sendKeys: vi.fn().mockReturnValue(ok(undefined)),
      sendControlKeys: vi.fn().mockReturnValue(ok(undefined)),
      isAlive: vi
        .fn()
        // first call: early liveness check passes
        .mockReturnValueOnce(ok(true))
        // second call: in-loop check returns err()
        .mockReturnValueOnce(err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, 'isAlive failed'))),
      listSessions: vi.fn().mockReturnValue(ok([])),
      getSessionEnvironment: vi.fn().mockReturnValue(ok(undefined)),
      setSessionEnvironment: vi.fn().mockReturnValue(ok(undefined)),
      pasteContent: vi.fn().mockReturnValue(ok(undefined)),
      capturePaneContent: vi.fn().mockReturnValue(ok('short')),
    } as unknown as TmuxSessionManagerPort;

    const connector = new TmuxConnector({
      ...makeDefaultFsDeps(),
      sessionManager,
      hooks: makeValidHooks(),
      validator: makeValidValidator(),
      logger,
      watch: makeWatch(),
    });

    const handle = makeHandle('beat-task-xxx');
    const promise = connector.waitForReady(handle, {
      initialDelayMs: 0,
      pollIntervalMs: 10,
      maxAttempts: 5,
      contentThreshold: 50,
    });

    // Flush initial delay (0ms) — early liveness check passes (ok(true)),
    // then loop attempt 0 isAlive returns err() and exits immediately.
    await vi.advanceTimersByTimeAsync(10);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toMatch(/died during TUI initialization/);
  });
});

// ─── Delegation tests ─────────────────────────────────────────────────────────

describe('TmuxConnector.capturePaneContent()', () => {
  it('delegates to sessionManager.capturePaneContent with sessionName and lines', () => {
    const { connector, sessionManager } = makeConnectorWithCapture(['some content']);
    const handle = makeHandle();

    connector.capturePaneContent(handle, 20);

    expect(vi.mocked(sessionManager.capturePaneContent)).toHaveBeenCalledWith(handle.sessionName, 20);
  });

  it('delegates to sessionManager.capturePaneContent without lines when omitted', () => {
    const { connector, sessionManager } = makeConnectorWithCapture(['some content']);
    const handle = makeHandle();

    connector.capturePaneContent(handle);

    expect(vi.mocked(sessionManager.capturePaneContent)).toHaveBeenCalledWith(handle.sessionName, undefined);
  });

  it('returns the result from sessionManager.capturePaneContent unchanged', () => {
    const { connector } = makeConnectorWithCapture(['pane text']);
    const handle = makeHandle();

    const result = connector.capturePaneContent(handle);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : '').toBe('pane text');
  });
});
