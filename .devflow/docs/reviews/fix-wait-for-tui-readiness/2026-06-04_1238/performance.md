# Performance Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Redundant isAlive() spawnSync per poll iteration doubles syscall cost in waitForReady()** - `src/implementations/tmux/tmux-connector.ts:422`
**Confidence**: 82%
- Problem: Each poll iteration calls both `isAlive()` (tmux has-session, ~5-20ms spawnSync) and `capturePaneContent()` (tmux capture-pane, ~5-20ms spawnSync). The `capturePaneContent` implementation in `tmux-session-manager.ts:462-466` already returns `ok('')` when the session is not found (via the `isSessionNotFound` check), so the separate `isAlive()` call is redundant — an empty string result from `capturePaneContent` on a dead session will never cross the `contentThreshold` (50 chars), and the loop will exhaust attempts and proceed best-effort. Meanwhile, the extra `isAlive()` call doubles the blocking spawnSync cost per iteration: worst-case 40 spawnSync calls instead of 20 across the full poll loop, adding ~200-400ms of unnecessary blocking time to the event loop.
- Fix: Rely on `capturePaneContent` alone for both readiness detection and implicit session death detection. Check the result for `!contentResult.ok` (actual tmux error, not session-not-found which returns `ok('')`):
```typescript
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  const contentResult = this.deps.sessionManager.capturePaneContent(handle.sessionName);
  if (!contentResult.ok) {
    // Actual tmux error (not session-not-found, which returns ok(''))
    return err(
      tmuxSessionFailed(
        'waitForReady',
        `capturePaneContent failed for session '${handle.sessionName}' (attempt ${attempt + 1}): ${contentResult.error.message}`,
      ),
    );
  }
  const trimmedLength = contentResult.value.trim().length;
  if (trimmedLength >= contentThreshold) {
    this.deps.logger.info('TUI ready', {
      sessionName: handle.sessionName,
      attempt: attempt + 1,
      contentLength: trimmedLength,
    });
    return ok(undefined);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
}
```
Note: The early liveness check after the initial delay (line 413) should remain — it provides a fast-fail before entering the poll loop. Only the per-iteration isAlive inside the loop is redundant.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No performance issues found in unchanged code._

## Suggestions (Lower Confidence)

- **Consider exponential backoff for poll intervals** - `src/implementations/tmux/tmux-connector.ts:447` (Confidence: 65%) -- The fixed 500ms poll interval is adequate for the expected 3-5 second TUI startup, but an exponential backoff (e.g., 250ms, 500ms, 1000ms, 2000ms...) would reduce total spawnSync calls in the common case where the TUI is ready within the first few seconds while still converging quickly in slow environments.

- **Timeout timer placement is a performance improvement** - `src/implementations/event-driven-worker-pool.ts:738-743` (Confidence: 90%) -- Moving `setupTimeoutForWorker` after `waitForReady` ensures the task timeout measures actual work time, not TUI initialization time. Tasks with short timeouts no longer lose ~11.5s of their budget to initialization. This is a positive change worth noting. (applies ADR-004)

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The waitForReady() polling design is fundamentally sound — bounded loop (20 attempts), configurable options, best-effort timeout, correct early exit on session death. The timeout timer relocation is a smart performance improvement. The one blocking item is a straightforward optimization to halve the spawnSync cost per poll iteration by removing the redundant isAlive() call inside the loop. The reuse path correctly skips waitForReady entirely (applies ADR-004), avoiding unnecessary latency on loop iterations.
