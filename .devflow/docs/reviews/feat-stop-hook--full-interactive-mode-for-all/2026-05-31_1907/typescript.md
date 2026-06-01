# TypeScript Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Unhandled throw in `configureAgentHook` breaks Result contract** - `src/cli/commands/init.ts:135`
**Confidence**: 85%
- Problem: `deps.ensureDir(configDir)` on line 135 can throw (e.g., permission denied), but it is not wrapped in try/catch. The function signature is `Result<void, string>`, which promises callers that all errors are captured as `err(...)` values. A throw here violates that contract. The later `deps.writeFile` and `deps.renameFile` calls (lines 205-218) are correctly wrapped in try/catch, making this an inconsistency within the same function.
- Fix: Wrap the `ensureDir` call in try/catch like the other filesystem operations:
```typescript
try {
  deps.ensureDir(configDir);
} catch (e) {
  return err(`Failed to create ${agentType} config directory: ${e instanceof Error ? e.message : String(e)}`);
}
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Synthetic config dummy fields in `prepareForReuse`** - `src/implementations/tmux/tmux-connector.ts:375-383` (Confidence: 65%) — The `syntheticConfig` uses dummy values (`command: ''`, `agentArgs: []`, `agent: 'claude' as const`) to satisfy the `TmuxSpawnConfig` type. The JSDoc comment explains these are not read by `buildActiveSession`, but this couples `prepareForReuse` to an implementation detail of `buildActiveSession`. A future change to `buildActiveSession` that reads `command` or `agent` would silently get wrong values. Consider extracting a narrower type (e.g., `BuildActiveSessionConfig`) that only requires the fields actually consumed, or adding an assertion that documents the coupling.

- **Orphaned `.tmp` cleanup uses truncation instead of deletion** - `src/cli/commands/init.ts:214-216` (Confidence: 70%) — On rename failure, the orphaned `.tmp` file is truncated via `deps.writeFile(tmpPath, '')` rather than deleted, because `HookConfigDeps` has no `deleteFile` method. The truncated empty file is harmless but will persist on disk. Consider adding an `unlinkFile` method to `HookConfigDeps` for clean removal, or documenting why truncation is sufficient.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Analysis Notes

**Type Safety**: No `any` types anywhere in the diff. All new types use `readonly` properties consistently. The `SessionState` discriminated union type (`'active' | 'parked' | 'exited'`) is well-designed and consistently used across all guard checks. The `HookConfigResult` discriminated union on `ok` is properly narrowed at all usage sites.

**Removed Code**: The wrapper pipeline removal is clean. All references to `WrapperConfig`, `WrapperManifest`, `generateWrapper`, `buildWrapperFlags`, `buildInteractiveArgs`, `buildArgs`, and `CommunicationMode` have been completely removed from the source tree. No orphaned references remain (verified via grep).

**Import Organization**: `SpawnCallbacks` was correctly moved from `./types.ts` to `../../core/tmux-types.ts` (where it is canonically defined), and remains re-exported from `./types.ts` for backward compatibility. All new imports use `import type` where appropriate.

**Generic Patterns**: The `Result<T, E>` pattern is consistently applied. `configureAgentHook` uses `Result<void, string>` which matches the existing CLI convention (e.g., `parseSkillsAgents`, `copySkills`). The core infrastructure code correctly uses `Result<T, AutobeatError>`.

**Port Interface Extension**: `TmuxConnectorPort.prepareForReuse()` is cleanly added to the port interface in `core/tmux-types.ts` with proper JSDoc and the mock fixture in `tests/fixtures/mocks.ts` is updated to include the new method.

**Prior Resolution Cross-Check**: The two TypeScript issues from cycle 1 (unnecessary type assertion in tmux-connector.ts:491, dead `if (prompt)` guard) are confirmed fixed in the current code. The type assertion was removed and the `if (prompt)` guard was replaced with unconditional sendKeys (lines 662-671 in worker pool).
