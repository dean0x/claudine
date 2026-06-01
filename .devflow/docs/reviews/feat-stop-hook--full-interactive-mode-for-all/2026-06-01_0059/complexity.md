# Complexity Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### HIGH

**`reuseSession()` exceeds 50-line function length (114 lines)** - `src/implementations/event-driven-worker-pool.ts:381`
**Confidence**: 90%
- Problem: The `reuseSession()` method is 114 lines long (380–494), containing 9 sequential steps with error handling for each. While the orchestration is inherently sequential, the function handles too many concerns: environment update, agent context clear, async settling, prepareForReuse coordination, worker state branching (re-register vs remap), prompt delivery, and cleanup-on-failure. This makes the function hard to understand in under 5 minutes and expensive to modify safely.
- Fix: Extract the first 4 steps (setEnvironment, sendClear, settle delay, prepareForReuse) into a private helper like `prepareSessionForIteration(task, key, handle, entry)` that returns `Result<SpawnCallbacks | null>` (null = fall through). The remaining steps (worker remap + sendKeys) are already well-decomposed into helper calls. This would bring `reuseSession()` to ~60 lines — still high but under the critical threshold — and give the preparation phase a testable boundary.

### MEDIUM

**`EventDrivenWorkerPool.spawn()` at 104 lines with 4 nesting levels** - `src/implementations/event-driven-worker-pool.ts:200`
**Confidence**: 82%
- Problem: The `spawn()` method has grown to 104 lines despite having `launchAndRegister()` and `tryReuseSession()` extracted. The method still handles resource checks, adapter resolution, config construction, reuse logic, and post-spawn registration in a single flow. The deepest nesting (the `if (psk)` block at line 266 + the `if (result.ok && psk)` block at line 290) makes the persistent session path mentally taxing to trace.
- Fix: Consider extracting the "post-spawn persistent registration" block (lines 290–300) into a named helper like `registerPersistentEntry(psk, result)`. This small extraction would reduce `spawn()` by 10 lines and name the intent clearly.

**`prepareForReuse()` has verbose synthetic config boilerplate (79 lines)** - `src/implementations/tmux/tmux-connector.ts:386`
**Confidence**: 80%
- Problem: The `prepareForReuse()` method dedicates 18 lines (414–430) to a comment explaining a synthetic config object and constructing it with dummy values (`command: ''`, `agentArgs: []`). This boilerplate exists because `buildActiveSession()` accepts a full `TmuxSpawnConfig` but only reads a few fields. The construction is not complex per se, but the explanatory comments signal the code is working around a type that is too broad for this usage.
- Fix: Introduce a narrower parameter type (e.g. `BuildSessionConfig` with only the fields `buildActiveSession` actually reads: `taskId`, `sessionsDir`, `name`, `staleness?`, `persistent?`, `agent`) and use it as the parameter type. This eliminates the synthetic config with dummy fields and the 5-line comment explaining why they are unused. Not blocking, but reduces cognitive overhead for future maintainers.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`runInit()` at 56 lines — just over the warning threshold** - `src/cli/commands/init.ts:417`
**Confidence**: 80%
- Problem: After this PR's refactoring (extracting `finalizeInit` and `resolveTargetAgents`), `runInit()` is 56 lines. This is an improvement from the pre-existing state (previously 65+), and the function is now linear and flat (max nesting depth 2). It is on the boundary of "warning" rather than genuinely complex.
- Fix: No action needed for this PR — the refactoring already reduced it. If a future change adds another branch, consider extracting the non-interactive path (lines 423–435) into a named helper.

## Pre-existing Issues (Not Blocking)

### HIGH

**`TmuxConnector` class at 964 lines** - `src/implementations/tmux/tmux-connector.ts`
**Confidence**: 85%
- Problem: The class is at 964 lines with 26+ methods. This exceeds the 500-line file-length warning threshold significantly. While individual methods are mostly well-decomposed (spawn: 39 lines, createAndRegisterSession: 41 lines, prepareForReuse: 79 lines), the class as a whole has a large surface area encompassing session lifecycle, staleness detection, message ordering/delivery, and flush management.
- Fix: Consider extracting the message delivery pipeline (handleMessageFile, deliverPendingMessages, deliverSingle, forceDeliverRemaining, parseMessageFile, flushPendingFiles — ~150 lines) into a separate `MessageDeliveryPipeline` class. This would bring TmuxConnector closer to 800 lines and give message ordering its own testable boundary. Track as tech debt — not actionable in this PR.

**`EventDrivenWorkerPool` class at 1082 lines** - `src/implementations/event-driven-worker-pool.ts`
**Confidence**: 85%
- Problem: At 1082 lines, this is the largest class in the system. It handles spawning, persistent session reuse, worker state management, timer lifecycle, output flushing, and heartbeating. The persistent-session reuse protocol added in this branch (reuseSession, tryReuseSession, reRegisterWorkerForReuse, remapExistingWorkerForReuse, restartTimersForWorker, cleanupPersistentSession) is necessary complexity, but the class is approaching the point where a new contributor cannot hold the full state machine in mind.
- Fix: Consider extracting the persistent-session reuse protocol (~200 lines: tryReuseSession, reuseSession, reRegisterWorkerForReuse, remapExistingWorkerForReuse, restartTimersForWorker, cleanupPersistentSession) into a `PersistentSessionCoordinator` class that receives the tmuxConnector and workerRepository as deps. Track as tech debt.

## Suggestions (Lower Confidence)

- **Eval + jq one-pass extraction pattern** - `scripts/autobeat-stop-hook.sh:17` (Confidence: 65%) — The `eval "$(... | jq ...)"` pattern (lines 17-22) is powerful but dense; a reader unfamiliar with jq's `@sh` escaping needs several minutes to verify correctness. The nested single-quote escaping (`"'\''" + "'\''"``) adds visual noise. Consider adding a one-line structural comment above each field showing the expected output shape.

- **`triggerExit()` dual-path branching** - `src/implementations/tmux/tmux-connector.ts:995` (Confidence: 70%) — The method now has two completely separate exit paths (persistent parking vs non-persistent destruction) with shared preamble. At 66 lines with the two paths, it is within bounds but approaching the point where splitting into `parkSession()` and `destroyExitedSession()` private helpers would improve scanability.

- **`hasStopHookCommand()` nested some-within-some** - `src/cli/commands/init.ts:175` (Confidence: 62%) — Two nested `.some()` calls make it subtly hard to verify what shape of object matches. Functionally correct but a brief comment above the outer `.some()` explaining the expected array shape would help.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 2 | 0 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates good decomposition discipline overall — `configureAgentHook` was brought down to 33 lines, `finalizeInit` and `resolveTargetAgents` cleanly extracted, the wrapper pipeline removed (-1,187 lines is a net simplification). The one blocking HIGH issue (`reuseSession` at 114 lines) is the only function that meaningfully exceeds the 50-line threshold and has enough sequential concern mixing to warrant extraction. The MEDIUM items are advisory. The pre-existing class-size issues are structural debt that predates this PR.
