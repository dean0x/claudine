# Code Review Summary

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31_1907
**Review Cycle**: 2 (incremental after cycle 1)
**Prior Status**: 18 issues in cycle 1; 17 fixed, 1 deferred

---

## Merge Recommendation: CHANGES_REQUESTED

Two HIGH severity regressions block merge:
1. **Usage/cost data capture broken** (Regression) — UsageParser receives empty hook data; task_usage table stops populating
2. **Persistent session orphan leak** (Reliability) — Parked sessions never killed on loop cleanup; tmux processes accumulate

Additionally, one HIGH blocking issue in architecture requires resolution:
3. **Synthetic config coupling** — Hardcoded agent type could silently break future buildActiveSession changes

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 3 | 6 | 0 | 9 |
| Should Fix | 0 | 0 | 3 | 0 | 3 |
| Pre-existing | 0 | 0 | 1 | 0 | 1 |

**Overall Issues**: 13 total (9 blocking, 3 should-fix, 1 informational)

---

## Blocking Issues (MUST FIX BEFORE MERGE)

### Architecture — Synthetic config uses dummy `agent` field that could break future buildActiveSession callers
**File**: `src/implementations/tmux/tmux-connector.ts:375-383`
**Severity**: HIGH
**Confidence**: 82%

The `prepareForReuse()` method constructs a synthetic `TmuxSpawnConfig` with `agent: 'claude' as const` as a placeholder. The design doc (lines 367-374) explains that `buildActiveSession()` does not currently read this field, but this coupling is fragile. If `buildActiveSession()` ever adds logic that reads `agent` (e.g., for agent-specific staleness tuning), Codex sessions would silently be misidentified as Claude.

**Fix**: Thread the real `agent` type through either:
- (a) Add `agent: TmuxAgentType` to `PersistentSessionEntry` and use `entry.agent ?? 'claude'` in prepareForReuse
- (b) Extract `buildActiveSession`'s actual consumed fields into a narrower interface so the type system prevents accidental reads

**Impact**: Medium — coupling point is documented but needs structural fix

---

### Regression — Usage/cost data capture broken
**File**: `src/services/usage-parser.ts:7` + `scripts/autobeat-stop-hook.sh:76-78`
**Severity**: HIGH
**Confidence**: 85%

The `UsageParser` module expects Claude's `--output-format json` output with `{"type":"result", "usage": {...}, "total_cost_usd": ...}` fields. This PR removes those flags from `ClaudeAdapter`. The new Stop hook writes `{"type":"result","content":...}` messages without `usage`/`total_cost_usd` fields. The parser will match the result marker but fail field validation (lines 84-105) and return `null`. The `UsageCaptureHandler` handles the `null` gracefully, so there's no crash — but all task cost/token tracking silently stops. The `task_usage` table will no longer receive new rows for any task.

**Fix**: Stop hook must extract and forward `usage` and `total_cost_usd` fields from the hook stdin payload into the result message JSON. These fields are available in Claude Code's Stop hook data.

**Impact**: High — Feature regression; complete loss of task usage observability (introduced in v1.4.0)

---

### Reliability — Parked persistent session orphaned on loop cleanup
**File**: `src/implementations/event-driven-worker-pool.ts:699` / `src/implementations/tmux/tmux-connector.ts:266-268`
**Severity**: HIGH
**Confidence**: 92%

When a persistent session is parked by `triggerExit()`, it is removed from `activeSessions` using the current taskId. The `PersistentSessionEntry.handle` retains the ORIGINAL first-iteration taskId (declared `readonly`). When `cleanupPersistentSession()` later calls `destroy(entry.handle)`, the `destroy()` method looks up `activeSessions.get(handle.taskId)` — this returns `undefined` because the first iteration's taskId was deleted during parking. The method early-returns with `ok(undefined)` without calling `destroySession(handle.sessionName)`. The tmux session process remains alive, orphaned.

Impact: Every loop with 2+ iterations will leak a tmux process after loop completion.

**Fix**: In `TmuxConnector.destroy()`, fall through to `destroySession(sessionName)` even when the session is not in `activeSessions`:

```typescript
destroy(handle: TmuxHandle): Result<void, AutobeatError> {
  const session = this.activeSessions.get(handle.taskId);
  if (!session) {
    // Session not tracked (may be parked) — still try to kill the tmux process
    const result = this.deps.sessionManager.destroySession(handle.sessionName);
    this.loggedCleanup('destroy', handle.taskId, handle.sessionsDir);
    return result.ok ? ok(undefined) : result;
  }
  // ... existing tracked-session cleanup path ...
}
```

**Impact**: Critical — Resource leak in every multi-iteration loop

---

## Should-Fix Issues (Recommended Before Merge)

### Performance — Multiple jq subprocess spawns per Stop hook invocation
**File**: `scripts/autobeat-stop-hook.sh:10,17,68,73`
**Severity**: MEDIUM
**Confidence**: 85%

The Stop hook runs on every agent turn (hot path). The Codex path spawns 3 separate jq subprocesses; the Claude transcript path spawns up to 5. Each fork+exec is ~1-2ms on macOS; over a 100-iteration loop this adds 300-1000ms of cumulative overhead.

**Fix**: Consolidate the Codex path into a single jq invocation that extracts all needed fields at once. This reduces 3 jq invocations to 1 on the common path.

**Impact**: Medium — Optimization; improves loop iteration latency

---

### Complexity — configureAgentHook is 96 lines with mixed concerns
**File**: `src/cli/commands/init.ts:128-223`
**Severity**: MEDIUM
**Confidence**: 85%

This function handles five distinct responsibilities: (1) read and parse existing config, (2) idempotency check, (3) backup creation, (4) config merge, (5) atomic write with rollback. Reaches 4 levels of callback nesting in `hasStopHookCommand`.

**Fix**: Extract the five phases into named helpers:
- `readExistingConfig()`
- `backupIfNeeded()`
- `atomicWriteConfig()`

Brings function under 30 lines and makes each phase independently testable.

**Impact**: Low-Medium — Code clarity; reduces cyclomatic complexity

---

### Reliability — Stop hook: no sentinel written when jq fails on main path
**File**: `scripts/autobeat-stop-hook.sh:68-78`
**Severity**: MEDIUM
**Confidence**: 82%

If `jq -Rs .` fails at line 68 (e.g., OOM on large response), `ESCAPED` is empty and the message file becomes corrupt. The `.done`/`.exit` sentinel is still written so the session exits, but the corrupt message file causes `parseMessageFile` to skip delivery — the last assistant message is lost with no indication.

**Fix**: Add an ERR trap that writes `.exit` on any unexpected failures, and validate `ESCAPED` before writing:

```bash
_emergency_exit() {
  local _ec=$?
  if [ -n "${TASK_DIR:-}" ]; then
    echo "$_ec" > "$TASK_DIR/.exit.tmp" 2>/dev/null
    mv "$TASK_DIR/.exit.tmp" "$TASK_DIR/.exit" 2>/dev/null || true
  fi
}
trap _emergency_exit ERR
```

**Impact**: Medium — Defensive error handling; prevents silent data loss

---

### Testing — Missing test coverage for behavioral regressions
**File**: `tests/integration/tmux/stop-hook.test.ts`
**Severity**: MEDIUM / HIGH
**Confidence**: 85% / 82%

Two test gaps where coverage from the deleted wrapper test suite was not carried forward:

1. **jq-unavailable guard** — Old suite tested "wrapper exits 127 when jq not in PATH". New hook exits 0 (correct), but behavioral coverage is missing.
2. **Transcript string-content format** — Transcript path handles both array and plain-string content. Only array format is tested; string fallback is untested.

**Fix**: Add two tests (see Complexity report for examples).

**Impact**: Medium — Behavioral gaps in test suite; potential silent failures if transcript format changes

---

## Convergence Status

**Cycle 1 vs Cycle 2 Progress**:
- Cycle 1 identified 18 issues; **17 fixed** (94% resolution rate), 1 deferred
- Cycle 2 identified **13 new issues** across different focus areas:
  - Regression reviewers uncovered functional break in usage parsing (not detected in cycle 1)
  - Reliability reviewers uncovered session orphan leak (new code path not in cycle 1 scope)
  - Architecture/Complexity reviewers identified NEW coupling risks from cycle 1's fixes

**Pattern**: Cycle 1 fixes were safe but introduced two regressions (usage data + session cleanup) that only became visible when testing the complete integration. Indicates need for additional integration testing before merge.

**Convergence**: 3 HIGH blocking issues (1 architecture + 2 regressions) + 3 MEDIUM should-fixes. Not converged; requires fixes to blocking issues.

---

## By Reviewer Focus

### Architecture (Cycle 2)
- 1 HIGH: Synthetic config coupling
- Score: 8/10
- Status: APPROVED_WITH_CONDITIONS

**Key Assessment**: Architecture changes are well-considered; net -1,187 line reduction eliminates entire wrapper code path. Removal of pipeline is clean. Only issue is the fragile coupling in prepareForReuse.

---

### Reliability (Cycle 2)
- 2 HIGH: Session orphan leak, missing jq error trap
- 2 MEDIUM: ensureDir throw, hardcoded agent type
- Score: 6/10
- Status: CHANGES_REQUESTED

**Key Assessment**: Session orphan leak is the critical concern — every loop with 2+ iterations leaks a tmux process. Missing ERR trap removes a safety net from the old wrapper script.

---

### Regression (Cycle 2)
- 1 HIGH: Usage/cost data capture broken
- 1 MEDIUM: Stale comment in orchestration-manager.ts (pre-existing)
- Score: 7/10
- Status: CHANGES_REQUESTED

**Key Assessment**: Functional regression in usage tracking; complete loss of task cost/token observability. Not a crash, but feature stops working silently.

---

### Testing (Cycle 2)
- 2 HIGH: Missing jq-unavailable test, missing transcript string-content test
- 2 MEDIUM: Implicit RESPONSE_FROM_DIRECT path difference, deleted wrapper communication tests
- Score: 8/10
- Status: APPROVED_WITH_CONDITIONS

**Key Assessment**: Strong testing discipline overall; 651-line stop-hook test suite is comprehensive. Two HIGH gaps are behavioral coverage that should have been carried forward.

---

### Complexity (Cycle 2)
- 1 HIGH: configureAgentHook 96 lines with mixed concerns
- 2 MEDIUM: runInit 79 lines, runSkillInstall 67 lines with 5 exit paths
- 2 Pre-existing MEDIUM: worker-pool 1,240 lines, tmux-connector 1,066 lines
- Score: 6/10
- Status: APPROVED_WITH_CONDITIONS

**Key Assessment**: PR achieves net -1,187 line reduction from wrapper removal. New code is well-structured; extracting phases from configureAgentHook would improve clarity.

---

### Consistency (Cycle 2)
- 4 MEDIUM: Stale "wrapper" terminology in comments/JSDoc across 4 files
- 0 Blocking
- Score: 8/10
- Status: APPROVED_WITH_CONDITIONS

**Key Assessment**: Impressively consistent refactoring; wrapper pipeline removal is thorough. Only gaps are documentation-level stale comments in files not directly modified.

---

### Security (Cycle 2)
- 0 HIGH/CRITICAL
- 0 Should-Fix
- Score: 9/10
- Status: APPROVED

**Key Assessment**: Strong security posture. All cycle 1 fixes verified in place (task ID validation, SESSIONS_DIR path traversal check, stdin cap, atomic writes). Stop hook has proper guards; hook configuration uses dependency injection.

---

### TypeScript (Cycle 2)
- 1 MEDIUM: Unhandled throw in configureAgentHook breaks Result contract
- Score: 9/10
- Status: APPROVED_WITH_CONDITIONS

**Key Assessment**: No `any` types; SessionState enum is well-designed. Only issue is inconsistent error handling in one function (ensureDir not wrapped in try/catch while writeFile/renameFile are).

---

### Performance (Cycle 2)
- 1 MEDIUM: Multiple jq subprocess spawns
- Score: 8/10
- Status: APPROVED_WITH_CONDITIONS

**Key Assessment**: Architecture change is a net performance win (eliminates wrapper pipeline). Single jq consolidation optimization would reduce per-turn overhead by ~60%.

---

## Action Plan

### Critical Path (Block Merge)
1. **Fix session orphan leak** (reliability HIGH) — Modify `destroy()` to call `destroySession()` by session name even when not in activeSessions
2. **Fix usage/cost data regression** (regression HIGH) — Stop hook must extract `usage` and `total_cost_usd` fields and include in result message JSON
3. **Fix synthetic config coupling** (architecture HIGH) — Add `agent` field to `PersistentSessionEntry` or add defensive assertion

### High-Impact Before Merge
4. **Add missing test coverage** (testing HIGH) — jq-unavailable test + transcript string-content test
5. **Consolidate jq spawns** (performance MEDIUM) — Single jq call for Codex path

### Recommended Before Merge
6. **Extract configureAgentHook phases** (complexity MEDIUM) — Break into named helpers to reduce from 96 to ~30 lines
7. **Wrap ensureDir in try/catch** (typescript/reliability MEDIUM) — Consistent error handling

### Documentation (Non-blocking)
8. **Update stale "wrapper" comments** (consistency MEDIUM) — 4 files with outdated terminology
9. **Update usage-parser doc comment** (regression MEDIUM) — Reflect new Stop hook architecture

---

## Quality Metrics

| Metric | Value |
|--------|-------|
| Net Lines Changed | -1,187 |
| Files Modified | 42 |
| New Tests | 23 |
| Blocking Issues | 3 |
| Should-Fix Issues | 3 |
| False Positives | 0 |
| Convergence | Not Yet — requires fixes to blocking issues |

---

## Cycle Comparison

| Aspect | Cycle 1 | Cycle 2 |
|--------|---------|---------|
| Total Issues | 18 | 13 |
| Fixed | 17 (94%) | 0 (staged for fixing) |
| Deferred | 1 | 0 |
| HIGH Issues | ~6 | 3 |
| Test Gaps | Not detected | 2 HIGH |
| Regressions | 0 | 2 HIGH |

Cycle 1 fixes were high-quality (17/18) but introduced regressions only visible in end-to-end testing. Cycle 2 reviewers detected these regressions, indicating the multi-focus review process is working as designed.

---

## Closure Criteria for Merge

- [ ] Session orphan leak fixed (destroy() fallthrough to destroySession)
- [ ] Usage/cost data capture restored (Stop hook exports usage fields)
- [ ] Synthetic config coupling resolved (agent type threaded through)
- [ ] Missing tests added (jq-unavailable, transcript string-content)
- [ ] Stale comments updated (wrapper → setup shim, 4 files)
- [ ] `configureAgentHook` decomposed (optional but recommended)
- [ ] `ensureDir` wrapped in try/catch (optional but recommended)

Once these are addressed, **recommend APPROVED** status.
