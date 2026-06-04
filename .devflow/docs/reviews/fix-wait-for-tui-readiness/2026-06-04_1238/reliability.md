# Reliability Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04T12:38

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Best-effort ok() on timeout silently reverts to the failure mode the feature fixes** - `src/implementations/tmux/tmux-connector.ts:450-456` (Confidence: 65%) -- When `waitForReady` exhausts all 20 poll attempts, it returns `ok(undefined)` and the caller proceeds to `pasteContent`. If the TUI genuinely never became ready, the prompt is silently lost -- the exact bug the feature was designed to prevent. The design decision to use best-effort (documented in JSDoc and the timeout log) is reasonable for avoiding permanent spawn blocks in degraded environments, and the caller cannot distinguish "TUI ready" from "gave up waiting". In practice the 11.5s worst case is generous for typical 2-4s TUI startup. If this ever surfaces as a production issue, consider returning an `ok` variant that carries a `timedOut: boolean` flag so callers can log or retry selectively.

- **Approximate totalWaitMs in timeout log message** - `src/implementations/tmux/tmux-connector.ts:454` (Confidence: 62%) -- The logged `totalWaitMs` is computed as `initialDelayMs + maxAttempts * pollIntervalMs`, which does not account for time spent in the two synchronous `spawnSync` calls (`isAlive` + `capturePaneContent`) per iteration, each taking ~2-5ms. At 20 attempts the drift is ~40-200ms -- negligible for operational debugging but worth a comment noting the approximation.

- **Double subprocess per poll iteration could be reduced** - `src/implementations/tmux/tmux-connector.ts:420-444` (Confidence: 60%) -- Each poll calls `isAlive()` (tmux `has-session`) then `capturePaneContent()` (tmux `capture-pane`). A successful `capture-pane` on a dead session returns `ok('')` (per the JSDoc on `capturePaneContent`), meaning a single capture call could serve as both a liveness probe and content check. This would halve subprocess spawns per iteration. However, the current approach is clearer -- the liveness check is explicit and the error message distinguishes "session died" from "not enough content yet". At 500ms intervals and ~5ms per subprocess pair, the overhead is negligible. Not worth changing for correctness or performance; noted for future reference.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Reliability Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This PR introduces a well-bounded polling mechanism that addresses a real reliability problem -- prompts delivered before the Claude Code TUI initializes are silently lost, causing task failures with no visible error. The implementation demonstrates strong adherence to reliability principles:

1. **Bounded iteration** (applies reliability rule 1): The polling loop has a hard `maxAttempts` upper bound (default 20). The loop cannot run forever. Combined with the configurable `pollIntervalMs`, the worst-case wall time is deterministic: `initialDelayMs + maxAttempts * pollIntervalMs` = 11.5s with defaults. This avoids the unbounded-retry anti-pattern.

2. **Early liveness assertion** (applies reliability rule 2): An explicit liveness check fires immediately after the initial delay (line 413-418), catching the common "immediate crash" case before entering the poll loop. This was added in commit `0e5d941` to address the prior review's HIGH finding about wasting 1.5s on a dead session. The in-loop liveness check at the top of each iteration (line 422-429) provides defense-in-depth against sessions dying during TUI initialization.

3. **Session death detection returns err() immediately**: When `isAlive` returns `ok(false)` or `err()`, `waitForReady` returns `err()` without further polling. The caller (`launchAndRegister`) then performs full rollback: `cleanupWorkerState` + `destroySessionWithWarning` + `return err(AutobeatError)`. The `orchestrate-interactive` path calls `failWith()` which destroys the handle and exits. Both paths prevent orphaned resources. (avoids PF-004 -- multi-step rollback covers both worker state and tmux session)

4. **Prompt delivery pattern preserved** (applies ADR-004): `waitForReady` does not change the prompt delivery mechanism -- it inserts a readiness gate before the existing `pasteContent` + `sendControlKeys('Enter')` sequence. The gate is additive; removing it would revert to the old behavior rather than breaking anything new.

5. **Reuse path correctly skips waitForReady**: The `reuseSession()` path (line 513-520) documents why `waitForReady` is not needed for persistent session reuse: the TUI's input handler is already registered and `/clear` does not reinitialize it. The 300ms `CLEAR_SETTLE_MS` delay is sufficient for the clearing animation. This was explicitly documented with a DESIGN DECISION comment (applies ADR-004).

6. **Task timeout starts after TUI ready** (line 739-742): `setupTimeoutForWorker` is called after `waitForReady` returns, ensuring the configured task deadline measures actual work time rather than including TUI initialization. This prevents short-timeout tasks from exhausting their budget during the readiness wait -- a correctness improvement that follows naturally from the insertion point.

7. **All options configurable**: `WaitForReadyOptions` exposes `initialDelayMs`, `pollIntervalMs`, `maxAttempts`, and `contentThreshold` with sensible defaults. Callers (or future configuration surfaces) can tune for their environment without code changes.

8. **Mock contract consistent**: `MockTmuxConnector.waitForReady` returns `Promise.resolve(ok(undefined))` (immediate success), and `createMockTmuxSessionManagerCore` includes `capturePaneContent`. Existing tests are unaffected by the new async boundary in `launchAndRegister` because mock stubs resolve in one microtask.

9. **Test coverage comprehensive**: 11 unit tests cover: immediate readiness, multi-poll convergence, timeout best-effort, session death during polling, custom options, empty content, whitespace-only content, capture errors, default options, early-liveness death, max-attempts cap, and `isAlive` returning `err()`. The `capturePaneContent` delegation is also tested with 3 cases. All branches of the polling loop are exercised.

10. **Recovery manager change is cosmetic only**: The `recovery-manager.ts` diff is a line-length reformatting of the `isWorkerSessionAlive` method signature -- zero runtime impact. (applies ADR-007 -- recovery synchronous await is orthogonal and unaffected)

No blocking reliability issues found. The implementation follows the project's established patterns for bounded loops, Result-type error handling, and defense-in-depth liveness checking.
