# Testing Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Real `setTimeout` in async test assertion — potential flakiness** - `tests/unit/implementations/tmux/tmux-connector.test.ts:2859-2866`
**Confidence**: 82%
- Problem: The `prepareForReuse` test at line 2859 uses a real `setTimeout` inside a `new Promise()` wrapper to wait for async message delivery. Unlike other tests in this file that use `vi.waitFor()` or `sleep()` from fixtures, this test creates a raw setTimeout with 100ms. Since the file uses `vi.useFakeTimers()` in some describe blocks but not this one, the real timer will work — but the pattern is inconsistent with the rest of the file and could become flaky under CI load.
- Fix: Replace with the `vi.waitFor()` pattern used elsewhere in this file:
```typescript
// Instead of:
return new Promise<void>((resolve) => {
  setTimeout(() => {
    expect(newOnOutput).toHaveBeenCalledWith(...);
    resolve();
  }, 100);
});

// Use:
await vi.waitFor(() => expect(newOnOutput).toHaveBeenCalledWith(
  expect.objectContaining({ sequence: 1, type: 'result', content: 'hello' }),
), { timeout: 300 });
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing test for `prepareForReuse` on non-parked session** - `tests/unit/implementations/tmux/tmux-connector.test.ts:2690` (Confidence: 72%) — The test suite covers `prepareForReuse` after parking and after `initTaskDirectory` failure, but does not test calling `prepareForReuse` on a session that is still in `active` state (should it be rejected or silently succeed?). The implementation has a guard for duplicate taskId but not for non-parked state.

- **Integration test `stop-hook.test.ts` relies on `process.env` spreading** - `tests/integration/tmux/stop-hook.test.ts:78` (Confidence: 65%) — The `runHook()` helper filters and spreads `process.env` which is fine, but the `PATH` from the test environment leaks into the hook execution. If a CI runner has a minimal PATH that excludes `jq` or `date`, some tests could fail with misleading errors. This is mitigated by the test not requiring `jq` (the hook uses only bash builtins and `date`).

- **No negative test for `configureAgentHook` with missing parent directory** - `tests/unit/cli-init.test.ts:711` (Confidence: 64%) — The `configureAgentHook` test suite verifies creation, merge, idempotency, backup, and invalid JSON, but does not test the case where the config file's parent directory does not exist (e.g., `~/.claude/` not present). The `ensureDir` dep should handle this, but the behavior when it fails is untested.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Assessment

The test suite for this PR is thorough and well-structured. Key strengths:

1. **Comprehensive behavioral coverage**: The stop-hook integration tests cover syntax validation, guard behavior, both agent paths (Codex/Claude), contract validation, special characters, sequence numbering, sentinel mapping, security (path traversal), atomicity, and fail-fast — 29 tests with real filesystem and bash execution.

2. **Proper test architecture**: Tests use dependency injection throughout (no `vi.mock()` in the unit tests for `cli-init.test.ts`). The `HookConfigDeps` interface enables real filesystem testing with tmpdir isolation.

3. **Regression coverage**: The worker pool tests include explicit regression tests for known bugs (B1-1 through B1-5, timer leaks, stale closures) — these are labeled and documented.

4. **State machine testing**: The SessionState enum (active/parked/exited) is tested at both the connector level (persistent=true parks, persistent=false destroys, staleness skips parked) and the worker pool level (prepareForReuse ordering, fallback on failure).

5. **Deleted wrapper tests replaced**: The 348-line `hook-script-generation.test.ts` (testing the removed wrapper pipeline) is properly deleted. Its behavioral coverage is replaced by the 651-line `stop-hook.test.ts` that tests the new unified hook script with real bash execution.

6. **Mock fixture updated**: `createMockTmuxConnector` properly includes `prepareForReuse: vi.fn()` so all consumer tests compile and can exercise the new method.

The single blocking item is minor (inconsistent async test pattern) and does not affect correctness today, but could cause flakiness under CI pressure.
