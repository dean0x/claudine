# Regression Review Report

**Branch**: fix/fix-tmux-prompt-delivery-switch-from-sen -> main
**Date**: 2026-06-01T08:14

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Missing test coverage for sendControlKeys('Enter') failure paths (2 new branches)** -- Confidence: 85%
- `src/implementations/event-driven-worker-pool.ts:723-732` (launchAndRegister step 10)
- `src/implementations/event-driven-worker-pool.ts:523-533` (reuseSession step 8)
- Problem: The PR introduces new error-handling branches for `sendControlKeys('Enter')` failure after `pasteContent` succeeds. These are distinct from the `pasteContent` failure path (which IS tested). If `sendControlKeys('Enter')` fails, the worker state is cleaned up and the session destroyed -- but no test validates this path. The `pasteContent` failure test at line 369-382 only covers the first half of the two-step delivery.
- Fix: Add two tests: one in AC-6 for `launchAndRegister` (mock `sendControlKeys` to return `err` after `pasteContent` succeeds, verify cleanup + destroy + error result) and one for `reuseSession` (mock `sendControlKeys` to return `err` after `pasteContent` succeeds in the reuse path, verify fallthrough to fresh spawn + session destroy).

**Missing test coverage for sendControlKeys('Enter') failure after /clear** -- Confidence: 82%
- `src/implementations/event-driven-worker-pool.ts:405-414` (prepareSessionForIteration step 3)
- Problem: A new error-handling branch is introduced where `sendControlKeys('Enter')` after `/clear` can fail, triggering `cleanupPersistentSession` and returning `ok(null)` to fall through to fresh spawn. No test exercises this branch. The existing `/clear` failure test only covers the `sendKeys` failure, not the subsequent Enter failure.
- Fix: Add a test that mocks `sendControlKeys` to fail on the first call (the Enter after `/clear`) during persistent session reuse, and verify the session falls through to a fresh spawn.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### LOW

**Stale `sendKeys(prompt)` references in interface documentation (3 locations)** -- Confidence: 92%
- `src/core/tmux-types.ts:210` -- "and BEFORE sendKeys(prompt)" should reference `pasteContent(prompt)`
- `src/implementations/tmux/tmux-connector.ts:380` -- same stale comment
- `src/implementations/tmux/tmux-connector.ts:1036` -- "then sendKeys() to deliver the next prompt" should reference `pasteContent()`
- Problem: The second commit (9c0cb05) updated comments in `orchestrate-interactive.ts` and `event-driven-worker-pool.ts` but missed these 3 documentation comments in `tmux-types.ts` and `tmux-connector.ts`. These files were not changed in this PR. The comments now describe a pattern that no longer exists (applies ADR-004).
- Fix: Update all 3 comments to reference `pasteContent(prompt) + sendControlKeys('Enter')` in a follow-up commit or separate PR.

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

The migration is well-executed across all 4 stated delivery sites and aligns with ADR-004 (applies ADR-004). The commit message accurately describes the changes, and all existing tests pass (69/69). The `/clear` path correctly keeps `sendKeys` for the literal text and only adds `sendControlKeys('Enter')` for submission -- consistent with the distinction between literal text injection and keypress delivery.

The two MEDIUM blocking items are about missing test coverage for newly introduced error branches, not about incorrect behavior. The rollback/cleanup logic in these branches follows the same pattern as the tested `pasteContent` failure branch, so the risk of actual regression is low. However, since these are new branches in changed code with error-handling implications, they should be covered by tests.

No lost functionality, no changed return types, no removed exports, and no intent-vs-reality mismatch detected.
