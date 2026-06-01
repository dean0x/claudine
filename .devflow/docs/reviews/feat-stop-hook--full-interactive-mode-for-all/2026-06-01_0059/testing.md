# Testing Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01T00:59

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Real `setTimeout` in async test (potential flakiness)** - `tests/unit/implementations/tmux/tmux-connector.test.ts:614`
**Confidence**: 82%
- Problem: The test "messages watcher ignores null filename" uses `await new Promise((r) => setTimeout(r, 100))` with real timers to wait for async settlement. This introduces a timing-dependent assertion that can be flaky under load or CI resource contention.
- Fix: Use `vi.useFakeTimers()` with `vi.advanceTimersByTimeAsync(100)`, or use `vi.waitFor()` with a negative assertion pattern. The rest of the connector tests already demonstrate the fake-timers pattern.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shared mutable `tmpDir` + `afterEach` cleanup in stop-hook test may race on parallel execution** - `tests/integration/tmux/stop-hook.test.ts:49-65`
**Confidence**: 80%
- Problem: The `afterEach` hook iterates `tmpDir` entries and deletes them. Each test creates uniquely-named subdirectories, so concurrent tests (if pool mode changes in the future) could interfere. Currently safe because vitest config uses `maxWorkers: 1`, but the test does not document this dependency.
- Fix: Add a brief comment noting the sequential execution dependency, or use per-test temp directories via `fs.mkdtempSync` instead of cleaning a shared root. Given the project's documented sequential vitest config, a comment is sufficient:
```typescript
// NOTE: Safe because vitest runs with maxWorkers: 1 (see vitest.config.ts)
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing coverage: `destroy()` on a session where `destroySession` fails returns err and keeps session tracked for retry** - `src/implementations/tmux/tmux-connector.ts:317-326` (Confidence: 70%) -- The destroy failure path logs and keeps the session; no unit test exercises this recovery-retry scenario for the new code paths.

- **Integration test does not verify hook stderr output on path-traversal rejection** - `tests/integration/tmux/stop-hook.test.ts:536-598` (Confidence: 65%) -- The security tests assert no files are created but do not check stderr for diagnostic messages that operators might rely on for audit logging.

- **Worker pool reuse tests use dynamic imports for error construction** - `tests/unit/implementations/event-driven-worker-pool.test.ts:1341-1346` (Confidence: 62%) -- The `await import(...)` inside a `mockReturnValueOnce` call is unusual and harder to read than importing at the top of the file. Not incorrect but deviates from the test file's established pattern of using the already-imported `AutobeatError` and `ErrorCode`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Assessment

This PR delivers an exceptionally well-structured test suite. Key strengths:

1. **Comprehensive behavior coverage**: The new `stop-hook.test.ts` (927 lines) exercises the bash script end-to-end with real filesystem operations and real bash execution. It covers guard behavior, both Codex and Claude extraction paths, the isOutputMessage contract, special characters, sequence numbering, sentinel mapping, security (path traversal), atomic writes, fail-fast on empty response, usage capture, jq unavailability, and transcript string-content branches.

2. **State machine testing**: The `tmux-connector.test.ts` additions (421 new lines) thoroughly cover the new `SessionState` enum transitions (`active` -> `parked` -> reuse), `prepareForReuse()` contract, staleness timer skip for parked sessions, and the parked-session destroy path (session-orphan regression test).

3. **Protocol ordering tests**: The Phase B worker pool tests verify the critical ordering invariant (setEnvironment -> /clear -> prepareForReuse -> sendKeys) using call-order tracking, plus failure fallback paths.

4. **Removed dead tests correctly**: The deleted `hook-script-generation.test.ts` (348 lines) was for the old wrapper pipeline; the new `stop-hook.test.ts` replaces it with direct integration tests against the actual bash script. The `tmux-hooks.test.ts` removed ~250 lines of `generateWrapper()` tests and added targeted `initTaskDirectory()` tests plus retained `generateSetupShim()` and `cleanup()` coverage.

5. **Mock fixture updated**: `prepareForReuse` added to `MockTmuxConnector`, maintaining interface parity.

The only blocking issue is a minor flakiness risk from a real timer in one test. The prior cycle's resolution (22 issues resolved, including 6 usage regression tests) is reflected in the usage capture test section of stop-hook.test.ts. No regressions from resolved issues detected.
