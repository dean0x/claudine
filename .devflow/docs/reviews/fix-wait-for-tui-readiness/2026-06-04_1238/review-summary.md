# Code Review Summary

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04_1238
**Reviewers**: 10 specialized agents (architecture, complexity, consistency, dependencies, performance, regression, reliability, security, testing, typescript)

## Merge Recommendation: CHANGES_REQUESTED

The PR demonstrates strong architectural discipline and comprehensive feature implementation, but **1 HIGH blocking issue in testing scope requires fixes before merge**. A MEDIUM performance issue (redundant syscalls in the polling loop) must be addressed. Once these are fixed, the PR is mergeable.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** | 0 | 1 | 2 | 0 | **3** |
| **Should Fix** | 0 | 0 | 1 | 0 | **1** |
| **Pre-existing** | 0 | 0 | 3 | 1 | **4** |

**Blocking confidence:** HIGH (85%), MEDIUM (82%, 80%) — both must be resolved.

---

## Blocking Issues

### 1. HIGH: Missing Integration Test for `launchAndRegister` Async Change
**File**: `src/implementations/event-driven-worker-pool.ts:696`
**Confidence**: 85%
**Category**: Blocking (Testing scope)

**Problem**: 
`launchAndRegister` changed from sync `Result<Worker>` to async `Promise<Result<Worker>>`. The call site in `spawn()` was updated to `await`, but there are no integration-level tests verifying:
1. `spawn()` correctly awaits `waitForReady` before `pasteContent` (call order)
2. When `waitForReady` returns `err()`, the worker pool correctly cleans up and returns an error
3. `setupTimeoutForWorker` is called AFTER `waitForReady` resolves (not before)

The unit tests for `waitForReady` are comprehensive, but the worker pool's error handling path is untested (the mock always returns success).

**Fix**:
Add integration tests to `event-driven-worker-pool.test.ts`:
- Test that `spawn()` awaits `waitForReady` before calling `pasteContent` (verify via mock call order)
- Test that when `waitForReady` returns `err()`, the worker is cleaned up via `cleanupWorkerState` + `destroySessionWithWarning` and `spawn()` returns an error
- Test that `setupTimeoutForWorker` fires AFTER `waitForReady` completes (timeout window starts after TUI init)

**Impact**: The core worker spawn path is now async with error-handling branches that are untested. This is the most-executed code path in Autobeat.

---

### 2. MEDIUM: Redundant `isAlive()` Syscall in `waitForReady()` Polling Loop
**File**: `src/implementations/tmux/tmux-connector.ts:422`
**Confidence**: 82%
**Category**: Blocking (Performance scope)

**Problem**:
Each poll iteration calls:
1. `isAlive()` — tmux `has-session` syscall (~5-20ms)
2. `capturePaneContent()` — tmux `capture-pane` syscall (~5-20ms)

The `capturePaneContent` implementation returns `ok('')` when the session is not found (no error), so a dead session will fail to cross the content threshold, exhaust attempts, and proceed best-effort. The separate `isAlive()` call is redundant — it doubles the blocking syscall cost per iteration: 40 calls instead of 20 across a full poll (20 attempts), adding ~200-400ms of unnecessary blocking time.

**Fix**:
Replace the dual-check with a single `capturePaneContent` call. Distinguish between "actual error" (`!contentResult.ok`) and "session-not-found" (`ok('')`):

```typescript
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  const contentResult = this.deps.sessionManager.capturePaneContent(handle.sessionName);
  if (!contentResult.ok) {
    // Actual tmux error, not session-not-found
    return err(tmuxSessionFailed(...));
  }
  const trimmedLength = contentResult.value.trim().length;
  if (trimmedLength >= contentThreshold) {
    return ok(undefined);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
}
```

**Keep**: The early liveness check after the initial delay (line 413-418) — it provides fast-fail before the loop starts.

**Impact**: Polling a slow TUI (30+ seconds) would save 200-400ms+ of blocking event-loop time per invocation.

---

### 3. MEDIUM: Redundant Timer Advance in Session-Death Test
**File**: `tests/unit/implementations/tmux/wait-for-ready.test.ts:227-228`
**Confidence**: 80%
**Category**: Blocking (Should Fix)

**Problem**:
The test "returns err() immediately when the session dies during polling" advances timers twice (`await vi.advanceTimersByTimeAsync(10)` on lines 226 and 228). The initial delay is 0ms, so:
- First advance: loop starts, `isAlive` at attempt 0 returns `false` (from `isAliveValues[1]`) → error returned synchronously
- Second advance: dead code, does nothing

**Fix**:
Remove the second timer advance or explain why two are needed:

```typescript
// Advance past initial delay (0ms) — loop starts, isAlive returns false → error
await vi.advanceTimersByTimeAsync(0);
// No second advance needed; error is returned synchronously
```

**Impact**: Test clarity — keeping dead timer advances makes the test harder to reason about.

---

## Should-Fix Issues

### 1. MEDIUM: Redundant Liveness Check on First Loop Iteration
**File**: `src/implementations/tmux/tmux-connector.ts:413, 422`
**Confidence**: 65%
**Category**: Should Fix

**Problem**:
An early liveness check fires after the initial delay (lines 413-418), and another `isAlive()` check fires at the top of the first loop iteration (lines 422-430). Both are back-to-back with only a microtask boundary between them. If the early check passes, the first iteration's check will also pass — redundant `isAlive` syscall.

**Note**: This is a minor redundancy and is acceptable — the early check avoids entering the loop at all if the session is immediately dead. The design is clear and defensible. Not blocking, but worth noting.

---

## Pre-existing Issues (Not Blocking)

### 1. MEDIUM: `event-driven-worker-pool.ts` File Length (1,339 lines)
**File**: `src/implementations/event-driven-worker-pool.ts`
**Confidence**: 85%

Contains 7+ distinct responsibilities (spawning, session reuse, flushing, heartbeat, timeout, completion, cleanup). This PR adds ~86 lines to `launchAndRegister` (from ~70 to ~86). Not blocking for this PR, but a future refactor could extract the persistent-session protocol (~250 lines) into a dedicated class.

### 2. MEDIUM: `tmux-connector.ts` File Length (1,236 lines)
**File**: `src/implementations/tmux/tmux-connector.ts`
**Confidence**: 85%

Exceeds 500-line threshold. This PR adds ~55 net lines (waitForReady + capturePaneContent delegation). The new `waitForReady` method is well-bounded at 54 lines. Pre-existing issue, not blocking.

### 3. MEDIUM: Lockfile `bin` Section Out of Sync
**File**: `package-lock.json:24`
**Confidence**: 95%

The `package.json` declares both `beat` and `autobeat-stop-hook` bin entries, but `package-lock.json` only listed `beat`. This branch's loop auto-commit ran `npm install`, which synced the lockfile. Pre-existing drift now resolved. No action needed.

### 4. LOW: 9 npm Audit Vulnerabilities (Pre-existing)
**File**: `package-lock.json`
**Confidence**: 95%

All are pre-existing transitive dev dependencies (vitest, fast-uri, hono, ws, qs, ip-address). None affect the runtime package. To fix: run `npm audit fix` in a separate PR.

---

## Convergence Status

### High-Confidence Convergence (Multiple Reviewers Agree)
| Finding | Sources | Confidence | Status |
|---------|---------|------------|--------|
| Port interface extension is well-formed and follows established delegation pattern | architecture, consistency | 95% | APPROVED |
| `waitForReady` is architecturally placed in `TmuxConnector`, not worker pool | architecture, reliability | 95% | APPROVED |
| Error handling (Result types, rollback patterns) is consistent | architecture, consistency, reliability | 95% | APPROVED |
| Timeout timer was correctly moved to post-readiness (performance improvement) | architecture, performance, reliability | 90% | APPROVED |
| Reuse path correctly excludes `waitForReady` with clear DESIGN DECISION comment | architecture, consistency, regression, reliability | 90% | APPROVED |
| Test suite (unit) is comprehensive and well-structured | testing | 85% | APPROVED |

### Divergence (No Conflicts, Complementary Coverage)
All reviewers found the same blocking and should-fix issues with high confidence. No disagreements on architecture, design, or pattern consistency.

---

## By Reviewer Focus

### Architecture ✓ APPROVED
9/10 — No blocking issues. Port interface extension follows established patterns. Layering is correct. Sync-to-async conversion of `launchAndRegister` is minimal and well-scoped. Timeout reordering is sound. Design decisions documented with ADR citations.

### Complexity ⚠ APPROVED
8/10 — One MEDIUM blocking issue: `launchAndRegister` function length reached 86 lines (warning threshold). Function remains readable with clear step numbering. The new `waitForReady` method itself is clean (54 lines, CC ~5, well-bounded loop). Complexity score reflects the incremental growth, not a failure to keep methods simple.

### Consistency ✓ APPROVED
9/10 — No blocking issues. Port interface signatures, error handling patterns, naming conventions, mock consistency, and test patterns all align with project standards. One low-confidence suggestion about package-lock.json bin entry (already resolved by loop auto-commit).

### Dependencies ✓ APPROVED
9/10 — Zero new dependencies introduced. `package-lock.json` change syncs the lockfile with `package.json` (pre-existing drift, now resolved). All npm audit vulnerabilities are pre-existing and dev-only. No breaking dependency changes.

### Performance ⚠ CHANGES_REQUESTED
8/10 — One MEDIUM blocking issue: redundant `isAlive()` syscall in polling loop doubles subprocess cost per iteration (40 calls instead of 20). Specific fix provided. Timeout timer relocation is a performance improvement (tasks don't lose budget to TUI init).

### Regression ✓ APPROVED
9/10 — No breaking changes. All modifications are additive (new interface methods, new test file, new constants). The only behavioral change is the insertion of a readiness gate, which fixes a bug (prompt loss) without breaking the observable contract. All consumers updated in lockstep.

### Reliability ✓ APPROVED
9/10 — No blocking reliability issues. Polling loop is explicitly bounded (maxAttempts=20). Early liveness check provides defense-in-depth. Session death returns `err()` immediately with full rollback. Timeout behavior is safe (best-effort proceed with warning log). All options configurable.

### Security ✓ APPROVED
9/10 — No new security issues. No trust boundary crossings, no injection vectors, no secret leaks. `capturePaneContent` is read-only on owned sessions. Session reuse path correctly skips `waitForReady` per ADR-004. Error handling is clean.

### Testing ⚠ CHANGES_REQUESTED
7/10 — One HIGH blocking issue: missing integration tests for the two call sites (`launchAndRegister` async change, `orchestrate-interactive` spawn path). Unit tests are comprehensive (11 tests, all branches covered), but integration-level tests are needed to verify the worker pool's error handling and timeout timing.

### TypeScript ✓ APPROVED
9/10 — No blocking issues. Type signatures are correct. The explicit `Promise<Result<void, AutobeatError>>` return type documents the error channel clearly. `launchAndRegister` async conversion is properly typed. `WaitForReadyOptions` readonly fields with destructuring is idiomatic.

---

## Action Plan (Before Merge)

1. **Add integration tests to worker pool** (`event-driven-worker-pool.test.ts`):
   - Verify `spawn()` awaits `waitForReady` before `pasteContent` (HIGH)
   - Verify error handling: `waitForReady` err → cleanup + return err (HIGH)
   - Verify timeout starts after `waitForReady` resolves (HIGH)

2. **Optimize polling loop in `tmux-connector.ts`**:
   - Remove redundant `isAlive()` call inside loop (MEDIUM)
   - Keep early liveness check after initial delay (correct pattern)
   - Simplify to single `capturePaneContent` call with error/success branching

3. **Fix test redundancy in `wait-for-ready.test.ts`**:
   - Remove dead second timer advance in session-death test (MEDIUM)

4. **Run tests after fixes**:
   ```bash
   npm run test:tmux
   npm run test:integration
   ```

---

## Confidence Assessment

| Level | Count | Reporters | Consensus |
|-------|-------|-----------|-----------|
| **CRITICAL** | 0 | - | - |
| **HIGH** | 1 | testing (85%) | **Must fix** — integration test coverage gap |
| **MEDIUM** | 2 | performance (82%), testing (80%) | **Must fix** — syscall efficiency + test clarity |
| **LOW** | 5 | multiple (60-70%) | Informational, good-to-fix if time permits |

**Overall Assessment**: The feature is architecturally sound, well-tested at the unit level, and implements an important reliability improvement (TUI readiness gates before prompt delivery). The blocking issues are fixable in ~30-45 minutes (add ~8-10 test cases, optimize polling loop, fix test helper). Post-fixes, this PR is mergeable.

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Files changed | 12 |
| Core logic additions | `waitForReady` method + `capturePaneContent` delegation + `launchAndRegister` async conversion |
| Tests added | 15 unit tests (wait-for-ready.test.ts) + 3 delegation tests |
| Existing tests passing | 3,459 (14 grouped suites) |
| New exports | `WaitForReadyOptions` |
| Architecture changes | None (additive only) |
| Breaking changes | None |
| ADR citations | ADR-004 (prompt delivery), ADR-007 (recovery), applies to timeout ordering and reuse path |
| Blocking issues | 1 HIGH (testing) + 2 MEDIUM (performance, test clarity) |
| Should-fix issues | 1 MEDIUM (minor redundancy, acceptable) |
| Pre-existing issues | 4 (file size, lockfile sync, npm audit — all low impact) |

