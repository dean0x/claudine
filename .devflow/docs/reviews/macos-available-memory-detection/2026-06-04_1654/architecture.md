# Architecture Review Report

**Branch**: macos-available-memory-detection -> main
**Date**: 2026-06-04

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Synchronous I/O in an async code path lacks architectural boundary documentation** - `src/utils/available-memory.ts:85`
**Confidence**: 82%
- Problem: `getAvailableMemory()` uses `execFileSync` (synchronous child process spawn) but is called from inside `async getResources()` in `resource-monitor.ts:59`. The function's JSDoc says "3 ms synchronous" but the architectural trade-off of blocking the event loop is not documented at the call site. The 5-second monitoring interval makes this acceptable in practice (3ms / 5000ms = 0.06% blocking), but the sync-in-async pattern is a known anti-pattern that could cause issues if the function is ever called in a tighter loop or hot path.
- Fix: Add a brief inline comment at the call site in `resource-monitor.ts:59` acknowledging the sync call:
  ```typescript
  // Sync call (~3ms via execFileSync on darwin) — acceptable at 5s polling interval
  const freeMemory = getAvailableMemory();
  ```
  This documents the architectural decision at the point of use so future maintainers don't inadvertently call it in a hot path without understanding the trade-off.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Consider injecting `getAvailableMemory` via constructor rather than module-level import** - `src/implementations/resource-monitor.ts:13` (Confidence: 65%) -- The codebase follows DIP heavily (WorkerRepository, EventBus, Logger are all injected). `getAvailableMemory` is a direct module import, which works fine here since it's a pure utility with no state, but injecting it would make `SystemResourceMonitor` testable without `vi.mock` (the test at line 31 already needs a module mock to override it). This is a minor consistency point, not a blocking concern -- the existing `process-liveness.ts` utility follows the same direct-import pattern, so this is consistent with established project conventions.

- **The `parseVmStat` helper creates a new RegExp per category extraction** - `src/utils/available-memory.ts:50` (Confidence: 62%) -- `extractPages` creates a new `RegExp` on each call (4 calls per invocation). This is fine for a function called once every 5 seconds, but if reuse frequency increases, pre-compiling the four category regexes as module-level constants (like `PAGE_SIZE_RE`) would be marginally cleaner. Not worth changing now given the call frequency.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Rationale

This PR is architecturally sound. The key design choices are well-executed:

1. **Pure function extraction** (`parseVmStat`): Separating the pure parser from the I/O-performing `getAvailableMemory` follows the Deep Modules principle -- the parser is independently testable with no mocks, while the orchestrating function handles platform dispatch and fallback. This matches the existing `process-liveness.ts` pattern (applies established project convention).

2. **Graceful degradation**: Every failure path (unparseable output, missing `vm_stat`, timeout, zero pages) falls back to `os.freemem()` rather than throwing. This aligns with the project's Result-type philosophy and the JSDoc contract ("always returns a positive number, never throws").

3. **Minimal surface change**: Only two consumers were updated (`config-validator.ts`, `resource-monitor.ts`), both with a single-line import swap. The `ResourceMonitor` interface is unchanged -- the abstraction boundary is correct. The existing test suite was updated with a targeted `vi.mock` to keep `mockFreemem` controlling the flow (avoids PF-006 -- no unrelated files swept in).

4. **Layer placement**: The utility lives in `src/utils/` alongside other platform-concern utilities (`process-liveness.ts`, `session-sweep.ts`). It does not leak platform details into core domain or interfaces, consistent with the hexagonal architecture pattern. Domain code (`config-validator.ts`) imports through the barrel (`utils/index.js`), not directly.

5. **No SOLID violations**: Single responsibility (one function, one concern per export). No circular dependencies introduced. No tight coupling -- both consumers treat `getAvailableMemory` as a drop-in replacement for `os.freemem()`.

The single MEDIUM finding (documenting the sync-in-async trade-off at the call site) is a documentation improvement, not an architectural concern. The design is correct.
