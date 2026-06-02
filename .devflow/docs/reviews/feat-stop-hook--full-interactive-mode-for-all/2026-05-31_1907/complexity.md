# Complexity Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31T19:07:00Z
**Prior Resolutions**: Cycle 1 deferred reuseSession (111 lines / 9 steps) — assessed as acceptable due to distinct error paths per step.

## Issues in Your Changes (BLOCKING)

### HIGH

**configureAgentHook is 96 lines with mixed concerns** - `src/cli/commands/init.ts:128-223`
**Confidence**: 85%
- Problem: This function handles five distinct responsibilities in a single body: (1) read and parse existing config, (2) idempotency check via `hasStopHookCommand`, (3) backup creation, (4) config deep-merge, and (5) atomic write with rollback. At 96 lines this exceeds the 50-line warning threshold for function length. The nesting within `hasStopHookCommand` (nested `.some()` inside `.some()`) reaches 4 levels of callback depth.
- Fix: Extract the five phases into named helpers. `hasStopHookCommand` is already a local function (good), but the remaining four phases could be extracted:
  ```typescript
  function readExistingConfig(configPath: string, agentType: string, deps: HookConfigDeps): Result<Record<string, unknown>, string> { ... }
  function backupIfNeeded(configPath: string, deps: HookConfigDeps): void { ... }
  function atomicWriteConfig(configPath: string, content: string, agentType: string, deps: HookConfigDeps): Result<void, string> { ... }
  ```
  This would bring `configureAgentHook` under 30 lines and make each phase independently testable.

### MEDIUM

**remapExistingWorkerForReuse has 8 side-effects in a single method** - `src/implementations/event-driven-worker-pool.ts:555-608`
**Confidence**: 82%
- Problem: This 54-line method performs 8 sequential mutation steps: (1) delete flushingInProgress, (2) delete taskToWorker, (3) set taskToWorker, (4) update taskIdRef, (5) update worker.task, (6) update worker.taskId, (7) DB updateTaskId, (8) restartTimersForWorker. While each step is simple, the combined cognitive load makes it hard to verify correctness at a glance. The risk is not in any single step but in step ordering — reordering any two of these could introduce subtle bugs.
- Fix: Consider grouping the mutations into two named sub-operations with a comment fence that makes the ordering invariant explicit:
  ```typescript
  // Phase 1: Remap identity (must complete before Phase 2 reads new taskId)
  this.remapWorkerIdentity(worker, task, workerId, entry);
  // Phase 2: Restart timers under new identity
  this.restartTimersForWorker(worker);
  ```
  This is a readability improvement, not a structural refactor — the method is doing the right thing, it just takes effort to verify.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**runInit is 79 lines with branching paths for interactive vs non-interactive** - `src/cli/commands/init.ts:381-459`
**Confidence**: 80%
- Problem: `runInit` handles three major paths: non-interactive (`--agent` flag), non-TTY guard, and interactive (prompt-based). The function length (79 lines) is at the upper end of the warning range, and the branching between paths makes it moderately difficult to follow the flow. The skill install sub-flow call appears in two branches with slightly different follow-up logic (lines 400-410 and 448-455), creating near-duplication.
- Fix: The two skill-install + hook-configure + return sequences (lines 400-410 and 448-458) could be extracted into a shared `finalizeInit(agent, status, options, deps)` helper. This would reduce `runInit` by ~15 lines and eliminate the near-duplication.

**runSkillInstall has 5 exit paths across 67 lines** - `src/cli/commands/init.ts:465-531`
**Confidence**: 80%
- Problem: The function has 5 early returns across interactive, non-interactive, and error paths. While each path is simple, the function requires reading all 67 lines to understand the complete set of outcomes. The conditional chain for determining `agents` (lines 475-503) uses four `if/else if` branches with different combinations of flags and TTY state.
- Fix: Extract the agent-resolution logic into a dedicated `resolveTargetAgents()` helper that returns the agent list or a skip/cancel reason. This would simplify `runSkillInstall` to: resolve agents -> check existing -> copy.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**event-driven-worker-pool.ts is 1,240 lines** - `src/implementations/event-driven-worker-pool.ts`
**Confidence**: 85%
- Problem: The file exceeds the 500-line critical threshold by 2.5x. While methods are individually well-extracted (spawn, kill, reuseSession, etc.), the file contains the full lifecycle for workers, persistent sessions, flushing, heartbeats, timeouts, and completion handling. This concentrates a large number of responsibilities into a single file.
- Fix: Consider extracting timer management (heartbeat, timeout, flushing) into a `WorkerTimerManager` class, or persistent session lifecycle into a `PersistentSessionManager`. This is a significant refactor best done in a dedicated PR. The PR description notes a net -1,187 line reduction from removing the wrapper pipeline, so the overall direction is toward simplification.

**tmux-connector.ts is 1,066 lines** - `src/implementations/tmux/tmux-connector.ts`
**Confidence**: 85%
- Problem: The file exceeds the 500-line critical threshold by 2x. It manages session lifecycle, staleness detection, message ordering/delivery, sentinel watching, and flush orchestration. The class has well-decomposed private methods but the sheer volume makes navigation difficult.
- Fix: The staleness timer subsystem (restartSharedStalenessTimer, runSharedStalenessCheck, checkSessionStaleness, stopSharedStalenessTimer — ~90 lines) and message delivery subsystem (handleMessageFile, deliverPendingMessages, deliverSingle, forceDeliverRemaining, flushPendingFiles, parseMessageFile — ~150 lines) are both self-contained and could be extracted into collaborator classes injected via the constructor.

## Suggestions (Lower Confidence)

- **triggerExit dual-path complexity** - `src/implementations/tmux/tmux-connector.ts:946-1008` (Confidence: 70%) — The persistent vs non-persistent branches share flush/close/delete/timer/onExit steps in different orders. A shared "common teardown" helper that takes a mode parameter could reduce the near-duplication, though the ordering differences may make this impractical.

- **hasStopHookCommand nested callbacks** - `src/cli/commands/init.ts:161-172` (Confidence: 65%) — The nested `.some()` inside `.some()` with type narrowing at each level reaches 4 indentation levels. Could be flattened with `Array.prototype.flatMap()` to reduce to a single `.some()` call.

- **ActiveSession has 15 fields** - `src/implementations/tmux/tmux-connector.ts:107-143` (Confidence: 60%) — The interface carries session identity, watcher state, staleness config, message ordering state, and lifecycle flags. A sub-grouping (e.g., `MessageDeliveryState { lastDeliveredSeq, pendingMessages, nextExpectedSeq }`) could improve readability, though the current flat structure avoids an extra level of indirection on the hot path.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR achieves a net -1,187 line reduction by removing the wrapper pipeline, which is a meaningful complexity win. The new code (stop hook, init hook configuration, connector SessionState, prepareForReuse) is well-structured with clear extraction patterns already applied (buildActiveSession, startWatchers, createAndRegisterSession, etc.). The `reuseSession` 111-line deferral from Cycle 1 is acknowledged and the justification (distinct error paths per step) is reasonable.

The one blocking HIGH is `configureAgentHook` at 96 lines with mixed concerns — this is new code that can be decomposed without risk. The two should-fix items in `init.ts` (`runInit` and `runSkillInstall`) are moderate improvements that would reduce near-duplication and simplify the agent-resolution branching.

The file-length pre-existing issues (worker pool 1,240 lines, connector 1,066 lines) are informational — they predate this PR and extracting subsystems is best done in a dedicated refactor PR (applies ADR-003).
