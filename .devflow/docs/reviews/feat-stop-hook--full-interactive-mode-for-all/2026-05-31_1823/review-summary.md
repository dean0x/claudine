# Code Review Summary

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31
**Review Cycle**: 1 (initial)

## Merge Recommendation: CHANGES_REQUESTED

Multiple HIGH-severity blocking issues across security, architecture, and reliability require fixes before merge. Once addressed, the architectural refactoring (wrapper pipeline removal) is sound and well-decomposed.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 5 | 6 | 0 | 11 |
| Should Fix | 0 | 0 | 4 | 0 | 4 |
| Pre-existing | 0 | 0 | 1 | 0 | 1 |

---

## Blocking Issues

### CRITICAL
(none)

### HIGH

**1. Missing CURRENT_TASK_ID validation on early-exit path in stop hook** (Security + Architecture consensus)
- **Files**: `scripts/autobeat-stop-hook.sh:24-35`
- **Confidence**: 92% (3 reviewers flagged, consistent details)
- **Severity**: HIGH
- **Problem**: The early-exit path (when `RESPONSE` is empty) resolves `CURRENT_TASK_ID` from tmux/env without validating it against the regex `^[a-z0-9][a-z0-9_-]*$`, unlike the main path at line 43. A malicious task ID containing path traversal (e.g., `../../etc`) bypasses validation and writes `.exit` to an arbitrary directory.
- **Proposed Fix**: Add validation guards before sentinel write in early-exit block:
```bash
if [ -z "$RESPONSE" ]; then
  TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
  CURRENT_TASK_ID=$(tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
  [ -z "$CURRENT_TASK_ID" ] && CURRENT_TASK_ID="${AUTOBEAT_TASK_ID:-}"
  # ADD VALIDATION
  [[ "$CURRENT_TASK_ID" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 0
  SESSIONS_DIR="${AUTOBEAT_SESSIONS_DIR:-}"
  [ -z "$SESSIONS_DIR" ] && exit 0
  [[ "$SESSIONS_DIR" =~ \.\. ]] && exit 0
  if [ -n "$CURRENT_TASK_ID" ] && [ -n "$SESSIONS_DIR" ]; then
    TASK_DIR="$SESSIONS_DIR/$CURRENT_TASK_ID"
    mkdir -p "$TASK_DIR"
    echo "1" > "$TASK_DIR/.exit.tmp"
    mv "$TASK_DIR/.exit.tmp" "$TASK_DIR/.exit"
  fi
  exit 0
fi
```

**2. configureAgentHook can throw instead of returning Result** (Reliability consensus)
- **Files**: `src/cli/commands/init.ts:201-202`
- **Confidence**: 92%
- **Severity**: HIGH
- **Problem**: Function declares `Result<void, string>` return type but calls `deps.writeFile(tmpPath, content)` and `deps.renameFile(tmpPath, configPath)` without try/catch. Disk errors (permissions, ENOSPC) throw uncaught, crashing `runInit` despite JSDoc promise that "Hook config failures are non-fatal."
- **Proposed Fix**: Wrap file operations in try/catch:
```typescript
try {
  deps.writeFile(tmpPath, content);
  deps.renameFile(tmpPath, configPath);
} catch (e) {
  return err(`Failed to write ${agentType} config: ${e instanceof Error ? e.message : String(e)}`);
}
```

**3. Duplicate tmux session + task ID resolution in stop hook** (Performance + Complexity + Consistency consensus)
- **Files**: `scripts/autobeat-stop-hook.sh:24-28` and `38-41`
- **Confidence**: 90% (4 reviewers flagged as HIGH/MEDIUM with DRY concern)
- **Severity**: HIGH (when combined with missing validation fix)
- **Problem**: Both early-exit and main paths call `tmux display-message` and `tmux show-environment` separately. Each subprocess is ~5-20ms. More importantly, duplicated logic means validation fixes must be applied twice, increasing regression risk.
- **Proposed Fix**: Extract resolution into a shell function or move above both branches:
```bash
TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
CURRENT_TASK_ID=$(tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
[ -z "$CURRENT_TASK_ID" ] && CURRENT_TASK_ID="${AUTOBEAT_TASK_ID:-}"
SESSIONS_DIR="${AUTOBEAT_SESSIONS_DIR:-}"

if [ -z "$RESPONSE" ]; then
  # Use already-resolved vars...
  exit 0
fi
# Main path uses same vars...
```

**4. Synthetic TmuxSpawnConfig in prepareForReuse uses dummy fields that bypass type safety** (Architecture)
- **Files**: `src/implementations/tmux/tmux-connector.ts:370-378`
- **Confidence**: 82%
- **Severity**: HIGH
- **Problem**: `prepareForReuse()` constructs a synthetic `TmuxSpawnConfig` with `command: ''`, `agentArgs: []`, `agent: 'claude' as const` to satisfy `buildActiveSession()`. The comment documents these fields are unused, but this creates coupling risk: any future change to `buildActiveSession` that reads these fields would silently receive bogus values.
- **Proposed Fix**: Extract narrower parameter type:
```typescript
interface BuildActiveSessionConfig {
  readonly taskId: TaskId;
  readonly sessionsDir: string;
  readonly staleness?: Partial<StalenessConfig>;
  readonly persistent?: boolean;
}
// Then: buildActiveSession(config: BuildActiveSessionConfig)
```

**5. Stop hook .seq read-increment-write is not atomic** (Reliability)
- **Files**: `scripts/autobeat-stop-hook.sh:56-58`
- **Confidence**: 82%
- **Severity**: HIGH (message loss risk)
- **Problem**: Sequence counter reads (`cat`), increments in bash, and writes without locking. Concurrent Stop hook invocations (possible if agent produces rapid outputs) would read the same seq value, producing identical sequence numbers and causing message file overwrites.
- **Mitigating Factor**: Claude Code's Stop hook fires synchronously once per turn, so concurrent invocations are unlikely in practice. However, this is an implicit assumption not enforced at runtime.
- **Proposed Fix**: Use flock with fallback or document the assumption explicitly:
```bash
if command -v flock >/dev/null 2>&1; then
  SEQ=$(flock "$SEQ_FILE.lock" bash -c "SEQ=\$(cat '$SEQ_FILE' 2>/dev/null || echo 0); SEQ=\$((SEQ + 1)); echo \$SEQ > '$SEQ_FILE'; echo \$SEQ")
else
  # Document: Stop hook invocations are synchronous per turn; concurrent writes unlikely
  SEQ=$(cat "$SEQ_FILE" 2>/dev/null || echo 0)
  SEQ=$((SEQ + 1))
  echo "$SEQ" > "$SEQ_FILE"
fi
```

---

## Should-Fix Issues (Can be addressed in follow-up if unblocking is urgent)

### MEDIUM

**1. `configureAgentHook` idempotency check has 4-level nesting** (Complexity)
- **Files**: `src/cli/commands/init.ts:161-172`
- **Confidence**: 85%
- **Category**: Should Fix
- **Problem**: Nested `.some()` with two layers of type narrowing reaches 4 levels of indentation, making logic harder to follow.
- **Proposed Fix**: Extract into named predicate:
```typescript
function hasStopHookCommand(stopHooks: unknown[]): boolean {
  return stopHooks.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (!Array.isArray(e.hooks)) return false;
    return (e.hooks as unknown[]).some((h) => {
      if (typeof h !== 'object' || h === null) return false;
      const hookEntry = h as Record<string, unknown>;
      return hookEntry.type === 'command' && hookEntry.command === STOP_HOOK_COMMAND;
    });
  });
}
```

**2. Stale comments referencing removed `session.exited` boolean** (Consistency + TypeScript + Regression)
- **Files**: `src/implementations/tmux/tmux-connector.ts:526-530` and `281`
- **Confidence**: 95% (4 reviewers flagged)
- **Category**: Should Fix
- **Problem**: Comments still reference `session.exited` (old boolean) instead of `session.state` (new enum). The code is correct but documentation drift will confuse future readers about the actual guard logic.
- **Proposed Fix**: Update comments to match new state model:
```typescript
// Line 526-530:
// No debounce needed here: handleSentinel() checks session.state !== 'active'
// synchronously at the top of the event-loop tick. Because
// triggerExit() sets session.state to 'parked' or 'exited' before returning,
// any platform double-fire of the same sentinel file is a no-op —
// the second callback sees state !== 'active' and returns immediately.
```

**3. Misleading JSDoc: `persistent` "has no effect" contradicts actual usage** (Consistency + Architecture)
- **Files**: `src/implementations/base-agent-adapter.ts:99-102`
- **Confidence**: 82%
- **Category**: Should Fix
- **Problem**: JSDoc states `persistent` "has no effect" but the option is actively used by caller for session lifecycle (park vs. destroy). Comment implies option is vestigial; readers might remove it.
- **Proposed Fix**: Clarify distinction between adapter-level and connector-level behavior:
```typescript
* DECISION: Wrapper pipeline mode (--print/--quiet based) has been removed.
* All tmux sessions are interactive; output is captured via the Stop hook.
* The `persistent` option no longer affects CLI arg generation (all sessions
* use the interactive path), but it is still passed through to
* TmuxSpawnCoreConfig by the caller for session lifecycle control
* (park vs destroy on sentinel).
```

**4. `if (prompt)` guard in launchAndRegister is now dead code** (Architecture + Regression)
- **Files**: `src/implementations/event-driven-worker-pool.ts:658`
- **Confidence**: 85%
- **Category**: Should Fix
- **Problem**: Comment correctly states "prompt is never empty for fresh spawn" after removing wrapper pipeline. The `if (prompt)` guard is dead code that suggests an optional path still exists.
- **Proposed Fix**: Remove conditional and always execute sendKeys:
```typescript
// All sessions use interactive mode — prompt is always present.
const sendResult = this.tmuxConnector.sendKeys(handle, prompt + '\n');
```

---

## Pre-existing Issues (Not Blocking)

**1. No assertion on `AUTOBEAT_SESSIONS_DIR` propagation in reuse path** (Reliability)
- **Files**: `src/implementations/tmux/tmux-connector.ts:348`
- **Confidence**: 82%
- **Problem**: `prepareForReuse` creates a new task directory but does not verify `AUTOBEAT_SESSIONS_DIR` is set correctly in the tmux session. Correctness depends on `sessionsDir` being immutable across the session lifetime (true in practice but not asserted).
- **Status**: Noted for future work; does not block this PR.

---

## Convergence Status

**Cycle 1 (Initial Review)**

### Convergent Findings (Multiple reviewers agree)
| Finding | Reviewers | Issue Count |
|---------|-----------|-------------|
| Stop hook early-exit path missing task ID validation | Security + Architecture | 1 HIGH |
| Stop hook task ID/session resolution duplicated | Performance + Complexity + Consistency | 1 HIGH |
| configureAgentHook missing try/catch for Result contract | Reliability | 1 HIGH |
| Stop hook .seq counter non-atomic | Reliability | 1 HIGH |
| Synthetic TmuxSpawnConfig type safety gap | Architecture | 1 HIGH |
| Stale comments referencing session.exited | Consistency + TypeScript + Regression | 2 MEDIUM |
| Misleading `persistent` JSDoc | Consistency + Architecture | 1 MEDIUM |
| `configureAgentHook` nesting complexity | Complexity | 1 MEDIUM |
| Dead code `if (prompt)` guard | Architecture + Regression | 1 MEDIUM |

### Divergent Findings (Reviewers disagree on severity)
| Finding | Source A | Source B | Resolution |
|---------|----------|---------|------------|
| Stop hook shell script duplication | Consistency (MEDIUM) | Performance (HIGH when combined with validation fix) | Treat as HIGH because fixing validation requires addressing duplication |
| Orphaned .tmp file on rename failure | Reliability (MEDIUM) | Not flagged by others | Trust Reliability assessment; recommend fix in error path |
| prepareForReuse directory cleanup on buildActiveSession failure | Reliability (MEDIUM) | Not flagged by others | Trust Reliability assessment; add cleanup guard |

---

## Quality Assessment

**Strengths**:
- Architectural refactoring is clean: removes 1,187 lines of wrapper pipeline code, replaces with cleaner Stop hook
- New code follows project patterns: Result types throughout, proper DI, no mutations, bounded iterations
- Test suite thoroughly covers behavioral changes (stop-hook integration with 29 tests, regression coverage B1-1 to B1-5)
- SessionState enum (active|parked|exited) correctly models three-state lifecycle with proper state transitions
- All guards for non-persistent task path preserved (SessionState correctly branches on persistent flag)
- Port interface abstraction well-maintained (TmuxConnectorPort additions are additive, mock updated)

**Weaknesses**:
- Security validation gap in shell script (early-exit path different from main path)
- Error handling contract broken (Result type promised, throws delivered)
- Documentation drift (comments reference pre-refactor mechanisms)
- Type safety bypass (synthetic config with dummy fields)
- Atomicity assumptions not enforced (sequence counter)

---

## Action Plan

**Before Merge (BLOCKING)**:
1. Add task ID validation to stop hook early-exit path (line 24-35) — matches main path validation
2. Fix `configureAgentHook` to return `err()` instead of throwing on disk write/rename failures
3. Extract stop hook task ID/session resolution to avoid duplication and simplify validation fix
4. Consolidate jq calls in stop hook hot path (recommended but can be follow-up if time-critical)
5. Consider atomicity of .seq counter (flock with fallback or explicit assumption documentation)

**Should-Fix (Can be follow-up PR if unblocking is urgent)**:
1. Extract nested predicate in `configureAgentHook` idempotency check
2. Update stale comments referencing removed `session.exited` boolean
3. Clarify `persistent` JSDoc to distinguish adapter vs. connector behavior
4. Remove dead `if (prompt)` guard in `launchAndRegister`
5. Extract narrower `BuildActiveSessionConfig` parameter type for `buildActiveSession()`

---

## Recommendation Details

**CHANGES_REQUESTED** because:
1. HIGH-severity security gap (task ID validation) requires fix
2. HIGH-severity reliability issue (uncaught throws in config hook) breaks contract
3. HIGH-severity duplication (shell script) increases risk of incomplete fixes
4. HIGH-severity atomicity gap (sequence counter) risks message loss
5. HIGH-severity type safety gap (synthetic config) creates future coupling risk

Once the five HIGH-severity blocking issues are addressed, the PR is ready for merge. The should-fix items strengthen the codebase but do not block approval.

