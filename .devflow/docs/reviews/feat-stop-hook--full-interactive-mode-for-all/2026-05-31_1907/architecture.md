# Architecture Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31
**Prior Resolutions**: Cycle 1 resolved 17/18 issues; 1 deferred (reuseSession complexity).

## Issues in Your Changes (BLOCKING)

### HIGH

**Synthetic config uses dummy `agent` field that could break future buildActiveSession callers** - `src/implementations/tmux/tmux-connector.ts:375-383`
**Confidence**: 82%
- Problem: `prepareForReuse()` constructs a synthetic `TmuxSpawnConfig` with `agent: 'claude' as const` as a placeholder. The comment explains that `buildActiveSession()` does not currently read `config.agent`, but this is a fragile coupling: any future change to `buildActiveSession()` that reads `agent` will silently receive the wrong value for Codex sessions. The type system provides no guard against this drift because the value satisfies the `TmuxAgentType` constraint.
- Impact: If `buildActiveSession()` ever starts using `config.agent` (e.g., for agent-specific staleness tuning or per-agent logging), Codex sessions reused via `prepareForReuse()` would be silently misidentified as Claude sessions. This is a design-time coupling risk, not a runtime bug today.
- Fix: Either (a) thread the real `agent` value through via the `PersistentSessionEntry` or the `TmuxHandle` (preferred — the data is available at spawn time), or (b) extract the four fields `buildActiveSession` actually reads into a narrower interface so the type system prevents accidental field reads. Option (a) is simpler:
  ```typescript
  // In PersistentSessionEntry, add: agent: TmuxAgentType
  // In prepareForReuse, use: agent: entry.agent ?? 'claude'
  ```
  However, since the comment is explicit and accurate today, this is a should-fix rather than a hard block. Document it as a known coupling point at minimum.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`reuseSession` creates new callbacks BEFORE taskIdRef.current is updated** - `src/implementations/event-driven-worker-pool.ts:443`
**Confidence**: 83%
- Problem: At line 443, `this.createCallbacks(entry.taskIdRef)` is called and the resulting callbacks are passed to `prepareForReuse()`. At this point, `entry.taskIdRef.current` still holds the OLD task ID (the update to `task.id` happens later in the remap step at line 520 for the re-registration path or line 575 for the in-place remap path). The callbacks close over `taskIdRef` (a ref object, not a value copy), so once `taskIdRef.current` is updated, the callbacks will route to the correct task ID. However, there is a window between `prepareForReuse()` returning and the remap step where the callbacks embedded in the new `ActiveSession` read the stale old task ID from `taskIdRef.current`.
- Impact: If the agent produces output in the ~0ms between `prepareForReuse()` returning and `taskIdRef.current` being updated (unlikely given the /clear settle delay already passed, but not impossible if the agent has buffered output), that output would be attributed to the old task ID. In practice the risk is very low because the agent has not received the new prompt yet (sendKeys happens after the remap), but the ordering assumption is subtle and fragile.
- Fix: Move the `taskIdRef.current = task.id` update to immediately after the settle delay (line 434) and before `createCallbacks()`, so the ref is already correct when the callbacks are embedded in the new ActiveSession. The remap step already handles the ref update defensively, so doing it earlier is safe:
  ```typescript
  // After the settle delay (line 433):
  entry.taskIdRef.current = task.id;
  const reuseCallbacks = this.createCallbacks(entry.taskIdRef);
  ```

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues found.

## Suggestions (Lower Confidence)

- **`void agent` parameter in `defaultConfigureHooks`** - `src/cli/commands/init.ts:674` (Confidence: 65%) -- The `agent` parameter is accepted but explicitly voided. This suggests the function signature was designed for future extensibility, but a parameter that is always ignored is a code smell. If agent-specific hook configuration is expected soon, a TODO comment would clarify intent. If not, removing the parameter avoids confusion.

- **Old `ActiveSession` for the previous iteration is never cleaned up from `activeSessions` during the `parked` -> `prepareForReuse` transition** - `src/implementations/tmux/tmux-connector.ts:959-966` (Confidence: 72%) -- When `triggerExit()` parks a persistent session, it calls `this.activeSessions.delete(taskId)` (line 966), which removes the old entry. `prepareForReuse()` then adds a new entry under `newTaskId`. This is correct for the activeSessions map. However, the old session's `sessionDir` is intentionally preserved (line 973 comment). Over many loop iterations, these directories accumulate until `cleanupPersistentSession()` is called at loop end. If a loop runs 100+ iterations, this could accumulate significant disk usage. The existing architecture handles this correctly -- just noting the accumulation pattern.

- **`configureAgentHook` backup-before-modify does not catch exceptions from `ensureDir`** - `src/cli/commands/init.ts:135` (Confidence: 60%) -- `deps.ensureDir(configDir)` can throw but is not wrapped in try/catch with an `err()` return. All other disk operations in this function are wrapped. If `ensureDir` fails (e.g., permission denied on `~/.claude/`), it will throw an uncaught exception. However, `configureHooks` is called from `runHookConfigure` which does handle the Result, so the calling chain may absorb this. The `createDefaultHookConfigDeps` implementation uses `mkdirSync` with `recursive: true` which is quite resilient.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 8/10

The architecture changes are well-considered and represent a significant simplification. The removal of the wrapper pipeline (~1,187 lines net reduction) eliminates an entire code path that was redundant with the interactive (Stop hook) approach. Key architectural strengths:

1. **Clean unification**: All sessions now follow a single interactive mode path, eliminating the persistent/non-persistent branching in adapter, connector, and worker pool.
2. **Proper separation of concerns**: The Stop hook is an external script (`autobeat-stop-hook.sh`) registered as an npm bin entry, cleanly separating output capture from the Node.js process. This is a better boundary than the in-process wrapper pipeline.
3. **Port interface evolution**: `TmuxConnectorPort` gains `prepareForReuse()` which keeps the reuse protocol behind the port boundary (applies ADR-003 spirit -- pre-existing design gaps tracked separately). The WorkerPool does not need to know about task directories, sequence counters, or watcher lifecycle.
4. **SessionState enum**: Replacing the boolean `exited` field with a three-state enum (`active` | `parked` | `exited`) correctly models the lifecycle and makes guard conditions self-documenting.
5. **`TmuxHooksPort.initTaskDirectory()`**: New method correctly separates "create iteration directory" from "generate setup shim," avoiding shim regeneration on reuse.
6. **Hook configuration in init**: `configureAgentHook()` follows dependency injection (injectable `HookConfigDeps`), uses atomic writes (`.tmp` + rename), creates backups, and is idempotent.

The deferred issue from Cycle 1 (reuseSession complexity at 111 lines / 9 steps) is acknowledged. The new `prepareForReuse()` step increases the step count but the extracted `restartTimersForWorker()` helper partially offsets the complexity.

**Recommendation**: APPROVED_WITH_CONDITIONS
- Fix the synthetic config coupling in `prepareForReuse()` (HIGH) before merge
- Consider fixing the taskIdRef ordering in `reuseSession` (MEDIUM) before merge
