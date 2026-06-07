# Performance Review Report

**Branch**: fix/macos-available-memory-detection -> main
**Date**: 2026-06-04T16:54

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Synchronous `execFileSync` call on every resource poll** - `src/utils/available-memory.ts:88`
**Confidence**: 85%
- Problem: `getAvailableMemory()` calls `execFileSync('vm_stat', ...)` synchronously, spawning a child process. This blocks the Node.js event loop for ~3 ms per invocation. The function is called from two hot paths: (1) `SystemResourceMonitor.getResources()` which runs every 5 seconds via `performResourceCheck()` (monitoring loop), and (2) `canSpawnWorker()` which is called on every queue-processing cycle. The dashboard hook `useResourceMetrics` also calls `getResources()` every 2 seconds when the dashboard is open. Combined, this is 3 ms of event-loop blocking every 2-5 seconds.
- Impact: At 3 ms per call this is tolerable in the current architecture where the monitoring interval is 5 seconds and spawn checks are gated by a 10-second minimum delay. The ratio of blocking time to interval (3ms / 2000ms = 0.15%) is negligible. However, the synchronous call pattern is a latent risk if polling frequency increases or if multiple monitors run concurrently.
- Fix: The current approach is a pragmatic and correct tradeoff for a utility that runs infrequently. If polling frequency increases in the future, convert to an async version using `execFile` (callback/promise) or add a time-based cache (e.g., cache the result for 1-2 seconds since memory pressure does not change meaningfully in sub-second intervals):

```typescript
// Option A: Simple TTL cache (recommended for lowest effort)
let cachedValue: number | undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 2_000; // vm_stat result valid for 2s

export function getAvailableMemory(): number {
  if (os.platform() !== 'darwin') return os.freemem();
  const now = Date.now();
  if (cachedValue !== undefined && now - cachedAt < CACHE_TTL_MS) return cachedValue;
  // ... existing execFileSync logic ...
  cachedValue = parsed;
  cachedAt = now;
  return cachedValue;
}
```

**Unused `PAGE_COUNT_RE` constant** - `src/utils/available-memory.ts:27`
**Confidence**: 92%
- Problem: The module-level constant `PAGE_COUNT_RE` is declared but never referenced in the code. The `parseVmStat` function constructs its own `RegExp` instances dynamically inside `extractPages()` instead of using this pre-compiled regex. This means 4 regex objects are constructed on every call to `parseVmStat`, which itself runs on every `getAvailableMemory()` invocation.
- Impact: Micro-optimization territory. Four `new RegExp()` calls are negligible compared to the 3 ms `execFileSync`. The real issue is dead code, which is more of a consistency concern than a performance concern.
- Fix: Either remove the unused constant, or refactor `extractPages` to use `PAGE_COUNT_RE` with `matchAll` to avoid constructing regexes per call:

```typescript
// Remove the unused constant:
// delete line 27: const PAGE_COUNT_RE = ...

// Or use it (replaces extractPages):
const allPages = new Map<string, number>();
for (const m of output.matchAll(/^Pages (\w[\w ]+?):\s+(\d+)\./gm)) {
  allPages.set(m[1], parseInt(m[2], 10));
}
const freePages = allPages.get('free') ?? 0;
// ... etc
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Consider `execFile` (async) instead of `execFileSync`** - `src/utils/available-memory.ts:88` (Confidence: 65%) -- The `getResources()` method is already async, so the synchronous subprocess spawn is not structurally required. An async version would avoid event-loop blocking entirely. However, the current 3 ms blocking cost is well within acceptable bounds for the 2-5 second polling intervals, and the synchronous version keeps the code simpler (no need to thread a Promise through a pure utility function). This is a future-proofing consideration, not a current problem.

- **No caching between `getResources()` and `canSpawnWorker()` calls** - `src/implementations/resource-monitor.ts:59,103` (Confidence: 60%) -- `canSpawnWorker()` calls `this.getResources()` internally (line 103), which calls `getAvailableMemory()` again. If a caller invokes both `getResources()` and `canSpawnWorker()` in sequence, `vm_stat` runs twice within the same logical operation. In practice, these are called from different code paths (monitoring loop calls `getResources()`, worker handler calls `canSpawnWorker()`), so the double-call does not happen today.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | - | 0 | 0 | 0 |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core change (replacing `os.freemem()` with `vm_stat`-based available memory on macOS) is a high-value correctness fix that unblocks worker spawning entirely. The 3 ms synchronous cost per poll is well within acceptable bounds for the 2-5 second monitoring cadence. The two MEDIUM findings are: (1) a latent risk that should be addressed if polling frequency increases (a simple TTL cache would eliminate it), and (2) dead code (`PAGE_COUNT_RE`) that should be cleaned up. Neither blocks merge.
