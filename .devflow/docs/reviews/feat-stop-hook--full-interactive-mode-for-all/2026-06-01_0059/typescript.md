# TypeScript Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Stale `SetupShimConfig` JSDoc says "persistent interactive session" but all sessions now use this path** - `src/implementations/tmux/types.ts:221-222`
**Confidence**: 85%
- Problem: The JSDoc for `SetupShimConfig` still says "Configuration for generating a setup shim for a persistent interactive session. Used when persistent=true" but this PR removes the wrapper pipeline, making ALL sessions use the setup shim regardless of `persistent`. The comment is now misleading — a developer reading this would think it only applies to persistent sessions.
- Fix:
```typescript
/**
 * Configuration for generating a setup shim for an interactive session.
 * All agent sessions run via the setup shim — output is captured by the Stop hook.
 */
export interface SetupShimConfig {
```

**Same stale "persistent" wording in `TmuxHooksPort.generateSetupShim` JSDoc** - `src/implementations/tmux/types.ts:253-255`
**Confidence**: 85%
- Problem: The port interface JSDoc still says "Generates the session directory and setup shim for a persistent interactive session" — same issue as above.
- Fix: Replace "for a persistent interactive session" with "for an interactive session" since persistence is now an orthogonal lifecycle concern (park vs destroy on sentinel).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`syntheticConfig` lacks explicit type annotation — relies on structural compatibility without `satisfies`** - `src/implementations/tmux/tmux-connector.ts:422-430`
**Confidence**: 82%
- Problem: The `syntheticConfig` object is passed to `buildActiveSession(config: TmuxSpawnConfig, ...)` without a type annotation. It works today because it structurally satisfies `TmuxSpawnConfig`, but if `TmuxSpawnConfig` gains a new required field (e.g., a `staleness` field becomes mandatory), this call site will fail at compile time with a confusing error pointing at the `buildActiveSession` call, not at the object literal.
  Adding `satisfies TmuxSpawnConfig` (or a `Partial<TmuxSpawnConfig> as TmuxSpawnConfig` cast with a defensive comment) documents the intentional structural subset and makes the maintenance intent explicit.
- Fix:
```typescript
const syntheticConfig = {
  taskId: newTaskId,
  sessionsDir: handle.sessionsDir,
  name: handle.sessionName,
  command: '',
  agentArgs: [] as string[],
  agent: parkedAgent,
  persistent: true,
} satisfies TmuxSpawnConfig;
```
  Note: `satisfies` will reject if any required field is missing at the object literal — this is the desired behavior (catches regressions earlier).

**Type assertions in `hasStopHookCommand` without narrowing guards are defensive but could be replaced with a type guard** - `src/cli/commands/init.ts:178-183`
**Confidence**: 80%
- Problem: The function uses `as Record<string, unknown>` twice after `typeof === 'object'` checks. While functionally correct (the preceding null/typeof checks ensure safety), this pattern accumulates `as` casts that disable type checking within each branch. A single extracted type guard (`isHookEntry(x): x is { hooks: unknown[] }`) would eliminate two casts and make the intent clearer.
- Fix: Extract a narrowing type guard:
```typescript
function isHookEntry(x: unknown): x is { hooks: unknown[] } {
  return typeof x === 'object' && x !== null && Array.isArray((x as Record<string, unknown>).hooks);
}
function isCommandHook(x: unknown): x is { type: string; command: string } {
  if (typeof x !== 'object' || x === null) return false;
  const h = x as Record<string, unknown>;
  return typeof h.type === 'string' && typeof h.command === 'string';
}
```
  This concentrates the casts in well-tested guards and lets `hasStopHookCommand` body be cast-free.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`options.taskId as TaskId` cast in base-agent-adapter** - `src/implementations/base-agent-adapter.ts:155` (Confidence: 65%) — The cast is guarded by the TASK_ID_REGEX check above, but a branded-type constructor (e.g., `TaskId(options.taskId)`) would make the narrowing explicit. Low priority as this pattern is pre-existing.

- **`agentArgs: [] as string[]` in syntheticConfig uses `as` where a const annotation would suffice** - `src/implementations/tmux/tmux-connector.ts:427` (Confidence: 70%) — `[] as string[]` widens the empty array type; `[] as const` followed by `satisfies readonly string[]` or simply typing the parent object would be slightly cleaner. Marginal.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are well-typed overall — the project passes `tsc --noEmit` cleanly, discriminated unions are used correctly (`SessionState`, `AgentResolution`, `HookConfigResult`), Result types are used consistently, and the removal of the wrapper pipeline eliminates dead code without introducing type regressions. The two blocking MEDIUM issues are stale JSDoc comments that will mislead future developers about when `SetupShimConfig` is used. The should-fix items are about strengthening type safety at construction sites (using `satisfies` and type guards instead of `as` casts).
