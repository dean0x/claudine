# Consistency Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31T19:07:00Z
**Prior Resolutions**: Cycle 1 resolved 17/18 issues (1 deferred). This is Cycle 2.

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Stale "wrapper" terminology in error code JSDoc** - `src/core/errors.ts:105`
**Confidence**: 95%
- Problem: The `TMUX_HOOK_FAILED` error code JSDoc still reads `"Failed to generate wrapper script or create session directory"`. This PR renamed the wrapper pipeline to setup shim and removed all wrapper-related code, but the error code description was not updated.
- Fix: Update the JSDoc to match the new terminology:
  ```typescript
  /** Failed to generate setup shim or create session directory */
  TMUX_HOOK_FAILED = 'TMUX_HOOK_FAILED',
  ```

**Stale "wrapper" comments in orchestrate-interactive.ts (4 occurrences)** - `src/cli/commands/orchestrate-interactive.ts:103,246,247,250`
**Confidence**: 90%
- Problem: Four comments in the interactive orchestrator still reference "wrapper scripts" and "wrapper":
  - Line 103: `"which the wrapper scripts require"`
  - Line 246: `"creates the tmux window + wrapper"`
  - Line 247: `"output and exit signals from the wrapper"`
  - Line 250: `"Output captured by wrapper"`
  These are stale now that the wrapper pipeline has been replaced by the Stop hook + setup shim.
- Fix: Update the comments to reference "setup shim" and "Stop hook" respectively:
  ```
  Line 103: "which the Stop hook requires"
  Line 246: "creates the tmux window + setup shim"
  Line 247: "output and exit signals from the Stop hook"
  Line 250: "Output captured by Stop hook"
  ```

**Stale "wrapper" comment in tmux-hooks test** - `tests/unit/implementations/tmux/tmux-hooks.test.ts:54`
**Confidence**: 85%
- Problem: Comment reads `"independent of generateWrapper() tests"` but `generateWrapper()` has been removed and replaced by `generateSetupShim()`.
- Fix: Update to `"independent of generateSetupShim() tests"`.

**Stale "--output-format json" reference in usage-parser.ts** - `src/services/usage-parser.ts:7`
**Confidence**: 85%
- Problem: The usage-parser JSDoc states `"Claude spawns with --output-format json which appends a final result message"`. This PR removed `--output-format json` from the Claude adapter in favor of the Stop hook capturing output. The parser still works (it parses task output regardless of how it was captured), but the rationale comment is now misleading about how output is produced.
- Fix: Update the comment:
  ```
  * Rationale: The Stop hook writes result messages as JSON files. When Claude
  * emits a {"type":"result", ..., "usage": {...}, "total_cost_usd": ...} message,
  * the parser extracts usage data from the captured output.
  ```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No CRITICAL pre-existing issues found._

## Suggestions (Lower Confidence)

- **Section header comment in interactive-orchestrator test** - `tests/unit/interactive-orchestrator.test.ts:181` (Confidence: 65%) -- Comment `"Agent Adapter -- buildInteractiveArgs"` references the removed `buildInteractiveArgs` method. The section is empty (just a heading), so this is purely cosmetic.

- **`void agent` pattern in `defaultConfigureHooks`** - `src/cli/commands/init.ts:674` (Confidence: 60%) -- `void agent` is used to suppress unused-parameter warnings. The codebase elsewhere uses `_agent` prefix convention for intentionally-unused parameters (e.g., `_path` in `getSystemPromptConfig`). However, the function does reference `agent` in its JSDoc as "for future extensibility" so this may be an intentional style choice to keep the parameter name readable.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 4 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

This PR is an impressively consistent refactoring that removes the entire wrapper pipeline (-1,187 lines) and replaces it with a unified Stop hook + setup shim approach. The pattern changes are applied thoroughly:

1. **Type renames**: `WrapperConfig` -> `SetupShimConfig`, `WrapperManifest` -> `SetupShimManifest`, `wrapperPath` -> `shimPath` are consistent across all production types, interfaces, and barrel exports.

2. **State enum migration**: The `exited: boolean` -> `state: SessionState` transition is applied uniformly across all 8 guard sites in tmux-connector.ts (`handleMessageFile`, `onMessageFileChange`, `triggerExit`, `handleSentinel`, `runSharedStalenessCheck`, `destroy`, `dispose`, and the `flushPendingFiles` path).

3. **Method removal**: `buildWrapperFlags()`, `buildInteractiveArgs()`, `buildArgs()`, and `generateWrapper()` are removed from both implementations and all tests. Replacement `buildTmuxArgs()` is used consistently.

4. **Port extension**: `prepareForReuse()` is added to both `TmuxConnectorPort` (core interface) and `TmuxConnector` (implementation), with mock coverage in `createMockTmuxConnector`.

5. **Test coverage**: Tests are comprehensively updated -- wrapper-mode tests are either removed or rewritten as interactive-mode tests with assertion polarity flipped (e.g., `toContain('--print')` -> `not.toContain('--print')`).

The only consistency gap is stale "wrapper" terminology in comments and JSDoc across 4 files that were not part of the direct diff but reference concepts removed by this PR. These are non-blocking documentation-level issues (applies ADR-003 -- pre-existing doc gaps tracked separately).
