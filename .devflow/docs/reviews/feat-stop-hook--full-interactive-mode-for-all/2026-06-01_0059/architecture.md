# Architecture Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### HIGH

**parkedSessionAgents secondary map introduces subtle coupling between triggerExit and prepareForReuse** - `src/implementations/tmux/tmux-connector.ts:176`
**Confidence**: 82%
- Problem: The `parkedSessionAgents` map is a side-channel between `triggerExit()` (producer, line 1018) and `prepareForReuse()` (consumer, line 411). This introduces temporal coupling — `prepareForReuse()` silently falls back to `'claude'` (line 411) if the session was never parked via `triggerExit()`, or if the map entry is missing due to a code path change. The defensive fallback masks a programming error rather than surfacing it. Additionally, `dispose()` clears this map (line 476) but `destroy()` only deletes single entries (line 302) — the asymmetry is correct but non-obvious.
- Fix: Consider either:
  1. Storing the agent type on the `TmuxHandle` itself (which already carries taskId/sessionName/sessionsDir) so no secondary map is needed, OR
  2. Replace the `?? 'claude'` fallback with an explicit error (`return err(...)`) since reaching that state indicates a bug rather than a recoverable condition.

  Option 2 is the smaller change:
  ```typescript
  const parkedAgent = this.parkedSessionAgents.get(handle.sessionName);
  if (!parkedAgent) {
    return err(tmuxSessionFailed('prepareForReuse', `no parked agent type for session '${handle.sessionName}' — this is a bug`));
  }
  this.parkedSessionAgents.delete(handle.sessionName);
  ```

### MEDIUM

**syntheticConfig in prepareForReuse uses empty command/agentArgs to satisfy type** - `src/implementations/tmux/tmux-connector.ts:422-430`
**Confidence**: 83%
- Problem: `prepareForReuse()` constructs a `syntheticConfig` with `command: ''` and `agentArgs: [] as string[]` solely to satisfy the `TmuxSpawnConfig` type shape for `buildActiveSession()`. This violates the Liskov Substitution Principle — the type contract implies these fields carry meaningful values, but here they are garbage placeholders. If `buildActiveSession()` (or any future code) ever reads `config.command` or `config.agentArgs`, it will silently consume empty values rather than failing fast.
- Fix: Either:
  1. Extract a narrower type (`ActiveSessionConfig`) that `buildActiveSession()` actually uses (taskId, sessionsDir, staleness, persistent, agent) without requiring command/agentArgs, OR
  2. Add a `@internal` JSDoc annotation to `buildActiveSession` documenting which fields it actually reads, with an assertion guard:
  ```typescript
  // In buildActiveSession:
  // Assertion: only these fields are consumed. If you add usage of config.command
  // or config.agentArgs, update prepareForReuse()'s syntheticConfig.
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SpawnCallbacks moved to core/tmux-types.ts but still re-exported from implementations/tmux/types.ts** - `src/implementations/tmux/types.ts`, `src/core/tmux-types.ts:53`
**Confidence**: 85%
- Problem: `SpawnCallbacks` is now defined in `src/core/tmux-types.ts` (the port layer) and imported from there in `tmux-connector.ts`. However, the barrel file `src/implementations/tmux/index.ts` still re-exports `SpawnCallbacks` from `./types.js`. The `types.ts` file no longer defines `SpawnCallbacks` (it was removed in this PR). This means the re-export from the barrel is now re-exporting a type that `types.ts` itself re-imports from core. While this works in TypeScript (the type resolves correctly), it creates a circular re-export path: core defines it, implementations/tmux/types.ts re-exports it, and implementations/tmux/index.ts re-exports it again. External consumers importing from the barrel get the right type, but the layering is muddied — the canonical source is now core, not implementations.
- Fix: Remove `SpawnCallbacks` from the `implementations/tmux/index.ts` barrel re-export list and ensure all consumers import it from `core/tmux-types.ts` directly (which is already the case for `tmux-connector.ts` and `event-driven-worker-pool.ts`). This clarifies the dependency direction: core defines, implementations consume.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**TmuxConnector class exceeds 1000 lines (1118 lines)** - `src/implementations/tmux/tmux-connector.ts`
**Confidence**: 90%
- Problem: At 1118 lines, TmuxConnector is approaching god-class territory. It manages session lifecycle, staleness detection, message ordering/delivery, sentinel watching, flushing, and now the parking/reuse state machine. The `prepareForReuse()` addition is well-encapsulated, but the class now has 5 distinct responsibilities: (1) session spawn/destroy, (2) watcher management, (3) message delivery pipeline, (4) staleness detection, (5) persistent session reuse. This is a pre-existing concern that this PR incrementally worsens by adding ~100 lines.
- Observation: The message ordering/delivery pipeline (handleMessageFile, deliverPendingMessages, flushPendingFiles, forceDeliverRemaining, deliverSingle, parseMessageFile) is ~200 lines that could be extracted into a `MessageDeliveryPipeline` collaborator injected via the constructor. This would reduce TmuxConnector to ~900 lines and give the delivery pipeline its own unit tests.

## Suggestions (Lower Confidence)

- **Defensive fallback in destroy for parked sessions** - `src/implementations/tmux/tmux-connector.ts:297-306` (Confidence: 70%) — The parked-session fallback path in `destroy()` calls `loggedCleanup('destroy', handle.taskId, handle.sessionsDir)` which removes the session directory for `handle.taskId`. However, if this destroy is called after `prepareForReuse()` already created a new task directory for the next iteration, the wrong directory may be cleaned. Verify that the handle passed to `cleanupPersistentSession()` always carries the original (parked) taskId, not the new iteration's taskId.

- **buildTmuxCommand assertion on non-empty prompt** - `src/implementations/base-agent-adapter.ts:158` (Confidence: 65%) — With wrapper mode removed, `prompt` is always the return value of `transformedPrompt`. If a task has an empty prompt string, `sendKeys(handle, '\n')` will be sent (just a newline). Consider adding a precondition assertion: `if (!transformedPrompt) return err(...)`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architectural transformation is sound. Removing the wrapper pipeline in favor of a unified Stop hook model simplifies the system significantly (-1187 lines net). The SessionState enum is a correct state-machine pattern replacing a boolean. The port boundary (`TmuxConnectorPort`) is properly extended with `prepareForReuse()`. The `configureAgentHook` function in init.ts is well-decomposed with injectable deps. The one HIGH finding (parkedSessionAgents fallback masking bugs) should be addressed before merge.
