# Reliability Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### HIGH

**Parked persistent session orphaned on loop cleanup** - `src/implementations/event-driven-worker-pool.ts:699` / `src/implementations/tmux/tmux-connector.ts:266-268`
**Confidence**: 92%
- Problem: When a persistent session is parked by `triggerExit()` (line 966 of tmux-connector.ts), it is removed from `activeSessions` under the current taskId. The `PersistentSessionEntry.handle` retains the ORIGINAL first-iteration taskId (declared `readonly` at line 123 of worker pool). When `cleanupPersistentSession()` later calls `destroy(entry.handle)`, `destroy()` looks up `activeSessions.get(handle.taskId)` at line 267 -- this returns `undefined` because the first iteration's taskId was deleted from `activeSessions` during parking. `destroy()` early-returns with `ok(undefined)` at line 268 without ever calling `destroySession(handle.sessionName)`. The tmux session process remains alive, orphaned.
  - This affects every loop that runs 2+ iterations with persistent sessions: the tmux session is never killed on loop completion.
  - `dispose()` on the connector also cannot catch it -- parked sessions are not in `activeSessions`.
- Fix: In `cleanupPersistentSession`, bypass the `destroy()` method (which requires activeSessions lookup) and call `destroySession` directly by session name:

```typescript
cleanupPersistentSession(key: string): void {
  const entry = this.persistentSessions.get(key);
  if (!entry) return;
  this.persistentSessions.delete(key);

  // Destroy by session name — the session may be parked (not in
  // connector's activeSessions) but the tmux process is still alive.
  // Use the connector's destroy() first (handles flush/cleanup if tracked),
  // then fall through to direct sessionManager.destroySession() as a
  // safety net for the parked-session case.
  const destroyResult = this.tmuxConnector.destroy(entry.handle);
  if (!destroyResult.ok) {
    this.logger.warn('Failed to destroy persistent session during cleanup', {
      persistentSessionKey: key,
      sessionName: entry.handle.sessionName,
      error: destroyResult.error.message,
    });
  }

  // Alternatively, add a destroyByName() method on TmuxConnectorPort that
  // calls destroySession(sessionName) directly, or have destroy() fall
  // through to destroySession even when the session is not in activeSessions.
}
```

  A cleaner fix would be to update `TmuxConnector.destroy()` to call `destroySession` even when the session is not tracked in activeSessions (since the session name on the handle is still valid):

```typescript
destroy(handle: TmuxHandle): Result<void, AutobeatError> {
  const session = this.activeSessions.get(handle.taskId);
  if (!session) {
    // Session not tracked (may be parked) — still try to kill the tmux process
    const result = this.deps.sessionManager.destroySession(handle.sessionName);
    this.loggedCleanup('destroy', handle.taskId, handle.sessionsDir);
    return result.ok ? ok(undefined) : result;
  }
  // ... existing tracked-session cleanup path ...
}
```

**Stop hook: no sentinel written when jq fails on main path** - `scripts/autobeat-stop-hook.sh:68-78`
**Confidence**: 82%
- Problem: If `jq -Rs .` fails at line 68 (e.g., jq OOM on a very large `$RESPONSE`), `ESCAPED` is empty and the `printf` at line 76 writes malformed JSON to the message file. The `mv` at line 78 succeeds, so the message file exists but is corrupt. The sentinel (.done/.exit) is still written at lines 82-88, so the session exits. However, the corrupt message file will cause `parseMessageFile` in the connector to log a warning and skip delivery -- the last assistant message is silently lost with no indication in the sentinel exit code.
  - The old wrapper script had a `_sentinel_guard` trap that wrote `.exit` on any unexpected failure. The new Stop hook has no equivalent trap.
- Fix: Add an ERR trap that writes `.exit` on unexpected failures, and validate `ESCAPED` before writing:

```bash
# After line 38 (SESSIONS_DIR validation):
_emergency_exit() {
  local _ec=$?
  if [ -n "${TASK_DIR:-}" ]; then
    echo "$_ec" > "$TASK_DIR/.exit.tmp" 2>/dev/null
    mv "$TASK_DIR/.exit.tmp" "$TASK_DIR/.exit" 2>/dev/null || true
  fi
}
trap _emergency_exit ERR

# At line 68, validate ESCAPED:
if [ "$RESPONSE_FROM_DIRECT" = "true" ]; then
  ESCAPED=$(printf '%s' "$RESPONSE" | jq -Rs .)
  if [ -z "$ESCAPED" ]; then
    ESCAPED='""'
  fi
else
  ...
```

### MEDIUM

**Stop hook: `ensureDir` failure in `configureAgentHook` is unguarded** - `src/cli/commands/init.ts:135`
**Confidence**: 84%
- Problem: `deps.ensureDir(configDir)` at line 135 can throw (permission denied, disk full), but it is not wrapped in a try/catch. The error propagates as an unhandled exception. All other disk operations in `configureAgentHook` are properly guarded with try/catch and return `err()`.
- Fix: Wrap in try/catch like the other disk operations:

```typescript
try {
  deps.ensureDir(configDir);
} catch (e) {
  return err(`Failed to create ${agentType} config directory: ${e instanceof Error ? e.message : String(e)}`);
}
```

**Stop hook: `configureAgentHook` orphaned `.tmp` cleanup writes empty file instead of deleting** - `src/cli/commands/init.ts:214-215`
**Confidence**: 80%
- Problem: On rename failure, the cleanup at line 214 writes an empty string to the `.tmp` file rather than deleting it. The `HookConfigDeps` interface has no `deleteFile` method. While this is noted in a comment, an empty `.tmp` file left on disk could confuse subsequent runs or cause confusion during debugging.
- Fix: Add a `deleteFile` method to `HookConfigDeps` (using `unlinkSync`) and use it for cleanup. Alternatively, accept the minor cosmetic issue since the `.tmp` file is harmless.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`prepareForReuse` synthetic config uses hardcoded `'claude'` agent type** - `src/implementations/tmux/tmux-connector.ts:381`
**Confidence**: 85%
- Problem: The synthetic config at line 381 hardcodes `agent: 'claude' as const`. While the comment at lines 367-374 explains that `agent` is not read by `buildActiveSession`, this is fragile -- if `buildActiveSession` ever starts reading `agent` (e.g., for agent-specific staleness thresholds), the hardcoded value would produce incorrect behavior for Codex sessions. The original session's agent type is available on the handle's associated state but not passed through.
- Fix: Store the original `agent` type on the `ActiveSession` interface (or pass it through the `TmuxHandle`) so `prepareForReuse` can use the correct value. If that is too invasive, add a defensive assertion comment documenting that `agent` is intentionally unused and must remain so.

## Pre-existing Issues (Not Blocking)

No pre-existing reliability issues detected in the reviewed files.

## Suggestions (Lower Confidence)

- **Stop hook: `tail -n 50` transcript lines could be individually large** - `scripts/autobeat-stop-hook.sh:19` (Confidence: 65%) -- Each JSONL transcript line is a complete JSON object (potentially megabytes for long assistant messages). While 50 lines is bounded, `jq -s` loads all of them into memory at once. Consider adding `head -c` after `tail` to cap total bytes read from the transcript.

- **`prepareForReuse` does not inherit staleness config from original session** - `src/implementations/tmux/tmux-connector.ts:375-383` (Confidence: 70%) -- The synthetic config has no `staleness` field, so `buildActiveSession` falls back to `DEFAULT_STALENESS_CONFIG`. If the original session was spawned with custom staleness thresholds, the reused session reverts to defaults. This may not matter in practice since persistent sessions all use default config, but it is a silent behavior change if custom configs are ever used.

- **No bounded retry on `tmux show-environment` failure in Stop hook** - `scripts/autobeat-stop-hook.sh:30` (Confidence: 62%) -- If `tmux show-environment` fails (tmux server unresponsive), the hook falls back to `AUTOBEAT_TASK_ID` env var, which is the correct behavior. However, there is no logging of the fallback -- diagnosing output attribution issues in production would be difficult without it. (Shell hooks cannot easily log, so this may be acceptable.)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The persistent session orphan leak (HIGH) is the primary concern -- every loop with 2+ iterations will leave a tmux process alive after loop completion. The `destroy()` early-return when a session is not in `activeSessions` is the root cause; the fix is straightforward (fall through to `destroySession` by session name). The Stop hook's missing ERR trap (HIGH) removes a safety net that the old wrapper script had; adding it back is a small change with high defensive value. The two MEDIUM issues (unguarded `ensureDir` throw, hardcoded agent type) are lower risk but should be addressed for consistency with the project's error handling standards.
