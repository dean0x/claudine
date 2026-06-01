# Regression Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31
**Prior Resolution Cycles**: 1 (18 total issues, 17 fixed, 0 FP, 1 deferred)

## Issues in Your Changes (BLOCKING)

### HIGH

**Usage/cost data capture regression -- UsageParser depends on `--output-format json` fields no longer emitted** - `src/services/usage-parser.ts:7`
**Confidence**: 85%
- Problem: The `usage-parser.ts` module's doc comment and implementation expect Claude's `--output-format json` output containing `{"type":"result", "usage": {...}, "total_cost_usd": ...}`. The PR removes `--print` and `--output-format` flags from `ClaudeAdapter.buildTmuxArgs()` (line 22-24 of `claude-adapter.ts`). The new Stop hook (`autobeat-stop-hook.sh` line 76-78) writes `{"type":"result","content":...}` messages that contain only the response text -- no `usage` or `total_cost_usd` fields. The parser will find the `{"type":"result"` marker but then fail field validation (lines 84-105 of `usage-parser.ts`) and return `null`. The `UsageCaptureHandler` handles this gracefully (logs a warning), so there is no crash, but cost/token tracking for ALL tasks will silently stop producing data. The `task_usage` table will stop receiving new rows.
- Impact: Loss of token/cost observability for all tasks. Dashboard metrics depending on `task_usage` data will show no new entries. This is not a crash but a functional regression in the usage tracking feature introduced in v1.4.0.
- Fix: The Stop hook should extract and forward the `usage` and `total_cost_usd` fields from the hook stdin payload (`HOOK_DATA`) into the result message JSON. Claude Code's Stop hook data includes these fields. Alternatively, update `usage-parser.ts` to parse usage data from the hook payload separately from the response content. The stale doc comment at line 7 should also be updated.

### MEDIUM

**Stale doc comment in usage-parser.ts references removed `--output-format json` flag** - `src/services/usage-parser.ts:7`
**Confidence**: 92%
- Problem: Line 7 states "Claude spawns with --output-format json" but this PR removes that flag. The comment is now incorrect documentation that will mislead future developers.
- Fix: Update the Rationale comment to reflect the new architecture: output is captured via the Stop hook, and the parser searches for usage data in the captured output messages. (Note: this fix should be combined with the functional fix above.)

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Stale comment in orchestration-manager.ts references `claude --print`** - `src/services/orchestration-manager.ts:172`
**Confidence**: 90%
- Problem: Line 172 says "workers run as `claude --print`" but this PR removes `--print` from all spawn paths. The comment is in an unchanged file but is now inaccurate.
- Fix: Update to: "workers run as interactive REPL sessions (output captured via Stop hook)" or similar.

## Suggestions (Lower Confidence)

- **Deleted test file not fully replaced** - `tests/integration/tmux/hook-script-generation.test.ts` (Confidence: 65%) -- The deleted file had 348 lines of integration tests for the wrapper script including jq-missing detection (exit 127), multi-line sequence numbering, and special character escaping. The new `stop-hook.test.ts` (651 lines) covers most of these scenarios for the stop hook instead, but the jq-missing test specifically tests the setup shim / wrapper behavior, not the stop hook. The stop hook silently exits 0 when jq is missing (line 6 of the script), which is correct behavior for a hook, but may differ from the old wrapper's explicit 127 exit. This may be intentional but is worth confirming.

- **`CommunicationMode` type reference in tmux/types.ts comment** - `src/implementations/tmux/types.ts:9` (Confidence: 60%) -- The comment on line 9 still lists `CommunicationMode` among "internal or self-documenting types" but this type was removed from this file. The comment is only a naming convention note and has no functional impact.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

### Regression Checklist

- [x] No exports removed without deprecation -- removed exports (`WrapperConfig`, `WrapperManifest`, `CommunicationMode`, `generateWrapper`, `buildWrapperFlags`, `buildInteractiveArgs`, `buildArgs`) are internal implementation types with no external consumers. The `tmux/index.ts` barrel export was updated. No callers remain in the codebase.
- [x] Return types backward compatible -- `buildTmuxCommand()` return shape unchanged; `prompt` field now always contains the prompt text (was empty in wrapper mode). Consumers (WorkerPool) already handled non-empty prompts correctly.
- [x] Default values unchanged or documented -- `persistent` flag semantics documented: controls session lifecycle (park vs destroy), no longer affects CLI arg generation.
- [x] Side effects preserved -- `onOutput`, `onExit` callbacks preserved. Sentinel files (`.done`, `.exit`) still written (now by Stop hook instead of wrapper). Staleness detection updated to skip parked sessions.
- [x] All consumers of changed code updated -- `EventDrivenWorkerPool`, `TmuxConnector`, adapters all updated consistently.
- [x] Migration complete across codebase -- grep confirms no remaining references to removed APIs in source code.
- [x] CLI options preserved -- no CLI option changes.
- [x] API endpoints preserved -- MCP tools unchanged.
- [x] Commit message matches implementation -- PR description accurately describes the wrapper-to-stop-hook migration.
- [ ] **Breaking changes documented** -- Usage/cost data regression not documented. The `usage-parser.ts` is functionally broken by this change (returns null for all tasks) though it degrades gracefully without crashes.

### Key Regression Observations

1. **Wrapper pipeline removal is clean**: The removal of `generateWrapper`, `buildWrapperScript`, `WrapperConfig`, `WrapperManifest`, `buildCommunicationBlock`, `NEXT_SEQ_FN`, and related code is thorough. No orphaned references remain. The `--print` and `--quiet` flags are correctly removed from both `ClaudeAdapter` and `CodexAdapter`.

2. **SessionState enum is a safe replacement for boolean `exited`**: The `'active' | 'parked' | 'exited'` enum correctly captures the three-state lifecycle. All guards that previously checked `session.exited` now check `session.state !== 'active'`, which is semantically equivalent for both the old `exited=true` and the new `'parked'` state.

3. **`prepareForReuse()` integration is correctly sequenced**: The method is called AFTER `setEnvironment` and the 300ms settle delay, and BEFORE `sendKeys(prompt)`, ensuring watchers are ready before output arrives. The method is properly guarded against duplicate taskIds and cleans up on failure.

4. **Test coverage is comprehensive**: 651 lines of new stop-hook integration tests plus expanded unit tests for `configureAgentHook`, `prepareForReuse`, and updated `buildTmuxCommand` assertions. The deleted wrapper test file (348 lines) is fully replaced by stop-hook tests covering equivalent scenarios.

5. **Mock fixture updated**: `createMockTmuxConnector` in `tests/fixtures/mocks.ts` includes `prepareForReuse` mock, preventing test failures from the new port method.
