# Architecture Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Synthetic TmuxSpawnConfig in prepareForReuse uses dummy fields that bypass type safety** - `src/implementations/tmux/tmux-connector.ts:370-378`
**Confidence**: 82%
- Problem: `prepareForReuse()` constructs a synthetic `TmuxSpawnConfig` with `command: ''`, `agentArgs: []`, and `agent: 'claude' as const` to satisfy `buildActiveSession()`. While the comment documents that these fields are not used by `buildActiveSession`, this creates a coupling risk: any future change to `buildActiveSession` that reads `command`, `agentArgs`, or `agent` would silently receive bogus values. The `as const` cast also suppresses the type system's ability to catch this mismatch.
- Fix: Extract the subset of fields `buildActiveSession` actually needs into a narrower parameter type (e.g. `BuildActiveSessionConfig` with only `taskId`, `sessionsDir`, `staleness?`, `persistent?`). This makes the contract explicit and removes the need for dummy values:
  ```typescript
  interface BuildActiveSessionConfig {
    readonly taskId: TaskId;
    readonly sessionsDir: string;
    readonly staleness?: Partial<StalenessConfig>;
    readonly persistent?: boolean;
  }
  ```

### MEDIUM

**Stop hook script does not validate SESSIONS_DIR in the early-exit (empty RESPONSE) path** - `scripts/autobeat-stop-hook.sh:24-35`
**Confidence**: 84%
- Problem: Lines 24-35 handle the case where no RESPONSE is extracted. In this path, `SESSIONS_DIR` and `CURRENT_TASK_ID` are used to write a `.exit` sentinel. However, unlike the main path (line 43, 48), this early-exit path does NOT validate `CURRENT_TASK_ID` against `^[a-z0-9][a-z0-9_-]*$` and does NOT validate `SESSIONS_DIR` for path traversal (`..`). This means a malformed task ID or sessions dir could write a sentinel to an unexpected location.
- Fix: Move the validation checks before both code paths or duplicate them in the early-exit block:
  ```bash
  if [ -z "$RESPONSE" ]; then
    TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
    CURRENT_TASK_ID=$(tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
    [ -z "$CURRENT_TASK_ID" ] && CURRENT_TASK_ID="${AUTOBEAT_TASK_ID:-}"
    SESSIONS_DIR="${AUTOBEAT_SESSIONS_DIR:-}"
    # Add validation
    [[ "$CURRENT_TASK_ID" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 0
    [[ "$SESSIONS_DIR" =~ \.\. ]] && exit 0
    if [ -n "$CURRENT_TASK_ID" ] && [ -n "$SESSIONS_DIR" ]; then
      ...
    fi
    exit 0
  fi
  ```

**Old task directory not cleaned when session is parked — relies on deferred comment but no mechanism** - `src/implementations/tmux/tmux-connector.ts:959-961`
**Confidence**: 80%
- Problem: When `triggerExit` parks a persistent session (lines 948-963), the comment at line 960 states "cleanup happens via loggedCleanup on the NEXT iteration's park or when cleanupPersistentSession() is called." However, `prepareForReuse()` (lines 348-406) does NOT call `loggedCleanup` for the old task ID. The only cleanup path is `cleanupPersistentSession()` which is called at loop end — meaning intermediate iteration directories accumulate on disk until the loop finishes. For a loop with 50 iterations, 49 task directories persist simultaneously.
- Fix: Add a `loggedCleanup` call at the start of `prepareForReuse()` for the previous task's directory. The old taskId can be inferred from the existing `activeSessions` entry (if present) or passed explicitly. Alternatively, document this as intentional (output must remain readable for dashboard/output-repository until loop end) and add a bulk cleanup at loop completion. Either way, the comment at line 960 is inaccurate about "NEXT iteration's park" — that doesn't happen.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`if (prompt)` guard in launchAndRegister is now dead code** - `src/implementations/event-driven-worker-pool.ts:658`
**Confidence**: 85%
- Problem: The comment at line 656-657 correctly states "prompt is never empty for a fresh spawn." Since the wrapper pipeline has been removed and all sessions use interactive mode, `prompt` will always be truthy. The `if (prompt)` guard is now dead code that suggests an optional path still exists, which is confusing to future readers.
- Fix: Remove the `if (prompt)` conditional and always execute `sendKeys`. Add an assertion if desired:
  ```typescript
  // All sessions use interactive mode — prompt is always present.
  const sendResult = this.tmuxConnector.sendKeys(handle, prompt + '\n');
  ```

**`persistent` parameter accepted but documented as having "no effect" — confusing API surface** - `src/implementations/base-agent-adapter.ts:99-102`
**Confidence**: 80%
- Problem: The JSDoc on `buildTmuxCommand` states `persistent` is "accepted for backward compatibility but has no effect." However, the code at line 248 still reads `persistent: !!psk` in `event-driven-worker-pool.ts` and passes it through to `TmuxConnector.spawn()` where it IS used (it sets `session.persistent = true` at line 498 of tmux-connector.ts). The adapter's JSDoc is misleading — `persistent` still has architectural significance at the connector level; it's only meaningless for the adapter's arg-building decision.
- Fix: Update the JSDoc to clarify that `persistent` no longer affects adapter arg building (all sessions are interactive) but is still passed through for connector-level session lifecycle semantics:
  ```typescript
  * The `persistent` flag no longer affects arg building (all sessions use interactive mode)
  * but is forwarded to TmuxConnector where it controls session lifecycle: persistent sessions
  * are parked rather than destroyed after sentinel detection.
  ```

## Pre-existing Issues (Not Blocking)

(none identified at CRITICAL level in unchanged code)

## Suggestions (Lower Confidence)

- **`SessionState` type could be a const enum for exhaustive checking** - `src/implementations/tmux/tmux-connector.ts:102` (Confidence: 65%) — The `SessionState` type is a string union used in comparisons throughout the file. Using a const object with `as const` values would enable exhaustive switch/if-else checking at the type level and prevent typos.

- **Stop hook writes non-atomic `.seq` increment** - `scripts/autobeat-stop-hook.sh:56-58` (Confidence: 70%) — `cat "$SEQ_FILE"` then `echo "$SEQ" > "$SEQ_FILE"` is not atomic. If the hook is called concurrently (unlikely but possible with rapid successive Stop triggers), two invocations could read the same seq value. The risk is low because the Stop hook runs once per agent turn, but adding `flock` (on Linux) or accepting potential duplicates should be documented.

- **`void agent` pattern for unused parameter** - `src/cli/commands/init.ts:657` (Confidence: 62%) — `void agent;` is used to suppress the unused-variable warning for the `agent` parameter in `defaultConfigureHooks()`. Consider using `_agent` prefix naming convention instead, which is the TypeScript ecosystem standard and avoids the runtime expression.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architectural changes are well-designed. The removal of the wrapper pipeline is clean: dead code is properly removed, the `SessionState` enum correctly models the three-state lifecycle, and the `prepareForReuse()` method encapsulates connector-internal complexity behind the port boundary (applies ADR-003 pattern — port abstraction over leaked internals). The `TmuxHooksPort.initTaskDirectory()` addition follows ISP — it exposes only what the reuse path needs without coupling to the full setup shim generation.

Conditions for approval:
1. Fix the validation gap in the Stop hook's early-exit path (MEDIUM/Blocking) — this is a security-adjacent issue that should match the main path's rigor.
2. Address the misleading JSDoc about `persistent` having "no effect" (Should Fix) — the wording will cause confusion for contributors.
