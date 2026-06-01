# Performance Review Report

**Branch**: fix-fix-tmux-prompt-delivery-switch-from-sen -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**pasteContent introduces 3 synchronous subprocess calls + file I/O per prompt delivery vs 1 for sendKeys** - `src/implementations/event-driven-worker-pool.ts:712`, `src/implementations/event-driven-worker-pool.ts:512`, `src/cli/commands/orchestrate-interactive.ts:267`
**Confidence**: 82%
- Problem: Each `pasteContent()` call executes: (1) synchronous `writeFileSync` to a temp file, (2) `spawnSync` for `tmux load-buffer`, (3) `spawnSync` for `tmux paste-buffer`, (4) `spawnSync` for `tmux delete-buffer` (best-effort), and (5) `unlinkSync` for temp file cleanup. The subsequent `sendControlKeys('Enter')` adds a 5th `spawnSync`. This replaces the prior `sendKeys` which was a single `spawnSync` call. The total blocking event-loop time increases from ~1 spawnSync to ~5 spawnSync + file I/O per prompt delivery.
- Impact: As documented in the PR description, this runs once per task spawn (not a hot path). For single-task spawns, the additional ~20-40ms of blocking I/O is negligible. However, in `killAll()` + rapid re-spawn scenarios, or during orchestrator burst-spawning of multiple tasks, the serial blocking calls accumulate. With N concurrent task spawns, the event loop is blocked for roughly N * 5 * (spawnSync latency) instead of N * 1 * (spawnSync latency).
- Fix: This is an acceptable trade-off given the correctness requirement (applies ADR-004: pasteContent + sendControlKeys Enter is canonical tmux prompt delivery). The PR description explicitly acknowledges the cost and documents it as running once per task spawn. No code change required, but consider adding a JSDoc note at the `pasteContent` call sites documenting the 5x syscall overhead vs sendKeys for future readers evaluating performance in batch-spawn paths.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**prepareSessionForIteration has a hardcoded 300ms sleep (CLEAR_SETTLE_MS) on every loop iteration reuse** - `src/implementations/event-driven-worker-pool.ts:418`
**Confidence**: 85%
- Problem: `await new Promise<void>((resolve) => setTimeout(resolve, CLEAR_SETTLE_MS))` blocks each persistent session reuse for 300ms. For loops with many iterations, this accumulates (e.g., 100 iterations = 30s of pure waiting). This is pre-existing code not introduced by this PR, but the PR touches the surrounding function.
- Impact: Adds latency to loop iteration turnaround. The 300ms is documented (ADR-002 references it as intentional) as a settling delay for `/clear` with no feedback signal available, so it is a conscious trade-off.

**Synchronous spawnSync calls block the event loop for all tmux operations** - `src/implementations/tmux/tmux-session-manager.ts:253`, `src/implementations/tmux/tmux-session-manager.ts:287`, `src/implementations/tmux/tmux-session-manager.ts:382`
**Confidence**: 80%
- Problem: `sendKeys`, `sendControlKeys`, and `pasteContent` all use synchronous `spawnSync` under the hood (via `deps.exec`). Each call blocks the Node.js event loop for the duration of the process spawn. This is a pre-existing architectural decision, not introduced by this PR.
- Impact: With the change from 1 blocking call per prompt to ~5 blocking calls per prompt, the total event-loop blocking time per spawn increases. Under concurrent task spawning, this serializes all tmux IPC. An async `execFile` alternative would allow concurrent tmux commands, but would require a larger refactor of the TmuxSessionManager.

## Suggestions (Lower Confidence)

- **Two-step prompt delivery creates a race window** - `src/implementations/event-driven-worker-pool.ts:712-723` (Confidence: 65%) -- Between pasteContent (which pastes text into the tmux pane) and sendControlKeys('Enter') (which submits it), there is a brief window where the pasted text is visible but not submitted. If the tmux session dies or another process sends keys in that window, the prompt could be partially delivered. The window is extremely small (consecutive synchronous calls) so this is theoretical rather than practical.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED

The change trades a small performance overhead (3-5 extra synchronous subprocess calls per prompt delivery) for correctness (applies ADR-004). The PR description explicitly acknowledges this trade-off and correctly identifies that prompt delivery runs once per task spawn, not on a hot path. The overhead is negligible for normal operation. The pre-existing 300ms settle delay and synchronous tmux IPC are the larger performance bottlenecks but are outside this PR's scope. No blocking performance issues found.
