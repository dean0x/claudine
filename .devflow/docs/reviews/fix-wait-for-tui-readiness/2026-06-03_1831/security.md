# Security Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03T18:31

## Issues in Your Changes (BLOCKING)

_No blocking security issues found._

## Issues in Code You Touched (Should Fix)

_No should-fix security issues found._

## Pre-existing Issues (Not Blocking)

_No critical pre-existing security issues found in the reviewed files._

## Suggestions (Lower Confidence)

_No suggestions above the 60% confidence threshold._

## Analysis Notes

### What Was Reviewed

The PR adds `waitForReady()` polling to `TmuxConnectorPort` that checks `capturePaneContent` until the TUI has rendered enough content (>= 50 chars), then proceeds with prompt delivery. The changes span:

- `src/core/tmux-types.ts` -- New `WaitForReadyOptions` interface and `capturePaneContent`/`waitForReady` on `TmuxConnectorPort`
- `src/implementations/tmux/tmux-connector.ts` -- `capturePaneContent()` delegation and `waitForReady()` implementation
- `src/implementations/event-driven-worker-pool.ts` -- `launchAndRegister()` converted to async; `waitForReady` inserted between flushing and prompt delivery
- `src/cli/commands/orchestrate-interactive.ts` -- `waitForReady` inserted between spawn and prompt delivery
- `src/services/recovery-manager.ts` -- Line-length reformatting only (no logic change)
- `tests/fixtures/mocks.ts` -- Mock stubs for new port methods
- `tests/unit/implementations/tmux/wait-for-ready.test.ts` -- 11 new unit tests

### Security Checks Performed

1. **Command Injection via capturePaneContent (OWASP A03)** -- The `capturePaneContent` implementation in `tmux-session-manager.ts:460` interpolates the session name into a shell command: `` tmux capture-pane -t '${name}' -p -S -${lines} ``. Both inputs are validated:
   - `name` is validated by `validateSessionName()` against `SESSION_NAME_REGEX = /^beat-[a-z0-9-]+$/` -- no shell metacharacters possible (applies ADR-001).
   - `lines` is validated as a positive integer <= MAX_CAPTURE_LINES.
   - **Verdict**: Safe. No injection vector.

2. **Denial of Service via polling loop (OWASP A04)** -- `waitForReady()` has a bounded `maxAttempts` (default: 20) with a `for` loop that terminates after exhausting attempts, consistent with the project's reliability principle (every loop has a fixed upper bound). The total maximum wait is `initialDelayMs + maxAttempts * pollIntervalMs` = 1500 + 20*500 = 11.5s with defaults. On timeout, it returns `ok(undefined)` (best-effort proceed) rather than blocking indefinitely. **Verdict**: Safe. No unbounded loop or resource exhaustion.

3. **Session Name Leakage in Error Messages** -- Error messages from `waitForReady` include the tmux session name (e.g., `session 'beat-task-xxx' died during TUI initialization`). Session names are auto-generated with format `beat-[a-z0-9-]+` and do not contain user secrets. **Verdict**: Acceptable.

4. **Race Condition: Worker registered but session dead (OWASP A04)** -- If the session dies between `startFlushing` (Step 9) and `waitForReady` completing (Step 9b), the code correctly calls `cleanupWorkerState` + `destroySessionWithWarning` and returns `err()`. The caller does not proceed with prompt delivery. **Verdict**: Properly handled.

5. **No New Trust Boundaries** -- `waitForReady` does not introduce new external inputs. The `WaitForReadyOptions` interface is only called with defaults at both call sites (`event-driven-worker-pool.ts:716` and `orchestrate-interactive.ts:267`). No user-supplied values reach the options. **Verdict**: No new attack surface.

6. **No Secrets/Credentials** -- No hardcoded secrets, tokens, API keys, or credentials introduced. **Verdict**: Clean.

7. **Prompt Delivery via pasteContent (applies ADR-004)** -- The prompt delivery mechanism remains `pasteContent + sendControlKeys('Enter')`, consistent with ADR-004. The `waitForReady()` addition does not alter the delivery mechanism, only adds a readiness gate before it.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

The PR introduces a well-bounded polling mechanism with proper session name validation at the shell boundary, bounded loop iterations, graceful error handling on session death, and no new trust boundaries or user-controllable inputs. The existing `SESSION_NAME_REGEX` validation (applies ADR-001) and `lines` bounds checking in `capturePaneContent` prevent command injection. All polling has explicit upper bounds, satisfying the project's reliability requirements.
