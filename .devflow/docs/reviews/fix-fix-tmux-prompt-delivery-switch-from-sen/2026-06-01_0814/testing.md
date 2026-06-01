# Testing Review Report

**Branch**: fix-fix-tmux-prompt-delivery-switch-from-sen -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing test for sendControlKeys('Enter') failure in fresh spawn path (launchAndRegister)** - `tests/unit/implementations/event-driven-worker-pool.test.ts`
**Confidence**: 90%
- Problem: The production code in `event-driven-worker-pool.ts:723-732` adds a new failure branch where `sendControlKeys(handle, 'Enter')` can fail after a successful `pasteContent`. This triggers `cleanupWorkerState` + `destroySessionWithWarning` and returns an error. The existing test at line 369 (`cleans up when pasteContent fails after spawn`) only covers the `pasteContent` failure branch. There is no test for the `sendControlKeys('Enter')` failure branch, leaving a critical error handling path untested. This is a new code path introduced by this PR (applies ADR-004).
- Fix: Add a test that mocks `sendControlKeys` to fail on 'Enter' while `pasteContent` succeeds, then asserts: (1) result is not ok, (2) `destroy` is called, (3) worker count is 0:

```typescript
it('cleans up when sendControlKeys(Enter) fails after pasteContent in fresh spawn (step 10)', async () => {
  (tmuxConnector.sendControlKeys as ReturnType<typeof vi.fn>).mockReturnValueOnce(
    err(new AutobeatError(ErrorCode.TMUX_SEND_KEYS_FAILED, 'Enter failed')),
  );

  const task = buildTask();
  const result = await pool.spawn(task);

  expect(result.ok).toBe(false);
  expect(tmuxConnector.destroy).toHaveBeenCalled();
  expect(pool.getWorkerCount()).toBe(0);
});
```

**Missing test for sendControlKeys('Enter') failure after /clear in reuse path (prepareSessionForIteration)** - `tests/unit/implementations/event-driven-worker-pool.test.ts`
**Confidence**: 88%
- Problem: The production code in `event-driven-worker-pool.ts:405-414` introduces a new failure branch where `sendControlKeys(handle, 'Enter')` fails after successfully sending `/clear`. This triggers `cleanupPersistentSession` and returns `ok(null)`. There is no test covering this path. The existing `setEnvironment error` test covers a different failure within `prepareSessionForIteration`, but the new `clearEnterResult` branch is distinct and untested.
- Fix: Add a test that mocks `sendControlKeys` to succeed on the first call (from `pasteContent` setup) but fail when called with 'Enter' after `/clear`:

```typescript
it('reuseSession failure (sendControlKeys Enter after /clear) falls through to fresh spawn', async () => {
  const task1 = buildPersistentTask('loop-clear-enter', (f) => f.withPrompt('iter 1'));
  const task2 = buildPersistentTask('loop-clear-enter', (f) => f.withPrompt('iter 2'));

  await pool.spawn(task1);

  // sendControlKeys: first call (Enter after initial pasteContent) already succeeded.
  // For the reuse path: /clear sendKeys succeeds, but Enter after /clear fails.
  (tmuxConnector.sendControlKeys as ReturnType<typeof vi.fn>)
    .mockReturnValueOnce(err(new Error('Enter after clear failed')));

  const [spawnResult] = await Promise.all([pool.spawn(task2), vi.advanceTimersByTimeAsync(400)]);

  expect(spawnResult.ok).toBe(true);
  expect(tmuxConnector.spawn).toHaveBeenCalledTimes(2); // fell through to fresh spawn
});
```

**Missing test for sendControlKeys('Enter') failure after pasteContent in reuse path (reuseSession)** - `tests/unit/implementations/event-driven-worker-pool.test.ts`
**Confidence**: 88%
- Problem: The production code in `event-driven-worker-pool.ts:523-533` adds a new failure branch where `sendControlKeys(handle, 'Enter')` fails after `pasteContent(handle, prompt)` succeeds during session reuse. This triggers `cleanupWorkerState` + `cleanupPersistentSession` and returns `ok(null)`. The existing B1-2 test only covers `pasteContent` failure in the reuse path; this is a distinct error branch.
- Fix: Add a test analogous to B1-2 but for `sendControlKeys('Enter')` failure after successful `pasteContent` during reuse.

### MEDIUM

**Ordering test does not validate sendControlKeys('Enter') positions in the call sequence** - `tests/unit/implementations/event-driven-worker-pool.test.ts:1304-1348`
**Confidence**: 82%
- Problem: The test comment on line 1305-1306 describes the expected ordering as `sendKeys(/clear) -> sendControlKeys(Enter) -> [settle] -> prepareForReuse -> pasteContent(prompt) -> sendControlKeys(Enter)`, but the assertions on lines 1340-1348 only check 4 ordering constraints: `envIdx < clearIdx < prepareIdx < promptIdx`. The two `sendControlKeys(Enter)` calls are not validated in the ordering. The `sendControlKeys` mock pushes entries to `callOrder`, so the data is present but the test does not assert their positions. This means a regression where the Enter calls happen in the wrong order would not be caught.
- Fix: Add assertions for `sendControlKeys(Enter)` positions:

```typescript
const clearEnterIdx = callOrder.indexOf('sendControlKeys(Enter)');
expect(clearEnterIdx).toBeGreaterThan(clearIdx);
expect(prepareIdx).toBeGreaterThan(clearEnterIdx);

const promptEnterIdx = callOrder.lastIndexOf('sendControlKeys(Enter)');
expect(promptEnterIdx).toBeGreaterThan(promptIdx);
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Stale comments referencing "sendKeys" delivery in build-tmux-command tests (3 occurrences)**
**Confidence**: 85%
- `tests/unit/implementations/build-tmux-command.test.ts:139` — `// Prompt delivered via sendKeys`
- `tests/unit/implementations/build-tmux-command.test.ts:164` — `it('agentArgs does NOT contain the prompt text (delivered via sendKeys)'`
- `tests/unit/implementations/build-tmux-command.test.ts:310`, `:403` — same pattern
- Problem: These comments and test names reference the old `sendKeys` delivery mechanism. After this PR, prompt delivery uses `pasteContent + sendControlKeys('Enter')` per ADR-004. The comments are now misleading about the actual delivery mechanism. These tests were not modified in this PR so this is purely informational.
- Fix: Update comments and test names to reference `pasteContent` delivery. Fix in a follow-up PR.

## Suggestions (Lower Confidence)

- **No test coverage for orchestrate-interactive.ts prompt delivery change** - `src/cli/commands/orchestrate-interactive.ts:264-274` (Confidence: 70%) — The `spawnAndDeliverPrompt` function was changed from `sendKeys` to `pasteContent` + `sendControlKeys('Enter')`, but the interactive orchestrator test file (`tests/unit/interactive-orchestrator.test.ts`) does not directly test `spawnAndDeliverPrompt` — it tests higher-level orchestration flows. The function is not exported and is deeply coupled to tmux I/O, making it hard to unit test directly. This may be acceptable given that the lower-level `EventDrivenWorkerPool` tests cover the same mechanism, but the orchestrate-interactive path has distinct error handling (`failWith` pattern with `process.exit`).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The test updates correctly track the `sendKeys` -> `pasteContent` + `sendControlKeys('Enter')` migration (applies ADR-004), and the mock infrastructure (`createMockTmuxConnector`) already supports `pasteContent`. However, the two-step delivery mechanism introduces 3 new error branches (Enter failure in fresh spawn, Enter failure after /clear in reuse, Enter failure after paste in reuse) that have no test coverage. The existing tests only cover the first step (`pasteContent`) failure paths. Each of these branches has distinct cleanup logic (different combinations of `cleanupWorkerState` and `cleanupPersistentSession`), so they are not redundant with the tested paths. Additionally, the ordering test describes sendControlKeys(Enter) positions in its comment but does not assert them.
