# Performance Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03T18:31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Two sequential tmux subprocess invocations per poll iteration** - `src/implementations/tmux/tmux-connector.ts:415-427` (Confidence: 65%) -- Each `waitForReady()` poll calls `isAlive()` then `capturePaneContent()`, both of which spawn a tmux subprocess. These could theoretically be combined into a single `capture-pane` call (a successful capture implies the session is alive), eliminating half the subprocess spawns. However, the poll interval is 500ms and the two calls together take ~5ms, so the overhead is negligible in practice. This is a micro-optimization that would reduce clarity for no measurable gain.

- **Worst-case 11.5s spawn path latency** - `src/implementations/tmux/tmux-connector.ts:404-450` (Confidence: 60%) -- Default configuration yields 1500ms initial delay + 20 polls x 500ms = 11.5s worst-case before best-effort proceed. For typical Claude Code TUI startup (2-4 seconds), this resolves in ~3-5 polls (~3-4s total), which is reasonable. The worst case only fires when the TUI is genuinely slow or the environment is degraded, and the best-effort timeout means it never blocks permanently. The constants are all configurable via `WaitForReadyOptions`, so callers can tune for their environment.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED

## Rationale

This PR introduces a polling-based readiness check (`waitForReady`) in the tmux worker spawn path. From a performance perspective, the implementation is well-designed:

1. **Bounded polling with configurable limits**: The loop has a hard upper bound (`maxAttempts: 20`) and all timing constants are configurable via `WaitForReadyOptions`. This avoids unbounded waits. (applies ADR-004 -- prompt delivery stays pasteContent + sendControlKeys)

2. **Best-effort timeout semantics**: When polling exhausts all attempts, the method returns `ok()` rather than blocking the spawn path permanently. This ensures degraded environments do not cause indefinite hangs.

3. **No impact on session reuse path**: The `reuseSession()` method in `EventDrivenWorkerPool` does not call `waitForReady()`, which is correct -- persistent sessions already have an initialized TUI. Only fresh spawns pay the readiness wait cost.

4. **Correct async conversion**: `launchAndRegister` was converted from sync to async (`Promise<Result<Worker>>`), and the single call site in `spawn()` correctly `await`s it. No sync-to-async mismatch.

5. **Subprocess cost is negligible**: Each poll invokes two tmux commands (`has-session` + `capture-pane`) that complete in single-digit milliseconds. At 500ms intervals with typical 3-5 poll resolution, the total subprocess overhead is ~30ms, dwarfed by the poll intervals themselves.

6. **Recovery manager change is cosmetic**: The `recovery-manager.ts` diff is a pure line-length reformatting of the `isWorkerSessionAlive` signature -- zero runtime impact.

The 1.5s initial delay followed by 500ms polling intervals is a reasonable strategy for bridging the seconds-long gap between tmux session creation and Claude Code TUI initialization. The PR solves a real correctness problem (silently lost prompts) with minimal and well-bounded performance cost.
