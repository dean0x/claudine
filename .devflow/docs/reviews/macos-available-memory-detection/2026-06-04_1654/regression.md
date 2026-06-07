# Regression Review Report

**Branch**: fix/macos-available-memory-detection -> main
**Date**: 2026-06-04

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Incomplete test mock migration in config-validator.test.ts** - `tests/unit/core/config-validator.test.ts:32`
**Confidence**: 85%
- Problem: The config-validator test still mocks `os.freemem()` via `vi.spyOn(os, 'freemem')`, but the production code (`config-validator.ts:42`) now calls `getAvailableMemory()` instead. The resource-monitor test was correctly updated with a `vi.mock('../../../src/utils/available-memory.js', ...)` pattern (lines 29-33), but the config-validator test was not. Currently, `availableMemoryBytes` is populated but never used in any validation comparison, so tests still pass. However, this is a latent regression: any future test that asserts on `availableMemoryBytes` will fail because the `os.freemem` spy no longer controls the value. The stale mock also misleads future developers into thinking the spy is effective.
- Fix: Add a `vi.mock` for the available-memory module in `config-validator.test.ts`, matching the pattern used in `system-resource-monitor.test.ts`:
```typescript
// At top of file, before describe block:
vi.mock('../../../src/utils/available-memory.js', () => ({
  getAvailableMemory: () => 8 * 1024 * 1024 * 1024, // 8GB — matches the spied freemem value
}));
```
And optionally remove the now-ineffective `vi.spyOn(os, 'freemem')` line.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

**Loop commit sweeps unrelated .devflow/dream/ artifacts into PR diff (PF-006)** - commit `93ec55c`
**Confidence**: 95%
- Problem: The second commit on this branch (`93ec55c`) is a loop iteration auto-commit that swept 7 `.devflow/dream/` files into the branch diff. This is the exact pattern documented in PF-006 — `git add -A` stages everything in the working directory. These files are unrelated to the memory detection fix and inflate the PR diff. (avoids PF-006 — noting its occurrence for awareness)
- Severity: LOW
- Impact: Noise in PR review; no functional impact.

## Suggestions (Lower Confidence)

- **JSDoc claims "always returns a positive number"** - `src/utils/available-memory.ts:77` (Confidence: 65%) -- `os.freemem()` can theoretically return 0 on extreme memory pressure. The JSDoc could say "non-negative" instead of "positive" for precision.

- **Synchronous `execFileSync` in hot path** - `src/utils/available-memory.ts:85` (Confidence: 70%) -- `getAvailableMemory()` is called from `getResources()` which is invoked every 2 seconds by the dashboard resource metrics hook and on every `canSpawnWorker()` check. The 5-second `execFileSync` timeout blocks the Node.js event loop. In practice `vm_stat` returns in ~3ms, but if the system is under extreme load, the synchronous call could block longer. An async variant or caching strategy could mitigate this, though the current behavior matches the prior `os.freemem()` call which was also synchronous.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The migration from `os.freemem()` to `getAvailableMemory()` is clean and well-tested in the two production call sites. The new utility has solid fallback behavior (non-darwin returns `os.freemem()` directly; darwin failures fall back to `os.freemem()`), comprehensive unit tests, and the resource-monitor test mock was correctly updated. The one condition is completing the test mock migration in `config-validator.test.ts` — it is low-risk today (the unmocked value is unused in assertions) but creates a latent regression surface for future test additions.
