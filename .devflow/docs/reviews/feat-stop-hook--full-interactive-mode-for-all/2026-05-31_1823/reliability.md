# Reliability Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### HIGH

**configureAgentHook can throw instead of returning Result** - `src/cli/commands/init.ts:201-202`
**Confidence**: 92%
- Problem: `configureAgentHook` declares `Result<void, string>` return type but calls `deps.writeFile(tmpPath, content)` and `deps.renameFile(tmpPath, configPath)` without try/catch. The production implementations (`writeFileSync`, `renameSync`) can throw on disk errors (permissions, ENOSPC, EROFS). An uncaught throw propagates through `defaultConfigureHooks` and `runHookConfigure` (neither wraps in try/catch), crashing the entire `runInit` flow despite the JSDoc promise that "Hook config failures are non-fatal."
- Fix: Wrap lines 201-202 in try/catch and return `err()` on failure:
```typescript
  try {
    deps.writeFile(tmpPath, content);
    deps.renameFile(tmpPath, configPath);
  } catch (e) {
    return err(`Failed to write ${agentType} config: ${e instanceof Error ? e.message : String(e)}`);
  }
```

**Stop hook .seq read-increment-write is not atomic** - `scripts/autobeat-stop-hook.sh:56-58`
**Confidence**: 82%
- Problem: The sequence counter is read (`cat`), incremented in bash, and written back without any locking mechanism. If two Stop hook invocations fire concurrently for the same task (possible when the agent produces rapid successive outputs that each trigger a stop event), both read the same `.seq` value, produce the same sequence number, and one message file overwrites the other.
- Impact: Message loss via filename collision. The `mv` on line 72 would overwrite an existing message with the same padded sequence.
- Mitigating factor: In practice, Claude Code's Stop hook fires once per turn (synchronous hook invocation model), so concurrent invocations for the same task are unlikely under normal operation. However, this is an implicit assumption — not enforced.
- Fix: Use `flock` with a fallback, or use a unique suffix (PID + timestamp) to prevent collision:
```bash
SEQ=$(cat "$SEQ_FILE" 2>/dev/null || echo 0)
SEQ=$((SEQ + 1))
echo "$SEQ" > "$SEQ_FILE"
```
Could become:
```bash
# Atomic increment via flock (if available) or fallback to racy path
if command -v flock >/dev/null 2>&1; then
  SEQ=$(flock "$SEQ_FILE.lock" bash -c "SEQ=\$(cat '$SEQ_FILE' 2>/dev/null || echo 0); SEQ=\$((SEQ + 1)); echo \$SEQ > '$SEQ_FILE'; echo \$SEQ")
else
  SEQ=$(cat "$SEQ_FILE" 2>/dev/null || echo 0)
  SEQ=$((SEQ + 1))
  echo "$SEQ" > "$SEQ_FILE"
fi
```
Note: `flock` is not available on macOS without Homebrew. Given the mitigating factor (sequential hook invocation model), this may be acceptable risk. Document the assumption explicitly.

### MEDIUM

**Orphaned .tmp file on rename failure** - `src/cli/commands/init.ts:201-202`
**Confidence**: 83%
- Problem: If `deps.writeFile(tmpPath, content)` succeeds but `deps.renameFile(tmpPath, configPath)` throws (e.g., cross-device rename, permissions), the `.tmp` file is left on disk. The next `configureAgentHook` invocation does not clean up stale `.tmp` files, so it may be confusing to users who inspect their config directory.
- Fix: In the try/catch block suggested above, attempt cleanup of tmpPath on rename failure:
```typescript
  try {
    deps.writeFile(tmpPath, content);
    deps.renameFile(tmpPath, configPath);
  } catch (e) {
    // Best-effort cleanup of orphaned .tmp
    try { if (deps.fileExists(tmpPath)) deps.writeFile(tmpPath, ''); /* or unlink */ } catch { /* ignore */ }
    return err(`Failed to write ${agentType} config: ${e instanceof Error ? e.message : String(e)}`);
  }
```

**prepareForReuse does not clean up task directory on buildActiveSession failure** - `src/implementations/tmux/tmux-connector.ts:380-387`
**Confidence**: 80%
- Problem: `prepareForReuse` calls `initTaskDirectory` (Step 1) which creates the directory, then calls `buildActiveSession` (Step 2). If `buildActiveSession` returns err (invalid staleness config), the newly created task directory is orphaned — there is no cleanup path. The caller (`reuseSession`) calls `cleanupPersistentSession` which destroys the session entirely, but the orphaned directory for `newTaskId` is never removed because `loggedCleanup` is called with the _session handle's_ taskId, not `newTaskId`.
- Impact: Directory leak on disk. Low frequency since staleness config validation failure is unlikely in practice (DEFAULT_STALENESS_CONFIG has valid values).
- Fix: Add cleanup before returning on `buildActiveSession` error:
```typescript
    if (!sessionResult.ok) {
      this.deps.hooks.cleanup(newTaskId, handle.sessionsDir);
      return sessionResult;
    }
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stop hook transcript parsing uses unbounded `tail -n 50` without output size validation** - `scripts/autobeat-stop-hook.sh:15-20`
**Confidence**: 80%
- Problem: The transcript fallback path reads the last 50 lines of a JSONL transcript file into memory, then pipes to `jq -s` (slurp mode) which loads all 50 objects into memory. For normal transcripts this is fine, but if individual transcript lines are very large (multi-MB assistant messages), this could consume significant memory in the hook process. Additionally, there is no guard ensuring `$TRANSCRIPT` is a regular file (it could be a symlink to a large file or a pipe).
- Impact: In degenerate cases, the hook could consume excessive memory or block on a non-file path. Low probability in normal operation.
- Fix: Add a file size check and/or limit bytes read:
```bash
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && [ "$(stat -f%z "$TRANSCRIPT" 2>/dev/null || stat -c%s "$TRANSCRIPT" 2>/dev/null || echo 0)" -lt 10485760 ]; then
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No assertion on `AUTOBEAT_SESSIONS_DIR` propagation to the Stop hook in reuse path** - `src/implementations/tmux/tmux-connector.ts:348`
**Confidence**: 82%
- Problem: `prepareForReuse` creates a new task directory under `handle.sessionsDir`, but does not verify or update the `AUTOBEAT_SESSIONS_DIR` environment variable in the tmux session. For the initial spawn, the setup shim exports `AUTOBEAT_SESSIONS_DIR` (tmux-hooks.ts:73). On reuse, `reuseSession` only updates `AUTOBEAT_TASK_ID` (event-driven-worker-pool.ts:408). If `sessionsDir` changes between iterations (unlikely but not asserted), the Stop hook would write to the wrong directory.
- Impact: Correctness depends on `sessionsDir` being immutable across the session lifetime. This is true in practice (the field comes from WorkerPool constructor, which is singleton), but there is no runtime assertion or explicit comment establishing this invariant.

## Suggestions (Lower Confidence)

- **Stop hook silent exit on missing `jq`** - `scripts/autobeat-stop-hook.sh:6` (Confidence: 65%) — When `jq` is not found, the hook exits silently with code 0. No sentinel file is written, so the connector must rely solely on staleness detection (60s default) to detect task completion. Consider writing a `.exit` sentinel even when `jq` is unavailable so the connector can react promptly.

- **`tail -n 50` magic number** - `scripts/autobeat-stop-hook.sh:15` (Confidence: 62%) — The 50-line limit for transcript parsing is undocumented. If the last assistant message spans more than 50 lines of JSONL, the output will be truncated or parsing may fail silently. Consider documenting this bound or making it configurable.

- **No upper bound on `stopHooks` array length in idempotency scan** - `src/cli/commands/init.ts:161` (Confidence: 60%) — The `alreadyPresent` scan iterates the entire `stopHooks` array. If a user has a very large hooks config (hundreds of entries), this scan is O(N). Not a realistic concern today but violates bounded-iteration principles.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The overall lifecycle management (SessionState enum, park/reuse protocol, staleness skipping for parked sessions) is well-designed with clear state transitions and appropriate guards against re-entrancy. The bounded iteration patterns (MAX_PENDING_MESSAGES, MIN_CHECK_INTERVAL_MS, delivery loop cap) are solid. The two HIGH issues are the unguarded throws in `configureAgentHook` (which contradicts the non-fatal promise and can crash `runInit`) and the non-atomic sequence counter in the stop hook shell script (which has a mitigating factor but represents an unasserted assumption).
