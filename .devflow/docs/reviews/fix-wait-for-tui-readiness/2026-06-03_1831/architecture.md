# Architecture Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03T18:31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing waitForReady in session reuse path** - `src/implementations/event-driven-worker-pool.ts:reuseSession()`
**Confidence**: 82%
- Problem: `waitForReady()` is called in `launchAndRegister()` (fresh spawn, line 716) and in `orchestrate-interactive.ts` (line 267), but the `reuseSession()` path (line 466-545) delivers the prompt via `pasteContent` + `sendControlKeys('Enter')` without any readiness check. The reuse path sends `/clear` + a 300ms settle delay, but the TUI may not be fully ready to accept a new prompt after the /clear reset -- the same class of "prompt silently lost" bug could occur if the agent is slow to re-render after /clear. The PR description states the TUI "needs several seconds to initialize," and while reuse is not a cold start, the underlying concern (prompt delivered before input handler is ready) is the same pattern.
- Fix: Evaluate whether `waitForReady()` should be called after `prepareSessionForIteration()` and before `pasteContent()` in the reuse path. If the 300ms settle delay is sufficient for the /clear case (the TUI is already initialized and just resetting context), document that distinction explicitly with a DESIGN DECISION comment explaining why waitForReady is not needed on reuse.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **capturePaneContent delegation could validate session liveness before capture** - `src/implementations/tmux/tmux-connector.ts:386` (Confidence: 65%) -- The `capturePaneContent()` method delegates directly to `sessionManager.capturePaneContent()` without checking if the session is tracked in `activeSessions`. For the current use case (called only from `waitForReady` which does its own liveness check), this is fine. But if future callers use `capturePaneContent` independently, the lack of a guard could produce confusing errors. Low priority since the method's JSDoc and the port contract already document the "session not found returns ok('')" behavior.

- **Asymmetry between fresh-spawn error and reuse-path error handling for waitForReady** - `src/implementations/event-driven-worker-pool.ts:717-727` (Confidence: 62%) -- In `launchAndRegister`, a `waitForReady` failure triggers both `cleanupWorkerState` and `destroySessionWithWarning`. In `orchestrate-interactive.ts`, a `waitForReady` failure calls `failWith()` which destroys the handle and exits. The error paths are consistent within each call site, but the worker pool path does not emit any event (e.g., `TaskFailed`) on waitForReady failure -- the caller (`spawn()`) receives the error and the task remains in whatever state it was in. This is likely fine since the task was just created and the queue handler will surface the spawn failure, but worth verifying the end-to-end flow handles this gracefully.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The overall architecture of this change is well-structured and follows established project patterns. Key strengths:

1. **Port/adapter boundary respected** (applies ADR-004): `waitForReady()` is defined on the `TmuxConnectorPort` interface with `WaitForReadyOptions` in `tmux-types.ts` (core layer), keeping the domain boundary clean. The implementation lives in `TmuxConnector` (infrastructure layer). Callers depend only on the port.

2. **Correct layering**: The new `capturePaneContent()` on `TmuxConnectorPort` reuses the existing `TmuxSessionManagerCorePort.capturePaneContent()` method (added in Phase 9 Dashboard). No new infrastructure methods were needed -- the delegation chain is `TmuxConnectorPort -> TmuxConnector -> TmuxSessionManagerPort`, consistent with `sendKeys`, `isAlive`, `pasteContent`, etc.

3. **Bounded polling loop**: `waitForReady()` has a `maxAttempts` upper bound (default 20) and an explicit timeout behavior (best-effort ok). This satisfies the project's reliability principle (every loop has an explicit bound).

4. **Best-effort timeout design**: Returning `ok(undefined)` on timeout rather than `err()` is an intentional design choice that prevents slow environments from permanently blocking the spawn path. Session death during polling does return `err()`, which is the correct distinction (timeout = degraded but recoverable; death = terminal).

5. **Mock contract updated**: `MockTmuxConnector` and `createMockTmuxSessionManagerCore` both include the new methods, ensuring existing tests continue to work.

The single blocking finding is the missing `waitForReady` (or explicit documentation of its omission) in the session reuse path, which is architecturally significant because it creates an asymmetry between two prompt delivery paths that solve the same problem.
