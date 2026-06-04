# Reliability Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03T18:31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Initial delay does not check session liveness -- dead session wastes 1.5s before detection** - `src/implementations/tmux/tmux-connector.ts:411`
**Confidence**: 82%
- Problem: `waitForReady()` awaits the full `initialDelayMs` (default 1500ms) before entering the polling loop. If the session crashes immediately after spawn, the method sleeps 1500ms before the first `isAlive()` check detects the death. In the `launchAndRegister` path, the worker is already registered with timers running during this dead period.
- Impact: 1.5 seconds of unnecessary delay when a session dies on startup. The flushing timer fires into an empty capture buffer (harmless), but the heartbeat timer would write a stale DB record after 30s (not reachable in the 1.5s window). Practically, this is a responsiveness issue rather than a correctness bug -- the death is detected on the first loop iteration.
- Fix: Add a liveness check between the initial delay and the first poll iteration. This catches the common "immediate crash" case without adding complexity:
  ```typescript
  await new Promise<void>((resolve) => setTimeout(resolve, initialDelayMs));

  // Early liveness check after initial delay -- catches immediate crashes
  const earlyAlive = this.deps.sessionManager.isAlive(handle.sessionName);
  if (!earlyAlive.ok || !earlyAlive.value) {
    return err(
      tmuxSessionFailed(
        'waitForReady',
        `session '${handle.sessionName}' died during initial TUI startup delay`,
      ),
    );
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // ... existing loop
  ```
  Alternatively, split the initial delay into two halves with a liveness check in between.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Timers start before waitForReady completes -- timeout clock ticks during TUI initialization** - `src/implementations/event-driven-worker-pool.ts:707-716`
**Confidence**: 80%
- Problem: In `launchAndRegister()`, `setupTimeoutForWorker` (step 8) fires before `waitForReady` (step 9b). The worst-case `waitForReady` duration with defaults is 1500 + 20*500 = 11,500ms. A task with a short user-defined timeout (e.g., 15s) would have only ~3.5s of actual work time after the TUI becomes ready. The timeout timer does not distinguish "waiting for TUI init" from "agent is working."
- Impact: Tasks with short timeouts could be killed prematurely. In practice, most tasks have longer timeouts (minutes), so this is a low-probability scenario. The heartbeat timer (30s interval) is not affected -- its first tick fires at 30s, well after the worst-case 11.5s wait.
- Fix: Move `setupTimeoutForWorker` after `waitForReady` returns, or reset the timeout timer after waitForReady succeeds. The heartbeat and flushing timers can remain before waitForReady (they are harmless during the wait):
  ```typescript
  // Step 8: Setup heartbeat (timeout moved after waitForReady)
  this.setupHeartbeatForWorker(worker);

  // Step 9: Start periodic output flushing
  this.startFlushing(worker);

  // Step 9b: Wait for TUI readiness
  const readyResult = await this.tmuxConnector.waitForReady(handle);
  if (!readyResult.ok) {
    this.cleanupWorkerState(worker.id, task.id);
    this.destroySessionWithWarning(handle, 'waitForReady failure');
    return err(/* ... */);
  }

  // Step 9c: Start timeout AFTER TUI is ready (so timeout measures work time, not init time)
  this.setupTimeoutForWorker(worker);
  ```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **No waitForReady on persistent session reuse path** - `src/implementations/event-driven-worker-pool.ts:512` (Confidence: 65%) -- The `reuseSession()` method sends `pasteContent` immediately after `prepareSessionForIteration()` without calling `waitForReady()`. This is likely correct since the session is already running and the TUI is initialized, but after a `/clear` command the TUI state resets and there is a theoretical window where the input handler is not ready. The 300ms CLEAR_SETTLE_MS delay may be insufficient in slow environments.

- **totalWaitMs log is an approximation** - `src/implementations/tmux/tmux-connector.ts:448` (Confidence: 62%) -- The logged `totalWaitMs` is `initialDelayMs + maxAttempts * pollIntervalMs`, but actual wall time includes the synchronous `isAlive()` and `capturePaneContent()` spawnSync calls (each ~5-50ms). With 20 attempts and 2 spawnSync per attempt, the real elapsed time could be 500-2000ms longer than logged. Minor observability gap.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Decisions Applied**:
- applies ADR-004: prompt delivery correctly uses `pasteContent` + `sendControlKeys('Enter')` in both the fresh spawn and interactive orchestrator paths.
- applies ADR-007: `waitForReady` is wired into both spawn paths (launchAndRegister for workers, spawnAndDeliverPrompt for interactive orchestrators) as stated in the PR description.

**Reliability Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core design is sound: bounded polling (20 max attempts, configurable), session death detection via `isAlive()` at each poll iteration, best-effort timeout semantics, and proper cleanup on failure. The two findings are not correctness bugs but reliability refinements -- the initial delay liveness gap (HIGH) is a 1.5s responsiveness delay, and the timeout-during-init (MEDIUM) only matters for tasks with unusually short timeouts. Both are straightforward to address.
