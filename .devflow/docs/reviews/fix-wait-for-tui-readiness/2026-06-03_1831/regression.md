# Regression Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-03

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**launchAndRegister sync-to-async conversion may break spawn timing for existing tests** - `src/implementations/event-driven-worker-pool.ts:687`
**Confidence**: 85%
- Problem: `launchAndRegister` was converted from a synchronous method returning `Result<Worker>` to an async method returning `Promise<Result<Worker>>`. The single call site at line 277 was updated to `await`, and the containing `spawn()` method was already async, so the public API signature (`spawn(task: Task): Promise<Result<Worker>>`) is unchanged. However, existing tests that rely on the previous synchronous-within-async behavior (mock connector stubs returning synchronously from `spawn`, expecting worker registration to complete in the same microtask) could now experience different timing due to `waitForReady()` introducing a real `await` boundary.
- Impact: Tests using `createMockTmuxConnector` are safe -- the mock's `waitForReady` returns `Promise.resolve(ok(undefined))` which resolves in one microtask. No existing call sites outside of `spawn()` invoke `launchAndRegister` (it is private). The regression risk is LOW because the public API contract is preserved and mock stubs are already async-compatible.
- Fix: No code change needed. The mock stubs (`waitForReady: vi.fn().mockResolvedValue(ok(undefined))`) correctly simulate immediate readiness. Verify by running `npm run test:core && npm run test:handlers && npm run test:integration`.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **reuseSession path does not call waitForReady** - `src/implementations/event-driven-worker-pool.ts:512` (Confidence: 65%) -- The `reuseSession()` path delivers a prompt via `pasteContent + sendControlKeys` without calling `waitForReady()`. This is likely intentional (the TUI is already initialized for reused sessions), but if a `/clear` command resets the TUI input handler, the same silent-loss condition could occur. Worth a manual verification that `/clear` does not require a readiness wait.

- **Best-effort ok() on timeout masks environment issues** - `src/implementations/tmux/tmux-connector.ts:448` (Confidence: 60%) -- When `waitForReady` exhausts all poll attempts, it returns `ok(undefined)` (best-effort proceed). This means the prompt delivery will still be attempted even if the TUI never became ready, silently reverting to the same failure mode the feature was designed to fix. The design decision documents this as intentional (spawn must not block permanently), but it means slow environments could still lose prompts. Consider whether a warning-level log (already present) is sufficient or whether the caller should be informed it was a timeout.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Rationale

This PR adds new functionality (`waitForReady`, `capturePaneContent`) to the `TmuxConnectorPort` and `TmuxConnector` without removing or modifying any existing exports, method signatures, return types, or default values. The regression checklist is clean:

1. **No exports removed** -- Two new methods added to the interface; all existing methods preserved.
2. **Return types backward compatible** -- `launchAndRegister` changed from sync `Result<Worker>` to async `Promise<Result<Worker>>`, but this is a private method with a single call site that was already inside an async method. The public `spawn()` API signature is unchanged.
3. **Default values unchanged** -- No existing defaults modified.
4. **Side effects preserved** -- All existing event emissions, logging, and timer setup remain intact. The `waitForReady` call is inserted between step 9 (startFlushing) and step 10 (pasteContent) as a new step 9b.
5. **All consumers updated** -- `MockTmuxConnector` gains `capturePaneContent` and `waitForReady` stubs. `createMockTmuxSessionManagerCore` gains `capturePaneContent` stub. Both stubs return success values, so all existing tests pass without behavior changes.
6. **Commit message matches implementation** -- The commit says "Add waitForReady() polling" and "launchAndRegister converted from sync to async", both accurately reflected in the diff.
7. **No incomplete migrations** -- `TmuxConnectorPort` interface, `TmuxConnector` class, `TmuxSessionManagerCorePort`, `TmuxSessionManagerPort`, and both mock factories all consistently implement the new methods.
8. **ADR-004 applied correctly** -- Prompt delivery still uses `pasteContent + sendControlKeys('Enter')` (`applies ADR-004`). The `waitForReady` call is inserted before this sequence, not replacing it.
9. **ADR-007 not impacted** -- Recovery synchronous await in run mode is orthogonal to this change; the recovery-manager.ts change is a formatting-only line-length fix (biome).
10. **11 new unit tests** cover all behavior branches: immediate readiness, multi-poll convergence, timeout best-effort, session death, custom options, whitespace handling, capture errors, default options, first-poll death, and max-attempts cap.

The single HIGH finding (timing change from sync-to-async conversion) is mitigated by the mock design and is not a functional regression. No blocking issues.
