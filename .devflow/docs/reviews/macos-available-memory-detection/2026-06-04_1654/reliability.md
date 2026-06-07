# Reliability Review Report

**Branch**: macos-available-memory-detection -> main
**Date**: 2026-06-04
**PR**: #204

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Synchronous process spawn on every resource poll iteration (every 5s)** - `src/utils/available-memory.ts:85`
**Confidence**: 82%
- Problem: `getAvailableMemory()` calls `execFileSync('vm_stat', ...)` synchronously on every invocation. This function is called from `SystemResourceMonitor.getResources()` which runs on a 5-second monitoring interval AND on every `canSpawnWorker()` check AND from the dashboard polling hook (`use-resource-metrics.ts` polls every 2s). While `vm_stat` typically completes in ~3ms, the synchronous call blocks the Node.js event loop. If the system is under memory pressure (the exact scenario this fix targets), process spawning latency can spike significantly above 3ms.
- Fix: The 5-second timeout bound (line 85) is the correct defense — it prevents indefinite blocking. The PR description explicitly states "execFileSync with 5s timeout. Graceful fallback on any failure. Synchronous call — bounded execution." This is an intentional, documented trade-off. The concern is real but the bound is present, and the worst-case (5s block) happens only under extreme system stress, with an immediate fallback to `os.freemem()`. No code change required — this is documented here for awareness.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No CRITICAL pre-existing issues found in reviewed files._

## Suggestions (Lower Confidence)

- **JSDoc states "always returns a positive number" but `os.freemem()` can theoretically return 0** - `src/utils/available-memory.ts:80` (Confidence: 65%) — The JSDoc on line 80 says "Always returns a positive number, never throws." In practice `os.freemem()` returns 0 only on broken systems, but the contract as stated is not enforced by code (no `Math.max(1, ...)` guard). Callers in `resource-monitor.ts` compare against `requiredMemory` and would safely refuse to spawn (fail-safe), so impact is nil.

- **`PAGE_COUNT_RE` regex declared but unused** - `src/utils/available-memory.ts:27` (Confidence: 72%) — The module-level `PAGE_COUNT_RE` constant on line 27 (`/^Pages (\w[\w ]+?):\s+([\d]+)\./m`) is declared but never referenced. The actual parsing in `extractPages()` constructs per-label regexes dynamically (line 50). This is dead code — harmless but slightly misleading to readers.

- **No upper-bound assertion on parsed byte count** - `src/utils/available-memory.ts:66` (Confidence: 62%) — `parseVmStat` returns `totalPages * pageSize` without checking whether the result exceeds `os.totalmem()`. A corrupted `vm_stat` output could produce a nonsensically large number. Callers would then see "available > total" and happily spawn workers. In practice `vm_stat` is a kernel tool and corruption is extremely unlikely, but a `Math.min(result, os.totalmem())` clamp would add a defensive upper bound. Applies ADR-008 (fail loudly on inconsistent state — though this is a softer form since the fallback path exists).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 9/10
**Recommendation**: APPROVED

## Rationale

This is a well-designed, narrowly-scoped reliability fix. Key strengths from a reliability perspective:

1. **Bounded iteration**: The `execFileSync` call has a 5-second timeout (avoids PF-006-style unbounded execution). The function always terminates.
2. **Graceful fallback**: Every failure path (`vm_stat` missing, timeout, unparseable output, zero-page result) falls through to `os.freemem()` — the function never throws, never returns undefined, and never blocks the caller indefinitely.
3. **Pure parser separation**: `parseVmStat` is a pure function with no I/O, making it trivially testable. The side-effectful `getAvailableMemory` is a thin wrapper with clear control flow.
4. **Test coverage**: 15 test cases cover valid parsing (multiple page sizes), graceful degradation (missing categories, malformed output, empty input), platform dispatch (darwin vs non-darwin), and all fallback paths (throws, unparseable, zero pages).
5. **Existing test compatibility**: The `system-resource-monitor.test.ts` mock was properly updated to route through `getAvailableMemory` while preserving the existing `mockFreemem` control flow.
6. **No behavioral change on non-darwin**: The `os.platform() !== 'darwin'` early return ensures zero risk to Linux/CI environments.

The single MEDIUM finding is a documentation-of-awareness item — the synchronous spawn is bounded and the trade-off is explicitly stated in the PR description. No blocking issues found.
