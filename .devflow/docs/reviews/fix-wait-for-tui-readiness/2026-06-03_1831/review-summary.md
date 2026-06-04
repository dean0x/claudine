# Code Review Summary

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03_1831
**Reviewers**: 10 agents (security, architecture, performance, complexity, consistency, regression, testing, reliability, typescript, dependencies)

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces a well-designed `waitForReady()` polling mechanism to bridge the gap between tmux session spawn and Claude Code TUI initialization. The implementation is sound with proper bounds, session death detection, and best-effort semantics. However, **5 blocking issues must be resolved before merge**:

1. **Architecture**: Missing `waitForReady` call in session reuse path (asymmetric prompt delivery)
2. **Consistency**: Stale JSDoc on `capturePaneContent` misleads about its dual usage
3. **Testing**: Two test coverage gaps (multi-poll attempt verification, capturePaneContent delegation)
4. **Reliability**: Initial delay doesn't check for immediate session crash (1.5s wasted)
5. **TypeScript**: Unnecessary `as string` cast in test helper masks potential type issues

All are straightforward to fix. Additionally, 2 should-fix issues in test coverage and timer ordering should be addressed while this area is under active development.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 5 | 1 | - | **6** |
| Should Fix | - | 0 | 2 | - | **2** |
| Pre-existing | - | - | 1 | - | **1** |

---

## Blocking Issues

### 1. Missing `waitForReady` in Session Reuse Path

**File**: `src/implementations/event-driven-worker-pool.ts:466-545` (reuseSession method)  
**Severity**: HIGH  
**Confidence**: 82%

**Problem**: The PR adds `waitForReady()` to the fresh-spawn path (launchAndRegister) and interactive orchestrator path, but the session reuse path (reuseSession) delivers the prompt via `pasteContent + sendControlKeys` without any readiness check. While reuse sessions are already initialized, the `/clear` command resets TUI state and there's a theoretical window where the input handler is not ready. The same "prompt silently lost" bug the PR fixes could occur if `/clear` is slow to process.

**Fix**: Either:
- Option A: Call `waitForReady()` after `prepareSessionForIteration()` and before `pasteContent()` in the reuse path
- Option B: Document explicitly why waitForReady is not needed on reuse (if the 300ms CLEAR_SETTLE_MS is sufficient)

Add a DESIGN DECISION comment explaining the choice to prevent future reviewers from flagging this asymmetry.

---

### 2. Stale JSDoc Misleads About `capturePaneContent` Purpose

**Files**: 
- `src/core/tmux-types.ts:155-159` (TmuxSessionManagerCorePort.capturePaneContent)
- `src/implementations/tmux/types.ts:210-213` (TmuxSessionManagerPort.capturePaneContent)

**Severity**: HIGH  
**Confidence**: 95%

**Problem**: The JSDoc states: *"ARCHITECTURE (Phase 9 Dashboard): Display-only method for live pane preview in the channel detail view. No business logic depends on the captured content."* However, `waitForReady()` now uses capturePaneContent as business-critical logic to determine TUI readiness before prompt delivery. The comment is factually incorrect and will mislead future maintainers about this method's role.

**Fix**: Update both JSDoc blocks to reflect dual usage:

```typescript
/**
 * Capture the visible pane content of a tmux session.
 * Implementation: `tmux capture-pane -t '{name}' -p -S -{lines}`
 *
 * Used by:
 * - Dashboard channel detail view for live pane preview (Phase 9)
 * - TmuxConnector.waitForReady() for TUI readiness polling before prompt delivery
 *
 * Session validation: name must match SESSION_NAME_REGEX.
 * "Session not found" is treated as empty string (ok('')) rather than an error --
 * the session may have exited between the liveness check and this call.
 */
```

---

### 3. Multi-Poll Success Test Lacks Attempt Verification

**File**: `tests/unit/implementations/tmux/wait-for-ready.test.ts:158`  
**Severity**: HIGH  
**Confidence**: 85%

**Problem**: The test "returns ok() after N polls when content threshold is met on the Nth attempt" asserts `result.ok` is true but does NOT verify that exactly 4 polls occurred (via `sessionManager.capturePaneContent` call count) or log context. The test would pass even if the implementation returned on the first poll due to a threshold bug. The equivalent "first poll" test (line 133) correctly verifies `logger.info` with `attempt: 1`, but this multi-poll test skips that assertion.

**Fix**: Add explicit attempt count verification:

```typescript
it('returns ok() after N polls when content threshold is met on the Nth attempt', async () => {
  // ... setup ...
  const result = await connector.waitForReady(handle, {
    initialDelayMs: 0,
    pollIntervalMs: 10,
    maxAttempts: 5,
    contentThreshold: 50,
  });
  
  expect(result.ok).toBe(true);
  // Verify exactly 4 polls were made before success
  expect(vi.mocked(sessionManager.capturePaneContent).mock.calls.length).toBe(4);
  expect(logger.info).toHaveBeenCalledWith(
    expect.objectContaining({ attempt: 4 })
  );
});
```

---

### 4. Missing Direct Unit Test for `capturePaneContent` Delegation

**File**: `tests/unit/implementations/tmux/wait-for-ready.test.ts` (file-level gap)  
**Severity**: HIGH  
**Confidence**: 82%

**Problem**: The PR adds `capturePaneContent(handle, lines?)` as a new public port method (tmux-connector.ts:386-388), but has no direct unit test verifying the delegation or parameter forwarding. The method is exercised indirectly via waitForReady polling, but never tests that `connector.capturePaneContent(handle, 20)` correctly calls `sessionManager.capturePaneContent('beat-task-xxx', 20)`. This is inconsistent with other delegation methods (sendKeys, sendControlKeys, isAlive, pasteContent) which have dedicated tests in tmux-connector.test.ts.

**Fix**: Add test for capturePaneContent delegation:

```typescript
it('capturePaneContent delegates to sessionManager and forwards lines param', () => {
  const { connector, sessionManager } = makeConnectorWithCapture(['some content']);
  const handle = makeHandle();
  
  const result = connector.capturePaneContent(handle, 20);
  
  expect(result.ok).toBe(true);
  expect(sessionManager.capturePaneContent).toHaveBeenCalledWith('beat-task-test', 20);
});
```

---

### 5. Initial Delay Doesn't Check Session Liveness

**File**: `src/implementations/tmux/tmux-connector.ts:404-450` (waitForReady method)  
**Severity**: HIGH  
**Confidence**: 82%

**Problem**: `waitForReady()` awaits the full `initialDelayMs` (default 1500ms) before entering the polling loop. If the session crashes immediately after spawn, the method sleeps 1.5 seconds before the first `isAlive()` check detects it. In the launchAndRegister path, the worker is already registered with timers running during this dead period. This is a 1.5s responsiveness loss on the common "immediate crash" scenario.

**Fix**: Add an early liveness check after the initial delay:

```typescript
await new Promise<void>((resolve) => {
  setTimeout(resolve, initialDelayMs);
});

// Early liveness check after initial delay -- catches immediate crashes
const earlyAlive = this.deps.sessionManager.isAlive(handle.sessionName);
if (!earlyAlive.ok || !earlyAlive.value) {
  return err(
    tmuxSessionFailed(
      'waitForReady',
      `session '${handle.sessionName}' died during initial TUI startup delay`,
    ),
  );
}

for (let attempt = 0; attempt < maxAttempts; attempt++) {
  // ... existing polling loop
```

---

### 6. Unnecessary `as string` Cast in Test Helper

**File**: `tests/unit/implementations/tmux/wait-for-ready.test.ts:106`  
**Severity**: MEDIUM  
**Confidence**: 82%

**Problem**: The expression `return ok(val as string)` uses an assertion cast rather than a type guard. The preceding `instanceof Error` check (line 103) should already narrow `val` to `string`, but the cast masks whether the narrowing is working. This violates the project's no-casts principle (prefer type guards over assertions).

**Fix**: Remove the cast and replace with an explicit type guard:

```typescript
// In makeConnectorWithCapture helper:
if (val instanceof Error) {
  return err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, val.message));
}
if (typeof val !== 'string') {
  return err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, 'unexpected capture value'));
}
return ok(val); // val is now narrowed to string, no cast needed
```

---

## Should-Fix Issues

### 1. `isAlive` Error Path Not Covered by Tests

**File**: `src/implementations/tmux/tmux-connector.ts:416` (waitForReady implementation)  
**Severity**: MEDIUM  
**Confidence**: 80%

**Problem**: The waitForReady implementation treats an `isAlive` error (`!aliveResult.ok`) the same as a dead session (`!aliveResult.value`), which is a reasonable fail-safe design. However, there is no test exercising the `isAlive` returning an error (only tests for `ok(true)` and `ok(false)`). The makeConnectorWithCapture helper only supports boolean values for isAliveValues, not errors.

**Fix**: Add a test for isAlive error case:

```typescript
it('returns err() when isAlive returns an error', async () => {
  const sessionManager = createMockTmuxSessionManagerCore();
  sessionManager.isAlive = vi.fn().mockReturnValue(
    err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, 'tmux has-session failed'))
  );
  
  const connector = new TmuxConnector({
    deps: { logger, sessionManager, /* ... */ },
  });
  
  const handle = makeHandle();
  const result = await connector.waitForReady(handle, {
    initialDelayMs: 0,
    pollIntervalMs: 10,
    maxAttempts: 2,
    contentThreshold: 50,
  });
  
  expect(result.ok).toBe(false);
});
```

---

### 2. Timeout Timer Starts Before `waitForReady` Completes

**File**: `src/implementations/event-driven-worker-pool.ts:707-727` (launchAndRegister method)  
**Severity**: MEDIUM  
**Confidence**: 80%

**Problem**: In `launchAndRegister()`, `setupTimeoutForWorker` (step 8) fires before `waitForReady` (step 9b). The worst-case waitForReady duration with defaults is 1500 + 20*500 = 11,500ms. A task with a short user-defined timeout (e.g., 15s) would have only ~3.5s of actual work time after the TUI becomes ready. The timeout timer measures "time since spawn" not "time since TUI ready", which could prematurely kill tasks with short timeouts.

**Fix**: Move `setupTimeoutForWorker` to execute after waitForReady succeeds:

```typescript
// Step 8: Setup heartbeat for the worker
this.setupHeartbeatForWorker(worker);

// Step 9: Start periodic output flushing (safe during initialization)
this.startFlushing(worker);

// Step 9b: Wait for TUI readiness
const readyResult = await this.tmuxConnector.waitForReady(handle);
if (!readyResult.ok) {
  // ... cleanup and error handling
}

// Step 9c: Setup timeout AFTER TUI is ready (so timeout measures work time, not init time)
this.setupTimeoutForWorker(worker);
```

---

## Pre-existing Issues (Informational)

### 9 npm Audit Vulnerabilities (Dev-Only)

**File**: `package-lock.json`  
**Severity**: MEDIUM  
**Confidence**: 95%

**Problem**: `npm audit` reports 9 vulnerabilities (3 critical, 1 high, 5 moderate) in dev dependencies (vitest ecosystem). These exist identically on main and are not introduced by this PR.

**Action**: Run `npm audit fix` in a separate patch release to keep this PR focused.

---

## Convergence Status (Cycle 1)

**First Review Cycle** - No prior resolutions to compare against.

**Cross-Reviewer Alignment**:
- **Architecture + Consistency + Reliability**: All three flag the missing waitForReady in reuseSession (82%, 65%, 65% confidence respectively) → **High confidence blocking issue**
- **Testing coverage**: Both testing and complexity reviewers flag the need for additional test coverage (85%, 82%) → **Clear gap**
- **Initial delay liveness**: Only reliability flagged this (82%), but it's a straightforward fix that addresses responsiveness

---

## Key Strengths

1. **Well-bounded polling**: `maxAttempts: 20` with configurable timeouts satisfies reliability principle (every loop has fixed upper bound)
2. **Session death detection**: Proper `isAlive()` checks at each poll iteration catch session crashes
3. **Best-effort timeout semantics**: Returns `ok(undefined)` on timeout rather than blocking, preventing indefinite hangs in slow environments
4. **Port abstraction respected**: New methods properly defined on TmuxConnectorPort interface; implementation delegates to session manager
5. **Async boundary correct**: launchAndRegister properly converted to async; single call site correctly awaits
6. **Mock contract complete**: MockTmuxConnector and createMockTmuxSessionManagerCore both updated with new methods

---

## Recommended Action Plan

1. **Fix stale JSDoc** (Consistency blocker) - Update 2 JSDoc blocks to document dual usage
2. **Add waitForReady to reuseSession OR document its omission** (Architecture blocker) - Either add the call or add DESIGN DECISION comment
3. **Fix test verification gaps** (Testing blockers) - Add attempt count verification to multi-poll test; add capturePaneContent delegation test
4. **Remove unnecessary cast** (TypeScript blocker) - Replace `as string` with explicit type guard
5. **Add early liveness check** (Reliability blocker) - Check session health after initial delay to catch immediate crashes
6. **Add isAlive error test** (Testing should-fix) - Cover the error path in waitForReady
7. **Move timeout timer** (Reliability should-fix) - setupTimeoutForWorker should fire after waitForReady succeeds

All 7 fixes are low-complexity, well-scoped changes. Recommended approach: single new commit addressing all issues, then re-review.

---

## Merge Gate: BLOCK

**Status**: Changes requested. Do not merge until all blocking issues are resolved. Follow up with incremental review cycle after fixes.
