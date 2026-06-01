# Performance Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicate `tmux display-message` and `tmux show-environment` calls in Stop hook** - `scripts/autobeat-stop-hook.sh:25-27,38-39`
**Confidence**: 85%
- Problem: The stop hook calls `tmux display-message -p '#{session_name}'` and `tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID` twice — once on line 25-27 (the empty-RESPONSE fallback path) and once on line 38-39 (the main path). Each `tmux` invocation is a subprocess exec (~5-20ms) called on every single agent turn. Although the two blocks are mutually exclusive (only one path executes per invocation due to the `exit 0` on line 35), the early-exit path (lines 24-35) resolves TMUX_SESSION and CURRENT_TASK_ID but the main path (lines 38-39) recomputes them from scratch rather than reusing the earlier values.
- Fix: Move the `TMUX_SESSION` and `CURRENT_TASK_ID` resolution above both conditional blocks so it runs exactly once regardless of which path is taken:

```bash
TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
CURRENT_TASK_ID=$(tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
[ -z "$CURRENT_TASK_ID" ] && CURRENT_TASK_ID="${AUTOBEAT_TASK_ID:-}"

SESSIONS_DIR="${AUTOBEAT_SESSIONS_DIR:-}"

if [ -z "$RESPONSE" ]; then
  # ... write .exit sentinel using already-resolved vars ...
  exit 0
fi

# ... rest of main path uses same vars ...
```

### MEDIUM

**Multiple sequential jq invocations in stop hook hot path** - `scripts/autobeat-stop-hook.sh:10,63-64,74`
**Confidence**: 82%
- Problem: The stop hook invokes `jq` up to 4 times sequentially per agent turn (lines 10, 63, 64, 74). Each `jq` invocation forks a process (~2-5ms). On a single agent turn this is ~10-20ms total, which is acceptable for a per-turn hook. However, the same `$HOOK_DATA` is piped to jq multiple times for different fields. A single jq invocation could extract multiple fields at once.
- Fix: Consolidate the jq calls into a single multi-output extraction where possible. For example, extract both `.last_assistant_message` and `.stop_reason` in one pass:

```bash
EXTRACTED=$(printf '%s' "$HOOK_DATA" | jq -r '
  [.last_assistant_message // "", .stop_reason // "end_turn"] | @tsv
' 2>/dev/null)
RESPONSE=$(printf '%s' "$EXTRACTED" | cut -f1)
STOP_REASON=$(printf '%s' "$EXTRACTED" | cut -f2)
```

This reduces 3 jq forks to 1 on the common path (when `last_assistant_message` is present).

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **300ms hardcoded settle delay in reuseSession** - `src/implementations/event-driven-worker-pool.ts:433` (Confidence: 65%) — The `CLEAR_SETTLE_MS = 300` delay is applied unconditionally on every loop iteration reuse. This is documented as intentional (applies ADR-002 — the 300ms was explicitly upheld in a prior Greptile review), but could benefit from profiling to determine if a lower value (e.g., 100-150ms) is sufficient, or if the settle could be replaced by an ack mechanism. Not blocking since it's an inherited design choice.

- **Stop hook transcript fallback reads last 50 lines** - `scripts/autobeat-stop-hook.sh:15` (Confidence: 62%) — When `last_assistant_message` is empty, the hook falls back to `tail -n 50 "$TRANSCRIPT"` piped to `jq -s`. For very large JSONL transcripts this is acceptable (tail is O(1) from end), but the `jq -s` slurp on 50 lines of JSONL could be slow if lines are very large. Unlikely to be a real issue in practice.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architectural change from wrapper pipeline to Stop hook is a net performance improvement: it eliminates the per-line `jq` call in the wrapper's `while IFS= read -r line` loop (which invoked jq for every stdout line) and replaces it with a single jq invocation per agent turn in the Stop hook. The `prepareForReuse()` path is well-designed — it does minimal synchronous I/O (mkdir + write "0" to .seq file) and avoids any tmux subprocess calls beyond what was already there. The staleness timer's skip-parked-sessions logic (`session.state !== 'active'`) correctly avoids wasted work on intentionally-idle sessions.

The two findings above are minor optimizations to the stop hook shell script — they reduce subprocess forks per turn from ~6-7 to ~3-4 on the hot path. Neither is a correctness issue and both are safe to address in a follow-up.
