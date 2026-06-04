# Testing Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing integration test for `launchAndRegister` async change (`await` on `waitForReady`)** - `src/implementations/event-driven-worker-pool.ts:696`
**Confidence**: 85%
- Problem: `launchAndRegister` changed from synchronous `Result<Worker>` to async `Promise<Result<Worker>>`, and the call site in `spawn()` changed from `this.launchAndRegister(...)` to `await this.launchAndRegister(...)`. This is a behavioral change to the core worker spawn path. The `waitForReady` mock in `createMockTmuxConnector` returns `ok(undefined)` immediately, so existing worker pool tests pass without exercising the new async flow. There is no test that verifies the worker pool correctly awaits the ready signal before delivering the prompt, nor a test that verifies the error path (session death during `waitForReady`) properly cleans up worker state and returns `err()`.
- Fix: Add integration-level tests in `event-driven-worker-pool.test.ts` that:
  1. Verify `spawn()` awaits `waitForReady` before calling `pasteContent` (assert call order on mock).
  2. Verify that when `waitForReady` returns `err()`, the worker is cleaned up (`cleanupWorkerState` + `destroySessionWithWarning`) and `spawn()` returns an appropriate error.
  3. Verify that `setupTimeoutForWorker` is called AFTER `waitForReady` resolves (timeout starts after TUI init, not before).

### MEDIUM

**No test for the orchestrate-interactive `waitForReady` call site** - `src/cli/commands/orchestrate-interactive.ts:267-276`
**Confidence**: 82%
- Problem: The interactive orchestrator's `spawnAndDeliverPrompt` function now calls `tmuxConnector.waitForReady(handle)` before prompt delivery, with a dedicated error path (`failWith`). This call site is untested. If `waitForReady` returns `err()`, the function calls `failWith` with the handle (destroying the session and exiting), but no test validates this path.
- Fix: Add a test for `spawnAndDeliverPrompt` (or its calling function) where `waitForReady` returns `err()` and verify the session is destroyed and the orchestration is finalized. If `orchestrate-interactive.ts` lacks a test file, this could be tracked as a follow-up issue.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Redundant timer advance in session-death test** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:227-228`
**Confidence**: 80%
- Problem: The test "returns err() immediately when the session dies during polling" advances timers twice (`await vi.advanceTimersByTimeAsync(10)` on lines 226 and 228). The `initialDelayMs` is 0, so the first advance resolves the initial delay and the loop starts. At attempt 0, `isAlive` returns `false` (from `isAliveValues[1]`), which returns `err()` synchronously without reaching the `pollIntervalMs` sleep. The second advance is dead code that does nothing.
- Fix: Remove the second `await vi.advanceTimersByTimeAsync(10)` or replace with a comment explaining why two advances are needed (if there is a subtle microtask ordering reason). Keeping dead timer advances makes the test harder to reason about.

```typescript
// Current (redundant second advance):
// First poll: alive=true, content short
await vi.advanceTimersByTimeAsync(10);
// Second poll: alive=false → error
await vi.advanceTimersByTimeAsync(10);

// Suggested:
// Advance past initial delay (0ms) — loop starts, isAlive returns false → error
await vi.advanceTimersByTimeAsync(0);
```

## Pre-existing Issues (Not Blocking)

(none found at CRITICAL severity)

## Suggestions (Lower Confidence)

- **Test does not verify `capturePaneContent` is NOT called when `isAlive` returns `false`** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:213` (Confidence: 70%) -- When the session dies on entry to the loop, the implementation returns `err()` before reaching `capturePaneContent`. Asserting that `capturePaneContent` was not called on that attempt would strengthen the behavioral guarantee (applies ADR-004 -- prompt delivery depends on liveness).

- **No test for `waitForReady` timeout calculation in the warn log** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:188` (Confidence: 65%) -- The timeout test asserts the warn message text and `maxAttempts` but not the `totalWaitMs` field. The implementation computes `totalWaitMs: initialDelayMs + maxAttempts * pollIntervalMs` -- an incorrect formula (it should be `initialDelayMs + (maxAttempts - 1) * pollIntervalMs + pollIntervalMs` for the last sleep... actually the formula is correct since the sleep runs after each attempt). The log field is informational, so this is low priority.

- **`makeConnectorWithCapture` helper couples test setup to full `TmuxConnector` constructor** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:75-117` (Confidence: 62%) -- The helper creates a full `TmuxConnector` with all deps mocked. This is a borderline integration test disguised as a unit test. The trade-off is acceptable because `waitForReady` depends on `this.deps.sessionManager` and `this.deps.logger` which are internal to the connector. The alternative (testing the method in isolation via extraction) would over-engineer the boundary.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new `wait-for-ready.test.ts` file is well-structured: it uses fake timers correctly, follows AAA pattern, covers happy path, error paths, edge cases (whitespace, empty content, capture errors), default options, and the max-attempts bound. Test names are descriptive and assertions verify both return values and observable side effects (log messages, call counts). The `capturePaneContent` delegation tests are clean and complete.

The main gap is the absence of integration-level tests for the two call sites that consume `waitForReady`: the worker pool's `launchAndRegister` (now async) and the interactive orchestrator's `spawnAndDeliverPrompt`. The unit tests prove `waitForReady` itself works correctly, but they do not prove the callers handle its results correctly -- especially the error/cleanup paths and the timing of `setupTimeoutForWorker` (moved to post-ready). The worker pool path is the more important of the two because it affects every task spawn.
