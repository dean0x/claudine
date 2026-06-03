# Complexity Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03

## Issues in Your Changes (BLOCKING)

### HIGH

**`launchAndRegister` function length approaches warning threshold** - `src/implementations/event-driven-worker-pool.ts:687-765`
**Confidence**: 82%
- Problem: `launchAndRegister()` is now ~78 lines long (Steps 6-10 including the new Step 9b waitForReady block). It has 5 sequential error-handling branches (spawn, register, waitForReady, pasteContent, sendControlKeys), each with its own cleanup rollback pattern. The function performs spawn, registration, timer setup, async readiness polling, and prompt delivery — five distinct responsibilities in one method.
- Fix: The function is at the upper end of the warning zone (50-200 lines) and each error branch follows the same pattern (cleanupWorkerState + destroySessionWithWarning + return err). This is manageable now but worth noting: the next feature addition to this path will push it into extraction territory. No immediate action required — flagging to prevent further growth.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Repeated rollback pattern in `launchAndRegister`** - `src/implementations/event-driven-worker-pool.ts:717-754` (Confidence: 65%) — The three error branches (waitForReady, pasteContent, sendControlKeys) each call `cleanupWorkerState` + `destroySessionWithWarning` + construct `AutobeatError` with `WORKER_SPAWN_FAILED`. A small helper like `failAfterRegistration(worker, handle, task, message)` could eliminate the triple repetition. Not blocking since the pattern is clear and each branch has a distinct error message.

- **`waitForReady` polling loop uses two blocking syscalls per iteration** - `src/implementations/tmux/tmux-connector.ts:413-440` (Confidence: 62%) — Each poll iteration calls both `isAlive()` and `capturePaneContent()`, which are both `spawnSync` calls via the session manager. At default settings (20 attempts), this is up to 40 blocking syscalls during the readiness wait. The `isAlive` check could be performed every Nth iteration instead of every iteration, since session death during TUI init is an edge case. Not blocking since the total wait is bounded (maxAttempts * pollIntervalMs) and the default values are reasonable.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `waitForReady()` method is well-structured: bounded loop (maxAttempts=20, applies ADR-004 prompt delivery pattern), early exit on session death, best-effort fallback on timeout, and all options are configurable via `WaitForReadyOptions`. The cyclomatic complexity of the method itself is low (~4 — one loop, two conditionals inside). The interface addition (`capturePaneContent` + `waitForReady` on `TmuxConnectorPort`) is clean and the async boundary is correctly placed. The test suite (359 lines, 10 test cases) covers all branches including edge cases (whitespace-only content, capture errors, session death on first poll, max attempts enforcement). The only complexity concern is the growing size of `launchAndRegister`, which should be monitored for future growth but does not block this PR.
