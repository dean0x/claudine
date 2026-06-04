# Testing Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Test does not verify the attempt count on the Nth-poll success path** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:158`
**Confidence**: 85%
- Problem: The test "returns ok() after N polls when content threshold is met on the Nth attempt" asserts `result.ok` is true but does not verify that exactly 4 polls occurred (via `sessionManager.capturePaneContent` call count) or that the `logger.info` was called with `attempt: 4`. This means the test would pass even if the implementation returned on the first poll due to a threshold bug. The equivalent "first poll" test at line 133 does verify `logger.info` with `attempt: 1`, but this multi-poll test skips that assertion.
- Fix: Add an assertion on the capturePaneContent call count or the logger.info context:
```typescript
expect(result.ok).toBe(true);
// Verify exactly 4 polls were made
expect(vi.mocked(sessionManager.capturePaneContent).mock.calls.length).toBe(4);
```
Note: `sessionManager` is not destructured in this test; the `makeConnectorWithCapture` return value would need to be captured with `{ connector, sessionManager }`.

**Missing test for capturePaneContent delegation** - `tests/unit/implementations/tmux/wait-for-ready.test.ts` (file-level gap)
**Confidence**: 82%
- Problem: The PR adds a new `capturePaneContent(handle, lines?)` method to `TmuxConnector` (tmux-connector.ts:386-388) that delegates to `sessionManager.capturePaneContent`. This is a public port method but has no direct unit test verifying the delegation. The `waitForReady` tests exercise it indirectly via the internal polling loop, but never assert that calling `connector.capturePaneContent(handle)` returns the session manager's result, or that the optional `lines` parameter is forwarded. This is inconsistent with other delegation methods (sendKeys, sendControlKeys, isAlive, pasteContent) which all have dedicated tests in `tmux-connector.test.ts`.
- Fix: Add a test to `tmux-connector.test.ts` or `wait-for-ready.test.ts`:
```typescript
it('capturePaneContent delegates to sessionManager and forwards lines param', () => {
  const { connector, sessionManager } = makeConnectorWithCapture(['some content']);
  const handle = makeHandle();
  const result = connector.capturePaneContent(handle, 20);
  expect(result.ok).toBe(true);
  expect(sessionManager.capturePaneContent).toHaveBeenCalledWith('beat-task-test', 20);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**isAlive error path treated as session death without test coverage** - `src/implementations/tmux/tmux-connector.ts:416`
**Confidence**: 80%
- Problem: The `waitForReady` implementation treats an `isAlive` error (`!aliveResult.ok`) the same as a dead session (`!aliveResult.value`). This is a reasonable design choice (fail-safe), but there is no test that exercises the `isAlive` returning an error (as opposed to returning `ok(false)`). The `makeConnectorWithCapture` helper only allows boolean values for `isAliveValues`, not errors.
- Fix: Add a test and extend the helper:
```typescript
it('returns err() when isAlive returns an error', async () => {
  // Extend makeConnectorWithCapture to accept Result values for isAlive,
  // or create a targeted test with a custom sessionManager mock.
  const { connector } = makeConnectorWithCaptureAndAliveErrors(
    ['short'],
    [new Error('tmux has-session failed')]
  );
  const handle = makeHandle();
  const promise = connector.waitForReady(handle, {
    initialDelayMs: 0, pollIntervalMs: 10, maxAttempts: 5, contentThreshold: 50,
  });
  await vi.advanceTimersByTimeAsync(10);
  const result = await promise;
  expect(result.ok).toBe(false);
});
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **No test for concurrent waitForReady calls on the same handle** - `tests/unit/implementations/tmux/wait-for-ready.test.ts` (Confidence: 65%) -- In production, if two callers accidentally invoke waitForReady on the same handle concurrently, the interleaved isAlive/capturePaneContent calls could produce surprising results. The current implementation does not guard against this, and there is no test documenting the behavior. Low priority since the callers (worker pool, orchestrate-interactive) each call it once per spawn.

- **makeConnectorWithCapture helper duplicates helper functions from tmux-connector.test.ts** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:22-68` (Confidence: 62%) -- `makeLogger()`, `makeDefaultFsDeps()`, `makeValidValidator()`, and `makeValidHooks()` are near-identical to helpers in `tmux-connector.test.ts`. Extracting a shared test helper module would reduce maintenance burden, but this is a style preference and not blocking.

- **No integration-level test for waitForReady failure path in EventDrivenWorkerPool** - `tests/unit/implementations/event-driven-worker-pool.test.ts` (Confidence: 70%) -- The worker pool's `launchAndRegister` now awaits `waitForReady` and has a failure path that calls `cleanupWorkerState` + `destroySessionWithWarning`. The mock in `mocks.ts` always returns `ok(undefined)`, so the worker pool tests never exercise the error branch (lines 717-727 of event-driven-worker-pool.ts). A targeted test with `waitForReady` mocked to return `err()` would verify the rollback cleanup.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The 11 new tests are well-structured, use fake timers correctly (avoids PF-006-style flakiness), follow AAA pattern, and cover the core happy paths and key edge cases (timeout, session death, whitespace, capture errors, default options). The helper `makeConnectorWithCapture` is a clean test double builder that controls both capture content and liveness sequences.

The two HIGH blocking issues are:
1. The multi-poll success test lacks verification that polling actually occurred multiple times -- it could silently pass with a broken threshold check.
2. The new `capturePaneContent` public port method has no direct unit test, which is inconsistent with the project's pattern of testing each delegation method individually.

The MEDIUM should-fix (isAlive error path) is a coverage gap in a defensive code branch that currently has no test exercising it.

Applies ADR-004 (prompt delivery via pasteContent + sendControlKeys) -- the tests correctly test the readiness gate that precedes this delivery pattern.
