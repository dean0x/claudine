# Security Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04

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

(none above 60% threshold)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

This PR adds a `waitForReady()` polling mechanism that checks `capturePaneContent` (tmux `capture-pane`) until the TUI has rendered enough content before delivering the user's prompt via `pasteContent` + `sendControlKeys('Enter')`. The change touches the tmux connector, worker pool, interactive orchestrator spawn path, recovery manager (formatting only), and test fixtures.

### Security-Relevant Observations

1. **No new trust boundary crossings.** The `waitForReady()` method polls `capturePaneContent` (which delegates to `tmux capture-pane -p`), a read-only tmux operation on sessions this process already owns. No user input flows into the `capturePaneContent` call -- the session name comes from the spawn path, which is validated against `SESSION_NAME_REGEX` by the session manager (applies ADR-001). No injection vector exists.

2. **No secrets in pane content.** `capturePaneContent` captures visible terminal output for readiness detection (character count threshold). The captured content is never persisted, logged, or returned to callers -- only `trim().length` is computed. Even if the TUI rendered sensitive data during initialization, it would not leak through this path.

3. **No new shell command construction.** The diff adds no new `spawnSync`, `exec`, or string-interpolated shell commands. All tmux interactions go through the existing `TmuxSessionManagerPort` interface which uses parameterized arguments (session name validated against regex, no user-controlled strings in command construction).

4. **Timeout behavior is safe.** `waitForReady()` has a bounded poll loop (`maxAttempts`, default 20) and returns `ok(undefined)` on exhaustion (best-effort proceed). This prevents denial-of-service from a hung TUI blocking the spawn path indefinitely. The upper bound is `initialDelayMs + maxAttempts * pollIntervalMs` = 1500 + 20*500 = 11.5s with defaults, which is reasonable.

5. **Error handling is clean.** Session death during polling returns `err()` immediately, and the caller (`launchAndRegister` in worker pool, `spawnAndDeliverPrompt` in interactive orchestrator) handles the error by cleaning up worker state and destroying the session handle (avoids PF-004 multi-layer rollback pattern -- all three layers are addressed: worker state cleanup, session destruction, and error propagation).

6. **Mock fixtures updated correctly.** `createMockTmuxConnector` and `createMockTmuxSessionManagerCore` now include `capturePaneContent` and `waitForReady` stubs, preventing test regressions where missing mock methods would cause runtime errors or silent undefined returns.

7. **Session reuse path intentionally skips waitForReady.** The code documents (with an `applies ADR-004` citation) that persistent session reuse does not call `waitForReady()` because the TUI input handler is already initialized. This is correct -- the security concern would be the reverse: adding unnecessary delay that creates a wider window for race conditions during session reuse.

No security vulnerabilities, injection vectors, authentication/authorization gaps, or sensitive data exposure were identified in the changed code.
