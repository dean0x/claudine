# Consistency Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Stale "wrapper" reference in orchestrate-interactive.ts:264** - `src/cli/commands/orchestrate-interactive.ts:264`
**Confidence**: 95%
- Problem: Comment says "the wrapper is now alive and ready" but 4 other wrapper references in the same file were updated to "setup shim" / "Stop hook" terminology in this PR. This one was missed.
- Fix:
```typescript
// Deliver the initial prompt via send-keys (the session is now alive and ready).
```

**Stale "wrapper" reference in event-driven-worker-pool.ts:657** - `src/implementations/event-driven-worker-pool.ts:657`
**Confidence**: 92%
- Problem: Comment says "baked-arg wrapper path has been removed" — while technically accurate as historical context, other comments in the same file were updated (e.g. lines 235-236) to remove wrapper references entirely. This comment references a removed concept without context.
- Fix:
```typescript
// Step 10: Send prompt via sendKeys. All sessions use interactive mode;
// prompt is always present (delivered via send-keys, not baked into args).
```

**Stale "wrapper" reference in test comment** - `tests/unit/implementations/tmux/tmux-connector.test.ts:2832`
**Confidence**: 90%
- Problem: Test comment says "Need a hooks that generates wrapper ok but initTaskDirectory fails" — the wrapper concept was removed in this PR and all other test labels were updated. This is a leftover from the prior naming.
- Fix:
```typescript
// Need a hooks where generateSetupShim succeeds but initTaskDirectory fails
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SetupShimConfig JSDoc says "persistent" but all sessions now use it** - `src/implementations/tmux/types.ts:221-222`
**Confidence**: 88%
- Problem: JSDoc says "Configuration for generating a setup shim for a persistent interactive session. Used when persistent=true — the agent runs as an interactive REPL." After this PR, ALL sessions use the setup shim (wrapper pipeline removed). The "Used when persistent=true" qualifier is now incorrect — every session spawns via `generateSetupShim()`.
- Fix:
```typescript
/**
 * Configuration for generating a setup shim for an interactive session.
 * All sessions use this path — the agent runs as an interactive REPL.
 */
```

**TmuxHooksPort.generateSetupShim JSDoc says "persistent interactive session"** - `src/implementations/tmux/types.ts:253`
**Confidence**: 88%
- Problem: Same issue — JSDoc says "Generates the session directory and setup shim for a persistent interactive session" but this is now called for ALL sessions regardless of the `persistent` flag.
- Fix:
```typescript
/**
 * Generates the session directory and setup shim for an interactive session.
 * The shim initialises the messages directory and seq file, then execs the agent
 * interactively (no --print). Output is captured via the Stop hook mechanism.
 */
```

## Pre-existing Issues (Not Blocking)

_None at CRITICAL severity._

## Suggestions (Lower Confidence)

- **Inconsistent Phase naming scheme** - Multiple source files (Confidence: 65%) — Some comments reference "Phase B" (alphabetical), others "Phase 5", "Phase 7", etc. (numeric). The new code in this PR uses "Phase B" while existing code uses sequential numbers. This is an organic style difference; no functional impact but could confuse future readers about the ordering relationship between phases.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 3 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong consistency overall. The wrapper-to-stop-hook terminology migration is thorough across 20+ files with only 3 stray references remaining (2 in source, 1 in tests). The new `SessionState` enum, `prepareForReuse()` protocol, and `initTaskDirectory()` method all follow existing patterns (Result types, dependency injection, error-first guards). The `SpawnCallbacks` import relocation from `types.ts` to `core/tmux-types.ts` is clean and the barrel re-export maintains backward compatibility. Type exports via `index.ts` correctly include all new types. The mock fixture (`createMockTmuxConnector`) adds `prepareForReuse` consistent with the existing method stub pattern. Conditions: fix the 3 stale comment references and update the 2 JSDoc inaccuracies in `types.ts`.
