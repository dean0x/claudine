# Complexity Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### HIGH

**`configureAgentHook` idempotency check has 4-level nesting** - `src/cli/commands/init.ts:161-172`
**Confidence**: 85%
- Problem: The `alreadyPresent` check uses nested `.some()` with two layers of type narrowing inside, reaching 4 levels of nesting. The inline type guards and double `.some()` make the logic harder to follow at a glance.
- Fix: Extract the nested hook-presence check into a named predicate function:
```typescript
function hasStopHookCommand(stopHooks: unknown[]): boolean {
  return stopHooks.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (!Array.isArray(e.hooks)) return false;
    return (e.hooks as unknown[]).some((h) => {
      if (typeof h !== 'object' || h === null) return false;
      const hookEntry = h as Record<string, unknown>;
      return hookEntry.type === 'command' && hookEntry.command === STOP_HOOK_COMMAND;
    });
  });
}
```
This makes the calling code `const alreadyPresent = hasStopHookCommand(stopHooks);` and eliminates the inline nesting.

### MEDIUM

**Stop hook shell script duplicates TMUX_SESSION/CURRENT_TASK_ID lookup (lines 25-28 and 38-41)** - `scripts/autobeat-stop-hook.sh:25-41`
**Confidence**: 82%
- Problem: The task-ID resolution logic (tmux display-message, tmux show-environment, fallback to env var) appears twice in the script. If the resolution logic needs to change (e.g., a new fallback), both blocks must be updated in lockstep.
- Fix: Extract into a shell function at the top of the script:
```bash
resolve_task_context() {
  TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
  CURRENT_TASK_ID=$(tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
  [ -z "$CURRENT_TASK_ID" ] && CURRENT_TASK_ID="${AUTOBEAT_TASK_ID:-}"
  SESSIONS_DIR="${AUTOBEAT_SESSIONS_DIR:-}"
}
```
Call `resolve_task_context` once before the early-exit path and once in the main path (or once at the start and reuse the variables).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`reuseSession` method is 111 lines with 9 sequential steps** - `src/implementations/event-driven-worker-pool.ts:389-499`
**Confidence**: 82%
- Problem: Although individual steps are well-commented, the method orchestrates 9 sequential protocol steps with early-exit branches at each. The JSDoc alone is 30+ lines documenting B1-1 through B1-5 fixes. While each step is individually simple, the accumulated mental load of holding all failure modes in mind is significant.
- Fix: This is a "should-fix while here" observation. The method is already partially decomposed (Steps 6 uses `reRegisterWorkerForReuse` and `remapExistingWorkerForReuse`). The remaining improvement would be grouping Steps 2-4 (env/clear/settle) into a `prepareSessionForNewIteration` helper, reducing reuseSession to ~60 lines. This is not blocking since the step-by-step comments serve as guardrails.

**`remapExistingWorkerForReuse` mixes 5 distinct concerns** - `src/implementations/event-driven-worker-pool.ts:555-624`
**Confidence**: 80%
- Problem: This 70-line method handles: (1) flushingInProgress cleanup, (2) taskToWorker map update, (3) taskIdRef mutation, (4) WorkerState field updates, (5) timer lifecycle (clear + restart). Each has a distinct failure domain. Mixing DB writes with timer management in one method increases the blast radius of any future change.
- Fix: Consider splitting timer lifecycle (clear old + setup new) into a separate `restartTimersForWorker(worker)` helper, reducing this method to ~40 lines of pure state remapping.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`tmux-connector.ts` is 1,053 lines** - `src/implementations/tmux/tmux-connector.ts`
**Confidence**: 85%
- Problem: File length exceeds the 500-line critical threshold. The class manages session lifecycle, message ordering, staleness detection, and pending-message delivery. This PR added `prepareForReuse` (60 lines) which is well-decomposed but increases the file further. The file was likely already over 500 lines before this PR.
- Fix: Long-term opportunity — extract the message ordering/delivery logic (deliverPendingMessages, handleMessageFile, forceDeliverRemaining, deliverSingle) into a MessageDeliveryPipeline class. Not blocking for this PR since the new code is well-structured.

**`event-driven-worker-pool.ts` is 1,238 lines** - `src/implementations/event-driven-worker-pool.ts`
**Confidence**: 85%
- Problem: File length exceeds the 500-line critical threshold. The class handles spawn, reuse, kill, flushing, timeouts, heartbeats, and cleanup. Both files were large before this PR; the new code adds well-decomposed methods but doesn't reduce the overall cognitive load of navigating these files.
- Fix: Not actionable for this PR. Future opportunity: extract the persistent session reuse protocol (tryReuseSession, reuseSession, reRegisterWorkerForReuse, remapExistingWorkerForReuse, cleanupPersistentSession) into a PersistentSessionManager collaborator.

## Suggestions (Lower Confidence)

- **`configureAgentHook` could benefit from early-return on missing config file** - `src/cli/commands/init.ts:128-205` (Confidence: 65%) — The function handles both "file exists" and "file doesn't exist" paths with a nested if/try structure. Restructuring as "create empty config if not exists, then proceed uniformly" could flatten the logic, but current structure is acceptable.

- **`defaultConfigureHooks` accepts unused `agent` parameter** - `src/cli/commands/init.ts:656` (Confidence: 70%) — The `void agent` pattern is documented as "for future extensibility" but accepting and voiding a parameter adds slight confusion. Could use an `_agent` prefix instead, though this is purely stylistic.

- **`triggerExit` has 5 parameters including a default boolean** - `src/implementations/tmux/tmux-connector.ts:935-941` (Confidence: 62%) — The `skipTimerRestart = false` parameter is a control flag that changes behavior. An options object or calling `restartSharedStalenessTimer()` explicitly at the call site would be clearer, but the existing pattern is consistent with the batch-exit optimization comment.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 2 | - |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a net simplification: it removes 1,187 lines of wrapper pipeline code and replaces it with a cleaner Stop hook architecture. The new code is well-decomposed with good extraction patterns (buildActiveSession, startWatchers, safeCallOnExit, loggedCleanup, etc.) that keep individual methods under 50 lines. The blocking items are minor readability improvements (nested predicate extraction, shell script DRY) that do not affect correctness. The pre-existing file-length issues are informational only and predate this PR.

Conditions: Fix the HIGH-severity nested predicate in `configureAgentHook` before merge. The MEDIUM shell duplication is recommended but not blocking.
