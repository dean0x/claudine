# Regression Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04T12:38

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Best-effort ok() on timeout silently reverts to the pre-fix failure mode** - `src/implementations/tmux/tmux-connector.ts:450-456` (Confidence: 65%) -- When `waitForReady` exhausts all poll attempts without the TUI reaching the content threshold, it returns `ok(undefined)` and the prompt is delivered anyway. This is the same condition the feature was designed to prevent (prompt delivered before TUI is ready). The design decision is documented and intentional (spawn must not block permanently), and a warning is logged, but in slow environments this means the fix silently degrades to the old behavior. The configurable `WaitForReadyOptions` allow callers to tune for their environment, which mitigates this.

- **No integration-level test for waitForReady failure path in EventDrivenWorkerPool** - `src/implementations/event-driven-worker-pool.ts:726-736` (Confidence: 70%) -- The worker pool's `launchAndRegister` now has a failure branch for waitForReady (cleanupWorkerState + destroySessionWithWarning + return err). The mock in `tests/fixtures/mocks.ts:172` always returns `ok(undefined)`, so no worker pool test exercises this error path. The unit tests in `wait-for-ready.test.ts` cover the TmuxConnector behavior thoroughly, but the cleanup rollback path in the worker pool (which involves timer cleanup, DB unregistration, and session destruction) is only tested indirectly via the mock's happy path.

- **reuseSession DESIGN DECISION comment could be validated by test** - `src/implementations/event-driven-worker-pool.ts:513-520` (Confidence: 62%) -- The comment documents that `waitForReady()` is intentionally omitted from the reuse path because the TUI remains initialized across loop iterations. This is a sound reasoning. However, the assertion that `/clear` "does not tear down or re-initialise the input subsystem" is based on observed behavior rather than a Claude Code API contract. If future Claude Code versions change `/clear` semantics, the reuse path would silently regress to the pre-fix prompt loss behavior.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Rationale

This PR adds new functionality (`waitForReady`, `capturePaneContent`) without removing, renaming, or changing the behavior of any existing code. The regression checklist is clean across all categories:

### 1. No Exports Removed
Two new methods added to `TmuxConnectorPort` (`capturePaneContent`, `waitForReady`). One new export (`WaitForReadyOptions` from `tmux-types.ts` re-exported in `implementations/tmux/types.ts`). All existing exports preserved. Verified with `git diff main...HEAD | grep "^-export"` (empty).

### 2. Return Types Backward Compatible
`launchAndRegister` changed from sync `Result<Worker>` to async `Promise<Result<Worker>>`. This is a **private** method with a single call site (`spawn()` line 277), which was already async (`spawn(task: Task): Promise<Result<Worker>>`). The public `spawn()` signature is unchanged. The `await` keyword was correctly added at the call site. No external consumers are affected.

### 3. Default Values Unchanged
No existing default values were modified. New defaults are additive (`DEFAULT_READY_INITIAL_DELAY_MS = 1500`, `DEFAULT_READY_POLL_INTERVAL_MS = 500`, `DEFAULT_READY_MAX_ATTEMPTS = 20`, `DEFAULT_READY_CONTENT_THRESHOLD = 50`).

### 4. Side Effects Preserved
All existing event emissions (`TaskCompleted`, `TaskFailed`, `TaskTimeout`, `TaskQueued`) remain intact. All logging preserved. All timer setup/teardown (heartbeat, timeout, flushing) preserved. The `waitForReady` call is inserted between step 9 (startFlushing) and what was step 10 (now step 12, pasteContent) -- an additive insertion, not a replacement. The `setupTimeoutForWorker` was correctly moved after `waitForReady` (step 11) so task timeouts measure work time, not initialization time -- this is a behavioral improvement, not a regression (applies ADR-004).

### 5. All Consumers Updated
- `TmuxConnectorPort` interface: `capturePaneContent` and `waitForReady` added
- `TmuxSessionManagerCorePort`: `capturePaneContent` JSDoc updated to reflect dual usage
- `TmuxSessionManagerPort` (implementations/tmux/types.ts): JSDoc updated to match
- `MockTmuxConnector` (tests/fixtures/mocks.ts): `capturePaneContent` and `waitForReady` stubs added with correct return types (`ok('')` and `ok(undefined)`)
- `createMockTmuxSessionManagerCore` (tests/fixtures/mocks.ts): `capturePaneContent` stub added
- No incomplete migration -- all port/mock/implementation sites are consistent

### 6. Commit Message Matches Implementation
The main commit (e1e8d6a) states:
- "Add waitForReady() polling to TmuxConnectorPort" -- confirmed in code
- "launchAndRegister converted from sync to async" -- confirmed (line 696)
- "waitForReady polls with 1.5s initial delay, 500ms intervals, 20 max attempts" -- confirmed in defaults
- "session death during poll returns err()" -- confirmed (lines 422-430)
- "timeout returns best-effort ok()" -- confirmed (lines 450-456)

Follow-up commits match their messages:
- `07c1c64`: DESIGN DECISION comment in reuseSession + timeout moved after waitForReady -- confirmed
- `4ef7ee9`: capturePaneContent JSDoc updated -- confirmed in both tmux-types.ts and types.ts
- `0e5d941`: Early liveness check after initial delay -- confirmed (lines 412-418)
- `8c1a347`: Strengthened tests + capturePaneContent delegation tests -- confirmed (15 tests total)

### 7. No Incomplete Migrations
Every interface, implementation, and mock is updated in lockstep. No `grep` for old API patterns returned stale usage.

### 8. ADR Compliance
- applies ADR-004: Prompt delivery remains `pasteContent` + `sendControlKeys('Enter')` in all three paths (launchAndRegister, orchestrate-interactive, reuseSession). `waitForReady` is a readiness gate before delivery, not a replacement.
- ADR-007 (run mode recovery await) is orthogonal -- the recovery-manager.ts change in this PR is a formatting-only line-length fix (biome), confirmed by reading the diff.
- ADR-008 (bootstrap error propagation) is not impacted by this PR.

### 9. Test Suite Verification
All existing tests pass without modification:
- `test:tmux`: 215 tests passed (5 files, including the new wait-for-ready.test.ts with 15 tests)
- `test:core`: all passed
- `test:handlers`: 268 tests passed (11 files)
- `test:integration`: all passed

The mock stubs (`waitForReady: vi.fn().mockResolvedValue(ok(undefined))`, `capturePaneContent: vi.fn().mockReturnValue(ok(''))`) resolve in one microtask, preserving the timing characteristics expected by existing tests.

### 10. Breaking Change Assessment
**No breaking changes.** All modifications are additive (new interface methods, new test file, new constants). The only behavioral change is the insertion of a readiness wait before prompt delivery, which fixes a correctness bug (silently lost prompts) without altering the observable contract of the `spawn()` or `spawnAndDeliverPrompt()` functions.
