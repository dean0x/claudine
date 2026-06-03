# Consistency Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03

## Issues in Your Changes (BLOCKING)

### HIGH

**Stale JSDoc on `TmuxSessionManagerCorePort.capturePaneContent` contradicts new usage** - `src/core/tmux-types.ts:155-159`
**Confidence**: 95%
- Problem: The JSDoc on `TmuxSessionManagerCorePort.capturePaneContent` explicitly states: *"ARCHITECTURE (Phase 9 Dashboard): Display-only method for live pane preview in the channel detail view. No business logic depends on the captured content."* However, `waitForReady()` now uses `capturePaneContent` as business-critical logic to determine TUI readiness before prompt delivery. The comment "No business logic depends on the captured content" is factually incorrect after this PR.
- The same stale comment appears on `TmuxSessionManagerPort.capturePaneContent` in `src/implementations/tmux/types.ts:210-213`.
- Fix: Update the JSDoc on both `TmuxSessionManagerCorePort.capturePaneContent` (core/tmux-types.ts:155-159) and `TmuxSessionManagerPort.capturePaneContent` (implementations/tmux/types.ts:210-213) to reflect the dual usage:
  ```typescript
  /**
   * Capture the visible pane content of a tmux session.
   * Implementation: `tmux capture-pane -t '{name}' -p -S -{lines}`
   *
   * Used by:
   * - Dashboard channel detail view for live pane preview (Phase 9)
   * - TmuxConnector.waitForReady() for TUI readiness polling before prompt delivery
   *
   * Session validation: name must match SESSION_NAME_REGEX.
   * "Session not found" is treated as empty string (ok('')) rather than an error --
   * the session may have exited between the liveness check and this call.
   */
  ```

### MEDIUM

**Error message pattern inconsistency between `launchAndRegister` and `orchestrate-interactive` for `waitForReady` failure** - `src/implementations/event-driven-worker-pool.ts:723` vs `src/cli/commands/orchestrate-interactive.ts:269`
**Confidence**: 82%
- Problem: Both call sites handle `waitForReady` failure, but use slightly different error message patterns:
  - Worker pool (line 723): `Session died during TUI initialization: ${readyResult.error.message}` wrapped in a new `AutobeatError(ErrorCode.WORKER_SPAWN_FAILED, ...)`
  - Orchestrate-interactive (line 269): `` `Session died during TUI initialization: ${readyResult.error.message}` `` passed as a string to `failWith()`
  
  The worker pool wraps the error in `AutobeatError` with `WORKER_SPAWN_FAILED` code; the interactive path passes a raw string. While they are in different contexts (one returns `Result`, one calls `process.exit`), the error classification differs. The interactive path does not preserve the error code, which means structured logging or error monitoring cannot distinguish "session died during init" from other `failWith` exits.
- Fix: This is a minor style inconsistency rather than a functional bug. If the project moves toward structured error reporting on the interactive path, consider passing an `AutobeatError` through `failWith` rather than a raw string. No immediate action required.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`waitForReady` not called in `reuseSession` prompt delivery path** - `src/implementations/event-driven-worker-pool.ts:512` (Confidence: 65%) -- The reuse path sends `pasteContent` + `sendControlKeys('Enter')` after `/clear` + 300ms settle but does not call `waitForReady()`. This is likely correct because the TUI is already initialized from a prior iteration, but the asymmetry with the fresh-spawn path is not documented. A brief comment at the reuse `pasteContent` call site noting "waitForReady not needed -- TUI already initialized from prior iteration" would make the intentional omission explicit and prevent future reviewers from flagging it.

- **`waitForReady` timeout calculation is approximate** - `src/implementations/tmux/tmux-connector.ts:447` (Confidence: 62%) -- The `totalWaitMs` logged on timeout is computed as `initialDelayMs + maxAttempts * pollIntervalMs`, but the actual wall time also includes the time spent in each `isAlive()` + `capturePaneContent()` call. For observability this approximation is fine, but worth noting if the logged value ever needs to match actual elapsed time.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR is well-structured and follows existing patterns with high fidelity. The `waitForReady` implementation matches the project's Result-type error handling, polling loop pattern (bounded via `maxAttempts`), and the `pasteContent` + `sendControlKeys('Enter')` prompt delivery pattern (applies ADR-004). The port interface additions (`capturePaneContent`, `waitForReady`) follow the established delegate-to-session-manager pattern used by all other `TmuxConnectorPort` methods. Mock updates are consistent with existing mock shapes. The test file follows the project's test helper patterns and uses behavior-focused assertions.

The blocking HIGH issue is a stale JSDoc that now actively misleads readers about the role of `capturePaneContent`. Updating two comments is low-effort and high-value for future maintainability.
