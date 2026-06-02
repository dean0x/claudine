# Consistency Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Stale comment references `session.exited` boolean after migration to `SessionState` enum** - `src/implementations/tmux/tmux-connector.ts:526-530`
**Confidence**: 95%
- Problem: The sentinel watcher inline comment still references `session.exited` (the old boolean field) and `sets session.exited = true`. The actual code now uses `session.state !== 'active'` and `session.state = 'parked'|'exited'`. This documentation drift makes the comment misleading for readers.
- Fix: Update the comment to match the new state machine:
```typescript
// No debounce needed here: handleSentinel() reads session.state
// synchronously at the top of the event-loop tick. Because
// triggerExit() sets session.state to 'parked' or 'exited' before
// returning, any platform double-fire of the same sentinel file is
// a no-op — the second callback sees state !== 'active' and returns
// immediately.
```

---

**Misleading JSDoc: `persistent` "has no effect" in `buildTmuxCommand` contradicts actual usage** - `src/implementations/base-agent-adapter.ts:99-102`
**Confidence**: 82%
- Problem: The JSDoc states "The `persistent` option is accepted for backward compatibility but has no effect". While true that `buildTmuxCommand` itself ignores the option (it no longer branches on it), the option is still consumed by the caller (`EventDrivenWorkerPool.spawn()` at line 276: `psk ? { ...config, persistent: true } : config`). The comment implies the option is vestigial, when in reality it is actively used for session lifecycle management. A reader encountering the option might remove it based on this comment.
- Fix: Clarify the comment to distinguish adapter-level behavior from caller-level behavior:
```typescript
* DECISION: Wrapper pipeline mode (--print/--quiet based) has been removed.
* All tmux sessions are interactive; output is captured via the Stop hook.
* The `persistent` option no longer affects CLI arg generation (all sessions
* use the interactive path), but it is still passed through to
* TmuxSpawnCoreConfig by the caller for session lifecycle control
* (park vs destroy on sentinel).
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Duplicated tmux session + task ID resolution block in stop hook** - `scripts/autobeat-stop-hook.sh:24-28` and `scripts/autobeat-stop-hook.sh:38-41`
**Confidence**: 85%
- Problem: Lines 24-28 (the empty-response early-exit path) duplicate the session/task-ID resolution logic from lines 38-41 (the main path). Both blocks call `tmux display-message`, `tmux show-environment`, and fall back to `$AUTOBEAT_TASK_ID`. This violates DRY and creates a maintenance risk — if the resolution logic needs updating, both blocks must be changed in lockstep.
- Fix: Extract the tmux session + task ID resolution into a function at the top of the script:
```bash
resolve_task_id() {
  local session
  session=$(tmux display-message -p '#{session_name}' 2>/dev/null)
  local task_id
  task_id=$(tmux show-environment -t "$session" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
  [ -z "$task_id" ] && task_id="${AUTOBEAT_TASK_ID:-}"
  echo "$task_id"
}
```

---

**Missing TASK_ID validation on early-exit path in stop hook** - `scripts/autobeat-stop-hook.sh:24-35`
**Confidence**: 90%
- Problem: The early-exit path (when `$RESPONSE` is empty) resolves `CURRENT_TASK_ID` and writes a `.exit` sentinel without validating the task ID against the regex (`^[a-z0-9][a-z0-9_-]*$`) or checking `SESSIONS_DIR` for path traversal (`..`). The main path (lines 43-48) has these validation checks. This inconsistency means a malformed task ID or hostile sessions dir could write to an arbitrary path on the early-exit path.
- Fix: Move the validation guards (lines 43, 46, 48) to run before any sentinel write, or refactor both paths to share a common validated-write function.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`HookConfigResult.alreadyPresent` field is never populated** - `src/cli/commands/init.ts:62-75` (Confidence: 65%) — The `HookConfigResult` type declares an `alreadyPresent?: boolean` field in the success variant, but `configureAgentHook` returns the same `ok(undefined)` for both idempotent (already present) and fresh configuration. The caller (`defaultConfigureHooks`) never receives this signal. Either populate the field or remove it from the type.

- **`void agent` suppression in `defaultConfigureHooks`** - `src/cli/commands/init.ts:657` (Confidence: 60%) — The `void agent` statement with the comment "agent param is for future extensibility" is an unusual pattern in this codebase where unused params typically use the `_` prefix convention (seen in `_path`, `_jsonSchema`, `_eventType`, `_taskId` throughout). Using `_agent` would be more consistent.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong overall consistency:
- Pattern migration from `exited: boolean` to `SessionState` enum is applied uniformly across all guard checks in the connector.
- The wrapper pipeline removal is complete — no stale imports, no dead `WrapperConfig`/`WrapperManifest` types remain in source.
- `SpawnCallbacks` moved to `core/tmux-types.ts` with proper re-export from `tmux/types.ts` — import graph is clean.
- New `prepareForReuse()` port method follows the existing port pattern (`Result<void, AutobeatError>` return, JSDoc with DESIGN DECISION annotation, tested via mock fixture).
- Adapter simplification is symmetric: both Claude and Codex adapters removed `buildWrapperFlags`, `buildArgs`, and `buildInteractiveArgs` identically.
- `configureAgentHook` follows the project's Result-type error handling pattern.
- The stop hook validates task IDs against the same regex as `TASK_ID_REGEX` in TypeScript.

The blocking conditions are two stale/misleading comments that should be updated before merge to prevent documentation drift (applies ADR-002 reasoning: explicit documentation prevents future re-raising). The should-fix items strengthen the stop hook's validation consistency.
