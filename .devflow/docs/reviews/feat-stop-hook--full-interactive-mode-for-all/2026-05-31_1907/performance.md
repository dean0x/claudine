# Performance Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31
**Prior Resolutions**: Cycle 1 (18 issues, 17 fixed, 1 deferred). This cycle focuses on new/remaining issues only.

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Multiple jq subprocess spawns per Stop hook invocation** - `scripts/autobeat-stop-hook.sh:10,17,68,73`
**Confidence**: 85%
- Problem: The Stop hook runs on every agent turn (hot path). In the Codex path, HOOK_DATA is piped to jq 3 times (lines 10, 68, 73) spawning 3 separate jq subprocesses. In the Claude transcript fallback path, up to 5 jq invocations occur (lines 10, 17, 20, 68, 73). Each `printf '%s' "$HOOK_DATA" | jq ...` forks a subshell, copies up to 10MB of data through a pipe, and execs jq. On macOS, fork+exec is ~1-2ms each; with 3-5 invocations this adds 3-10ms of latency per agent turn.
- Impact: Per-turn overhead adds up in loops and rapid-fire task sequences. The cost is small in absolute terms but avoidable. For a 100-iteration loop, this is 300-1000ms of cumulative subprocess overhead.
- Fix: Consolidate the Codex path into a single jq invocation that extracts all needed fields at once:
  ```bash
  # Single jq call for Codex path (most common):
  eval "$(printf '%s' "$HOOK_DATA" | jq -r '
    "RESPONSE=\(.last_assistant_message // "" | @sh)",
    "STOP_REASON=\(.stop_reason // "end_turn" | @sh)"
  ' 2>/dev/null)"
  ```
  This reduces 3 jq invocations to 1 for the Codex path. The Claude transcript path would still need its separate jq -s call (line 20), but the STOP_REASON extraction (line 73) would already be handled. Net reduction: 2 fewer jq spawns in Codex path, 1 fewer in Claude path.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Double file read in configureAgentHook backup path** - `src/cli/commands/init.ts:140,184` (Confidence: 65%) -- The config file is read once at line 140 for parsing and again at line 184 for backup creation. The already-read `raw` string from line 140 could be reused for the backup write. However, this is a cold CLI init path (one-shot, not hot), so the impact is negligible.

- **HOOK_DATA stored as bash variable up to 10MB** - `scripts/autobeat-stop-hook.sh:8` (Confidence: 60%) -- `HOOK_DATA=$(head -c 10485760)` stores up to 10MB in a bash variable. Each `printf '%s' "$HOOK_DATA" | jq` copies this through a pipe. In practice, hook payloads are typically small (a few KB), but the 10MB cap means the worst case involves copying 10MB * 3-5 times. This is defense-in-depth (the cap exists for security), and typical payloads are well under this limit.

- **prepareForReuse creates a synthetic TmuxSpawnConfig with unused fields** - `src/implementations/tmux/tmux-connector.ts:375-383` (Confidence: 62%) -- The synthetic config object passes empty/dummy values for `command`, `agentArgs`, and `agent` to satisfy the type constraint. These fields are never read by `buildActiveSession` in this path, but they are allocated. This is a single object allocation on a cold path (once per loop iteration) with no measurable impact.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architecture change itself is a net performance improvement: removing the wrapper pipeline eliminates an entire bash process that ran for the lifetime of each agent invocation, piping all stdout through a while-read loop with per-line jq calls. The new Stop hook approach processes output once at the end of each turn rather than on every line. The single MEDIUM finding (consolidating jq invocations) is a straightforward optimization that would reduce per-turn subprocess overhead by ~60% on the common Codex path. The PR removes 1,187 net lines of wrapper pipeline code, which is itself a maintenance and runtime win.
