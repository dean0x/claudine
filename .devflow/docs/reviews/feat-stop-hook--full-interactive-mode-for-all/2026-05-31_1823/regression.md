# Regression Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Stale comment references `session.exited` boolean after migration to `SessionState` enum** - `src/implementations/tmux/tmux-connector.ts:526-530`
**Confidence**: 92%
- Problem: The comment inside `startSentinelWatcher` still references `session.exited` (the old boolean field) instead of `session.state`. Lines 526-530 say: "handleSentinel() reads session.exited synchronously... triggerExit() sets session.exited = true before returning... the second callback sees exited = true". The code itself is correct (it calls `handleSentinel` which checks `session.state !== 'active'`), but the comment describes the old pre-refactor mechanism and will confuse future readers about the actual guard logic.
- Fix: Update the comment to reference `session.state`:
```typescript
// No debounce needed here: handleSentinel() checks session.state !== 'active'
// synchronously at the top of the event-loop tick. Because
// triggerExit() sets session.state to 'parked' or 'exited' before returning,
// any platform double-fire of the same sentinel file is a no-op —
// the second callback sees state !== 'active' and returns immediately.
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Defensive guard for empty prompt in fresh spawn** - `src/implementations/event-driven-worker-pool.ts:658` (Confidence: 65%) — The `if (prompt)` guard at line 658 is a no-op now that all fresh spawns always return a non-empty prompt from `buildTmuxCommand`. The guard prevents sending an empty string but could mask a bug if the adapter ever returned an empty prompt (agent would start with no instruction). Consider converting to an assertion or removing the conditional to fail fast.

- **Output granularity change is intentional but undocumented in CHANGELOG** - `scripts/autobeat-stop-hook.sh` (Confidence: 62%) — The old wrapper captured every stdout line as a separate OutputMessage; the Stop hook captures only the final assistant response per turn. This means the dashboard output stream shows less granular data (one message per turn vs. one per line). If this is intentional (PR description says it is), no code fix needed, but the behavior difference should be documented for users who relied on line-level streaming via `beat task logs`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Regression Assessment

The migration from wrapper pipeline to unified Stop hook is well-executed with minimal regression risk:

1. **Removed exports** (`WrapperConfig`, `WrapperManifest`, `CommunicationMode`, `generateWrapper`, `buildWrapperFlags`, `buildArgs`, `buildInteractiveArgs`): No remaining consumers found in `src/` or `tests/`. Clean removal.

2. **SessionState enum migration** (boolean `exited` -> three-state `active|parked|exited`): All guards correctly check `session.state !== 'active'` instead of `session.exited`. Non-persistent tasks follow the same destroy path as before. Persistent tasks gain the new `parked` state for loop iteration reuse.

3. **Non-persistent task path preserved**: `triggerExit()` correctly branches on `session.persistent` — non-persistent sessions still destroy the tmux session, clean up the directory, and fire onExit. No behavioral regression for standard (non-loop) tasks.

4. **Port interface backward compatibility**: `TmuxConnectorPort` gains `prepareForReuse()` (additive). `TmuxHooksPort` replaces `generateWrapper()` with `generateSetupShim()` (already existed before this PR) and adds `initTaskDirectory()`. The mock in `tests/fixtures/mocks.ts` is correctly updated.

5. **Agent adapter simplification**: `buildTmuxCommand()` always returns a non-empty prompt now (no wrapper baked-arg path). The `if (prompt)` guard in `launchAndRegister` is dead code for fresh spawns but harmless.

6. **Stop hook script**: Correctly handles both Codex (`last_assistant_message`) and Claude (`transcript_path`) paths. Security validations (task ID regex, path traversal check) match the existing connector-level validation patterns.
