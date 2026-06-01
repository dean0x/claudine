# Reliability Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01T00:59Z

## Issues in Your Changes (BLOCKING)

### HIGH

**Stop hook `head -c 10485760` blocks indefinitely on non-pipe stdin** - `scripts/autobeat-stop-hook.sh:8`
**Confidence**: 82%
- Problem: `head -c 10485760` reads from stdin with a 10MB cap — this bounds data size, but there is no timeout on the read itself. If the calling agent fails to close its stdin pipe (e.g., crashes mid-write, or the hook is accidentally invoked outside an agent context where AUTOBEAT_WORKER=true but stdin is a terminal), the script will hang forever waiting for EOF or 10MB of data. The early-exit guard on line 4 (`[[ "${AUTOBEAT_WORKER:-}" = "true" ]] || exit 0`) prevents accidental terminal invocations, but does not prevent the hang when the agent process itself is stuck.
- Impact: A hung stop hook blocks the agent's turn-completion event loop (hooks are synchronous in Claude Code), stalling the entire task indefinitely.
- Fix: Add a read timeout using `timeout` or shell `read -t`:
```bash
# Replace line 8:
HOOK_DATA=$(timeout 30 head -c 10485760) || { exit 0; }
```
Note: `timeout` is coreutils (available on Linux CI, may need `gtimeout` on macOS). An alternative is to accept the risk since Claude Code guarantees stdin pipe closure, but document the assumption explicitly.

**Stop hook `eval` of jq output with no validation of eval input shape** - `scripts/autobeat-stop-hook.sh:17-22`
**Confidence**: 80%
- Problem: The `eval` command executes whatever jq produces. While the jq filter uses `@sh` escaping and the outer `|| true` suppresses errors, if jq produces malformed output (e.g., partial write due to OOM or signal), `eval` could execute truncated shell fragments. The `2>/dev/null || true` after `eval` means failures are silent, leaving variables potentially unset or set to garbage.
- Impact: In the degraded case, RESPONSE, STOP_REASON, USAGE_JSON, and TOTAL_COST_USD may be uninitialized (empty strings in bash), which is handled downstream. However, a pathologically truncated eval could assign partial values. Risk is LOW in practice because jq's `@sh` output is atomic per field.
- Fix: Add a defensive check that the four variables are set (even if empty) after eval, or switch to individual `jq -r` calls with variable assignment:
```bash
# Defensive: verify eval succeeded by checking STOP_REASON has a value
if [ -z "${STOP_REASON+x}" ]; then
  STOP_REASON="end_turn"
  RESPONSE=""
  USAGE_JSON=""
  TOTAL_COST_USD=""
fi
```

### MEDIUM

**`prepareForReuse` does not validate session liveness before re-registering** - `src/implementations/tmux/tmux-connector.ts:386`
**Confidence**: 83%
- Problem: `prepareForReuse()` creates a new task directory and registers a new ActiveSession without first verifying that the tmux session (`handle.sessionName`) is still alive. If the tmux session died between `triggerExit` (park) and `prepareForReuse` (reuse), the new watchers will watch directories that will never receive output, and the staleness timer is the only detection mechanism (up to `maxSilenceMs` delay, default 60s).
- Impact: A dead-but-parked session causes the next loop iteration to wait up to 60s before staleness detection fires, degrading loop throughput. The WorkerPool's `tryReuseSession` does check `isAlive()` before calling `reuseSession()`, so this is defense-in-depth rather than a primary path gap.
- Fix: Add an `isAlive` check at the top of `prepareForReuse`:
```typescript
// After the duplicate-taskId guard:
const aliveResult = this.deps.sessionManager.isAlive(handle.sessionName);
if (!aliveResult.ok || !aliveResult.value) {
  return err(tmuxSessionFailed('prepareForReuse', `parked session '${handle.sessionName}' is no longer alive`));
}
```

**Sequence counter race between Stop hook writes and `initTaskDirectory` reset** - `src/implementations/tmux/tmux-hooks.ts:163` + `scripts/autobeat-stop-hook.sh:68-70`
**Confidence**: 80%
- Problem: `initTaskDirectory()` writes `'0'` to `.seq`, and the Stop hook reads `.seq`, increments, and writes back. The reuse protocol is: park (hook wrote last message) -> `setEnvironment(AUTOBEAT_TASK_ID)` -> `/clear` -> settle delay -> `initTaskDirectory(newTaskId)` -> `sendKeys(prompt)`. Since the NEW task directory is created under `newTaskId`, and the hook reads `AUTOBEAT_TASK_ID` from the tmux environment (updated in step 2), the hook and init write to different directories. However, if a late Stop hook fires for the `/clear` command itself (between env update and initTaskDirectory), it would write to `newTaskId`'s directory before init resets `.seq` to 0, potentially losing a message.
- Impact: In normal operation, `/clear` does not trigger a Stop hook (it is a client-side command, not an agent turn). Risk is theoretical unless a future agent CLI change fires hooks on internal commands.
- Fix: Document the ordering invariant explicitly, or have `initTaskDirectory` use `'0'` only if `.seq` does not already exist (idempotent init):
```typescript
// Only reset seq if file doesn't exist (avoids clobbering in-flight writes)
if (!existsSync(seqFilePath)) {
  this.deps.writeFile(seqFilePath, '0', { mode: FILE_MODE });
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`dispose()` clears `parkedSessionAgents` but does not destroy parked tmux processes directly** - `src/implementations/tmux/tmux-connector.ts:476`
**Confidence**: 82%
- Problem: `dispose()` iterates `activeSessions` to destroy tmux processes and clear state, then clears `parkedSessionAgents`. But parked sessions have been removed from `activeSessions` by `triggerExit()`, so they are NOT iterated by `dispose()`. Their tmux processes would leak if `dispose()` were called without `killAll()` having run first.
- Impact: Currently the only caller of `dispose()` is `killAll()` in the WorkerPool, which calls `cleanupPersistentSession()` first (destroying parked sessions), so in practice this is safe. However, if `dispose()` is ever called directly (e.g., emergency shutdown, test teardown), parked tmux sessions will be orphaned. The `parkedSessionAgents` map holds the session names needed to destroy them.
- Fix: Before the `activeSessions` iteration in `dispose()`, iterate `parkedSessionAgents` and destroy those sessions too:
```typescript
dispose(): void {
  // Destroy any parked sessions first (not in activeSessions)
  for (const [sessionName] of this.parkedSessionAgents) {
    try {
      this.deps.sessionManager.destroySession(sessionName);
    } catch { /* best-effort */ }
  }
  this.parkedSessionAgents.clear();
  // ... existing activeSessions cleanup ...
}
```

## Pre-existing Issues (Not Blocking)

(None at CRITICAL severity in unchanged code.)

## Suggestions (Lower Confidence)

- **`CLEAR_SETTLE_MS = 300` is a fixed magic delay without retry/confirmation** - `src/implementations/event-driven-worker-pool.ts:153` (Confidence: 65%) — The 300ms settle delay assumes /clear completes in that window. On slow systems or under load, this may not hold. A confirmation signal (e.g., detecting the prompt reappearing) would be more reliable but adds complexity.

- **Stop hook transcript fallback reads only last 50 lines** - `scripts/autobeat-stop-hook.sh:29` (Confidence: 62%) — `tail -n 50` bounds reads (good for reliability), but very long assistant messages (e.g., large code generation) may be truncated. This is an intentional trade-off documented in the comment, but worth noting for awareness.

- **No explicit upper bound on `parkedSessionAgents` map growth** - `src/implementations/tmux/tmux-connector.ts:176` (Confidence: 60%) — If sessions are parked but never reused or cleaned up due to a bug in the loop handler, the map grows unboundedly. The practical bound is `MAX_CONCURRENT_SESSIONS` (20), since you cannot park more sessions than you spawned. Implicit bound via spawn cap is sufficient.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core design is well-bounded: session caps (MAX_CONCURRENT_SESSIONS=20), message buffer caps (MAX_PENDING_MESSAGES=100), staleness timers with explicit intervals (MIN_CHECK_INTERVAL_MS=1000), atomic file writes via tmp+mv, bounded loop iteration in `deliverPendingMessages`, and defense-in-depth state guards (`session.state !== 'active'`) throughout. The stop hook bounds its stdin read (10MB cap) and transcript read (50 lines). The primary reliability gaps are: (1) the stdin read has no timeout bound, and (2) the `eval` path lacks post-validation of assigned variables. Both are shell-layer concerns with mitigations in the calling agent's pipe management, but explicit bounds would eliminate the residual risk.
