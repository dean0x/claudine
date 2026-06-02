# Testing Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing jq-unavailable guard test in stop-hook integration tests** - `tests/integration/tmux/stop-hook.test.ts`
**Confidence**: 85%
- Problem: The stop hook script at line 6 has a `command -v jq >/dev/null 2>&1 || exit 0` guard. The old deleted test suite (`hook-script-generation.test.ts`) had a test "wrapper exits 127 when jq is not in PATH" that validated the jq-absent defense-in-depth guard. The new `stop-hook.test.ts` has no equivalent test. The script exits 0 (not 127) without jq, so the old test's exact assertion does not apply, but the behavioral coverage of "no jq = silent no-op" is missing.
- Fix: Add a test to `stop-hook.test.ts` that runs the hook with `PATH=/nonexistent` (or similar) to confirm the hook exits 0 and creates no files when jq is absent:
```typescript
it('exits 0 without creating files when jq is not available', () => {
  const sessionsDir = path.join(tmpDir, 'guard-no-jq');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const result = spawnSync('/bin/bash', [HOOK_SCRIPT], {
    input: codexPayload('hello'),
    encoding: 'utf8',
    env: {
      PATH: '/nonexistent',
      HOME: os.homedir(),
      AUTOBEAT_WORKER: 'true',
      AUTOBEAT_TASK_ID: 'task-jq',
      AUTOBEAT_SESSIONS_DIR: sessionsDir,
    },
  });

  expect(result.status).toBe(0);
  expect(fs.readdirSync(sessionsDir)).toHaveLength(0);
});
```

**Missing test for transcript-path content array type handling** - `tests/integration/tmux/stop-hook.test.ts`
**Confidence**: 82%
- Problem: The stop hook script lines 19-25 handle two content formats: when `message.content` is an array of `{type: "text", text: ...}` objects (concatenated via `join("")`), and when it is a plain string (`.message.content // ""`). The existing Claude path tests only exercise the array format. The string-content fallback (the `else` branch in the jq expression) is untested. If this jq path breaks, Claude transcripts with non-array content would silently produce empty responses.
- Fix: Add a test with a transcript where assistant message content is a plain string:
```typescript
it('handles transcript with plain string content (non-array format)', () => {
  const sessionsDir = path.join(tmpDir, 'claude-string-content');
  const taskId = 'task-str-content';
  const transcriptPath = path.join(tmpDir, 'transcript-string.jsonl');

  const lines = [
    JSON.stringify({
      role: 'assistant',
      message: { content: 'plain string response' },
    }),
  ];
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

  const payload = JSON.stringify({
    transcript_path: transcriptPath,
    stop_reason: 'end_turn',
  });
  const { taskDir } = runHook(payload, taskId, sessionsDir);
  const msg = readFirstMessage(taskDir);
  expect(msg.content).toBe('plain string response');
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Test for `RESPONSE_FROM_DIRECT` escaping difference is implicit** - `tests/integration/tmux/stop-hook.test.ts`
**Confidence**: 80%
- Problem: The stop hook has a critical branching path at lines 67-71 where `RESPONSE_FROM_DIRECT=true` means the response gets `jq -Rs .` escaping, while the transcript path does not. The special character tests (quotes, newlines, backslashes, etc.) all exercise the Codex/direct path via `codexPayload()`. None of the special character tests exercise the Claude/transcript path, which uses a different escaping strategy. If the transcript path's jq `join("")` output incorrectly escapes content in a way that differs from direct responses, this would not be caught.
- Fix: Add at least one special-character test via the Claude transcript path:
```typescript
it('handles special characters via transcript path', () => {
  const sessionsDir = path.join(tmpDir, 'special-transcript');
  const taskId = 'task-special-transcript';
  const transcriptPath = path.join(tmpDir, 'transcript-special.jsonl');

  const payload = claudePayload(transcriptPath, 'say "hello" with \\backslash');
  runHook(payload, taskId, sessionsDir);

  const msg = readFirstMessage(path.join(sessionsDir, taskId));
  expect(msg.content).toBe('say "hello" with \\backslash');
});
```

**Deleted wrapper pipeline tests have no replacement for communication target filtering** - `tests/unit/implementations/tmux/tmux-hooks.test.ts`
**Confidence**: 80%
- Problem: The old `generateWrapper()` tests included 7 tests for communication target embedding and security filtering (SESSION_NAME_REGEX validation, load-buffer/paste-buffer vs send-keys, broadcast mode). These tests were deleted with the wrapper pipeline. If any communication target logic remains in `tmux-hooks.ts` or was moved elsewhere, it has lost test coverage. If the logic was fully removed (per the PR description removing the wrapper pipeline), this is acceptable, but should be verified.
- Fix: Verify that no communication target logic remains in the production code. If it does, the tests need to be re-added for the new implementation.

## Pre-existing Issues (Not Blocking)

_No pre-existing CRITICAL issues found._

## Suggestions (Lower Confidence)

- **Missing edge case: empty `last_assistant_message` string** - `tests/integration/tmux/stop-hook.test.ts` (Confidence: 70%) -- The script checks `[ -n "$RESPONSE" ]` but an empty string `""` from `jq -r '.last_assistant_message // empty'` would be treated as empty. A test with `codexPayload('')` would clarify whether an empty string message falls through to the transcript path or writes an empty-content message.

- **No negative test for `configureAgentHook` with non-object JSON** - `tests/unit/cli-init.test.ts` (Confidence: 65%) -- `configureAgentHook` handles invalid JSON but does not test valid JSON that is not an object (e.g., a JSON array `[]` or a literal `"string"`). The function's behavior with `JSON.parse('[]')` is unclear.

- **Deleted integration test had stronger `bash -n` + execution coverage** - `tests/integration/tmux/stop-hook.test.ts` (Confidence: 68%) -- The old `hook-script-generation.test.ts` tested the generated wrapper end-to-end (write to disk, execute, check sentinels). The new stop-hook tests test the static script, which is better for the new architecture, but the setup shim (`generateSetupShim`) has no integration test that writes the shim and executes it with `bash`. The unit tests for `generateSetupShim` only check in-memory mock calls, not that the generated script actually runs.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Assessment

This PR demonstrates strong testing discipline. The test changes are architecturally sound:

1. **Test replacement strategy is excellent**: The deleted `hook-script-generation.test.ts` (348 lines of wrapper pipeline tests) is replaced by `stop-hook.test.ts` (651 lines) which tests the actual stop hook script against real filesystem operations. This is behavior-focused testing -- testing the contract rather than the implementation.

2. **New `configureAgentHook` tests are thorough**: 11 tests covering creation, merging, idempotency, backup, atomicity, error handling (invalid JSON, write failure, rename failure), and codex agent type. Error paths properly test `Result` types. `avoids PF-004` -- the rename failure test verifies `.tmp` cleanup, preventing orphaned state.

3. **`prepareForReuse` integration at worker-pool level is well-tested**: 3 new tests verify call ordering (setEnvironment -> /clear -> prepareForReuse -> sendKeys), failure fallthrough to fresh spawn, and correct task ID passing.

4. **`prepareForReuse` at connector level is well-tested**: 5 new tests cover registration, hooks.initTaskDirectory delegation, watcher restart, error propagation, and sequence number reset with `vi.waitFor` (replacing the flaky `setTimeout` pattern flagged in cycle 1 -- `avoids PF-005` by following up on prior resolution).

5. **Persistent session state machine tests are thorough**: 6 new tests for the `SessionState` enum covering parking behavior, destroy/cleanup suppression for persistent sessions, activeSessions removal on park, and staleness timer ignoring parked sessions.

The two HIGH findings are about test gaps where behavioral coverage from deleted tests was not carried forward to the new test suite.
