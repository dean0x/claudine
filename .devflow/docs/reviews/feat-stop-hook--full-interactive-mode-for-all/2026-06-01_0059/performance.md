# Performance Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### HIGH

**Stop hook: multiple jq process spawns per invocation** - `scripts/autobeat-stop-hook.sh:17,27,30,80,105`
**Confidence**: 82%
- Problem: The stop hook spawns jq up to 5 times per invocation (lines 17, 27, 30, 80, 105). In the worst-case (transcript fallback + direct response + usage), this is 4-5 separate process forks for a hook that fires on every single agent turn. While individual jq invocations are fast (~5-10ms), the cumulative overhead across a long-running loop with hundreds of iterations adds up (500+ process forks just for the hook).
- Impact: For high-iteration loops, the hook contributes measurable latency per turn. The line-17 extraction jq handles 4 fields in one pass (good), but lines 27, 30, 80, and 105 are additional invocations that could be consolidated.
- Fix: The current architecture already consolidates the main extraction into one jq call (line 17). Lines 27+30 (transcript fallback) only fire when `RESPONSE` is empty, and line 80 only fires for direct responses. This is acceptable given the conditional branching. The real concern is line 105 which always fires when usage data exists -- consider inlining the `jq -Rs .` into the main extraction pass. However, given that this is shell code on the hot path and each invocation is only processing small payloads, this is a should-fix rather than a blocker.

### MEDIUM

**Regex recompilation on every orchestration request** - `src/implementations/base-agent-adapter.ts:415`
**Confidence**: 85%
- Problem: `ORCHESTRATOR_ID_RE` is constructed inside `buildSpawnEnv()` which is called on every `spawn()`. The regex is constant and should be module-level.
- Impact: Regex compilation is cheap (~microseconds) but this is a pattern violation -- constants should not be re-created per call. On a system spawning 50+ tasks in rapid succession (pipeline launch), this is 50 unnecessary compilations.
- Fix: Move to module scope:
```typescript
const ORCHESTRATOR_ID_RE = /^orchestrator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
```
Note: This is pre-existing code (not introduced by this PR) but it is in the direct execution path of the changed `buildTmuxCommand` flow.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**process.env iteration on every spawn (unchanged but performance-relevant)** - `src/implementations/base-agent-adapter.ts:408-412`
**Confidence**: 80%
- Problem: `Object.entries(process.env).filter(...)` iterates the entire process environment (~50-200 entries) on every spawn. With interactive mode now being the sole path for all tasks (not just persistent ones), every single task spawn goes through this. Previously wrapper-mode tasks also went through it, so the frequency hasn't increased, but it's worth noting as a candidate for caching since the env stripping list is static per adapter.
- Impact: Negligible for most workloads (one spawn per task), but in pipeline burst scenarios (10 tasks at once), it's 10 full env scans. The filter uses `.some()` with prefix matching which is O(prefixes * entries).
- Fix: Could cache `cleanEnv` at adapter construction time and invalidate only if `process.env` is known to change. However, process.env can be mutated between spawns (e.g., by runtime config resolution), so caching requires careful invalidation. Not a blocker -- the current cost is bounded and small.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**300ms fixed settle delay on every loop iteration reuse** - `src/implementations/event-driven-worker-pool.ts:425`
**Confidence**: 85%
- Problem: `CLEAR_SETTLE_MS = 300` is an unconditional sleep on every persistent session reuse. This adds 300ms of latency to every loop iteration transition regardless of whether the `/clear` command actually needs that long.
- Impact: For a 100-iteration loop, that is 30 seconds of pure idle wait. The comment says "Wait for /clear to settle" but there is no mechanism to detect when `/clear` has actually completed.
- Fix: Consider a shorter delay (100ms may suffice for tmux command propagation) or implement a sentinel-based detection where the agent acknowledges the clear. This is pre-existing design and outside the scope of this PR.

## Suggestions (Lower Confidence)

- **head -c 10485760 buffering** - `scripts/autobeat-stop-hook.sh:8` (Confidence: 65%) -- Reading up to 10MB into a shell variable on every stop hook invocation. If the hook data is typically small (a few KB), this is fine since `head` will return immediately when stdin closes. But if stdin is slow to close (e.g., pipe buffer draining), this could add latency. The 10MB cap is a safety guard, not a performance concern in practice.

- **Synchronous mkdirSync in prepareForReuse hot path** - `src/implementations/tmux/tmux-hooks.ts:161-163` (Confidence: 68%) -- `initTaskDirectory()` uses sync filesystem calls on the loop-iteration reuse path. This blocks the Node.js event loop for the duration of the mkdir+write. For local filesystems this is typically < 1ms, but on networked/slow storage it could be problematic. The sync approach is intentional (Result type return, matching existing patterns).

- **parkedSessionAgents map growth** - `src/implementations/tmux/tmux-connector.ts:176` (Confidence: 62%) -- The `parkedSessionAgents` map grows with each park and is cleaned on reuse/destroy, but if reuse repeatedly fails and sessions are destroyed externally (not via the connector), entries could leak. However, the destroy() method at line 302 does clean up the entry, so this is bounded in practice.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architectural change from wrapper pipeline to unified Stop hook is a net performance improvement: it eliminates the per-line jq processing that the old wrapper performed (one `jq -Rs .` per stdout line), replacing it with per-turn hook processing (one jq call per complete agent response). For a typical agent turn that produces hundreds of stdout lines, this is a significant reduction in process forks.

The `prepareForReuse()` path is well-designed with O(1) session lookups via the `parkedSessionAgents` map and the `persistentSessions` map. The staleness timer skip-if-same-interval optimization prevents O(N) timer churn during batch spawns.

Conditions: The regex recompilation (line 415, base-agent-adapter.ts) is trivial to fix and should be moved to module scope. The stop hook jq invocation count is acceptable given the conditional branching.
