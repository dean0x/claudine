# Architecture Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04

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

(none)

## Architectural Analysis

### Port Interface Extension — Well-Formed

The PR adds two methods to `TmuxConnectorPort` in `src/core/tmux-types.ts`:

1. **`capturePaneContent(handle, lines?)`** — Synchronous delegation to `TmuxSessionManagerCorePort.capturePaneContent`. This follows the exact same delegation pattern used by `sendControlKeys`, `isAlive`, `pasteContent`, `setEnvironment`, and `sendKeys`. The method already existed on `TmuxSessionManagerCorePort` (Phase 9 Dashboard); promoting it to the connector port is the correct way to make it available to `waitForReady()` without the connector reaching through itself to the session manager. Confidence: 95%.

2. **`waitForReady(handle, options?)`** — The first async method on `TmuxConnectorPort`. This is a meaningful contract change: all other port methods are synchronous. The async nature is inherent — polling with delays cannot be synchronous. The implementation correctly lives in `TmuxConnector` (the canonical implementation) rather than in the worker pool, keeping the polling algorithm co-located with the session management infrastructure it depends on. Confidence: 95%.

The `WaitForReadyOptions` interface in `core/tmux-types.ts` uses `readonly` fields and all-optional design with sensible defaults applied in the implementation — consistent with the project's immutable-by-default principle. (applies ADR-004)

### Layering — Dependency Direction Correct

Dependencies flow inward:
- `EventDrivenWorkerPool` (services/implementations) depends on `TmuxConnectorPort` (core) — correct.
- `TmuxConnector` (implementations) implements `TmuxConnectorPort` (core) — correct.
- `orchestrate-interactive.ts` (CLI layer) depends on `TmuxConnectorPort` (core) — correct.

No new layering violations introduced. The `WaitForReadyOptions` type is defined in `core/tmux-types.ts` (core layer) and re-exported from `implementations/tmux/types.ts` — follows the established re-export pattern documented in the file header.

### Sync-to-Async Conversion — launchAndRegister

`launchAndRegister` changed from `private launchAndRegister(params): Result<Worker>` to `private async launchAndRegister(params): Promise<Result<Worker>>`. This is a correct and minimal change:

- The caller (`spawn()`) was already `async` — the `await` addition at the call site is straightforward.
- The return type change from `Result<Worker>` to `Promise<Result<Worker>>` maintains the Result-based error handling pattern (no thrown exceptions).
- Only one call site in `spawn()` needed updating.

### Step Reordering — Timeout After Readiness

The timeout timer (`setupTimeoutForWorker`) was moved from Step 8 (pre-waitForReady) to Step 11 (post-waitForReady). The rationale is documented inline: `waitForReady()` can take up to ~11.5s on first spawn; starting the timeout before readiness would consume task budget on TUI initialization rather than actual work. This is architecturally sound — the timeout should measure the task's execution window, not infrastructure startup.

Heartbeat timer (`setupHeartbeatForWorker`) remains at Step 8 (pre-waitForReady), which is correct — the session should be monitored for liveness during TUI initialization.

### Reuse Path Exclusion — Intentional and Documented

The reuse path in `reuseSession()` (lines 512-520) explicitly documents why `waitForReady()` is NOT called for persistent session reuse: the TUI is already initialized, the input handler is already registered, and `/clear` only resets conversation context. The 300ms `CLEAR_SETTLE_MS` delay is sufficient. This avoids adding 1.5s+ of unnecessary latency per loop iteration with no correctness benefit. The comment cites `applies ADR-004`.

### Error Handling — Consistent with Existing Patterns

- `waitForReady()` failure in `launchAndRegister`: triggers `cleanupWorkerState` + `destroySessionWithWarning` — identical rollback pattern to `pasteContent` and `sendControlKeys` failures that already existed.
- `waitForReady()` failure in `orchestrate-interactive.ts`: calls `failWith()` with the handle — consistent with how paste/enter failures are handled.
- Best-effort timeout (maxAttempts exhausted): returns `ok(undefined)` with a warning log — the spawn path is not permanently blocked. This is a deliberate trade-off documented in the interface JSDoc.
- Session death during polling: returns `err()` immediately — fast-fail on unrecoverable condition.

### Mock Updates — Complete

Both `createMockTmuxConnector` and `createMockTmuxSessionManagerCore` in `tests/fixtures/mocks.ts` are updated with the new methods. `capturePaneContent` returns `ok('')` (matches session-not-found behavior). `waitForReady` returns `mockResolvedValue(ok(undefined))` (async success). This ensures all existing tests that use these mocks continue to work without modification.

### Recovery Manager — Formatting Only

The `isWorkerSessionAlive` method in `recovery-manager.ts` was reformatted (parameter list split across lines) with no behavioral change. No architectural concern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This PR demonstrates strong architectural discipline:

1. **Port boundary respected** — New functionality added to the port interface (`TmuxConnectorPort`) with the implementation in the canonical `TmuxConnector` class. The delegation pattern (`capturePaneContent`) is consistent with all existing port methods.

2. **Layering preserved** — All dependency arrows point inward (CLI/services -> core ports -> implementations). No new cross-layer violations.

3. **Single Responsibility** — `waitForReady` is a connector concern (it depends on `capturePaneContent` and `isAlive`), not a worker pool concern. The worker pool calls it through the port interface without knowing the polling details.

4. **Design decisions documented** — The reuse-path exclusion, timeout reordering, and best-effort timeout behavior are all documented with inline DESIGN DECISION comments and ADR citations.

5. **Error handling consistent** — Rollback patterns in `launchAndRegister` are identical for all failure modes (waitForReady, pasteContent, sendControlKeys). The Result type is used throughout — no thrown exceptions in the business logic path.
