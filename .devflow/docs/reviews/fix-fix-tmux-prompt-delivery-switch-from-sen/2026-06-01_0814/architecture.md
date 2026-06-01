# Architecture Review Report

**Branch**: fix-fix-tmux-prompt-delivery-switch-from-sen -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Non-atomic two-step prompt delivery creates a failure window** - `src/implementations/event-driven-worker-pool.ts:712-733` (launchAndRegister), `src/implementations/event-driven-worker-pool.ts:512-533` (reuseSession), `src/cli/commands/orchestrate-interactive.ts:267-274` (spawnAndDeliverPrompt)
**Confidence**: 82%
- Problem: The change splits prompt delivery from a single `sendKeys(prompt + '\n')` call into two calls: `pasteContent(prompt)` followed by `sendControlKeys(handle, 'Enter')`. If `pasteContent` succeeds but `sendControlKeys('Enter')` fails, the prompt text is pasted into the TUI but never submitted. In `launchAndRegister()`, this leaves a spawned session with visible prompt text that will never execute. In `reuseSession()`, the same gap exists. Each call site handles the error by cleaning up and destroying the session, which is correct rollback behavior. However, there is no mechanism to verify that the pasted content was not partially processed or that the buffer was cleaned before destruction. This is mitigated by the fact that both calls are synchronous `spawnSync` under the hood (tmux CLI calls), making the window between them negligible in practice. The rollback paths are correctly implemented in all 4 call sites.
- Fix: The current rollback approach (destroy session on Enter failure) is architecturally sound. Consider documenting this as a known two-phase delivery contract in the `TmuxConnectorPort` interface — a `deliverAndSubmit(handle, content)` composite method could encapsulate this pattern, but the added abstraction may not justify the complexity given the synchronous nature of both calls. No code change required unless the team wants to consolidate.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale JSDoc in TmuxConnectorPort.prepareForReuse references sendKeys(prompt)** - `src/core/tmux-types.ts:210`
**Confidence**: 92%
- Problem: The `prepareForReuse` method's JSDoc says "and BEFORE sendKeys(prompt) so watchers are ready before any output arrives." After this PR, prompt delivery uses `pasteContent` + `sendControlKeys('Enter')`, not `sendKeys`. The comment is now inaccurate and contradicts the ADR-004 decision. This same stale reference appears in `src/implementations/tmux/tmux-connector.ts:380` and `src/implementations/tmux/tmux-connector.ts:1036`.
- Fix: Update the 3 stale comments:
  - `src/core/tmux-types.ts:210`: `"and BEFORE pasteContent(prompt) + sendControlKeys('Enter') so watchers are ready before any output arrives."`
  - `src/implementations/tmux/tmux-connector.ts:380`: same update
  - `src/implementations/tmux/tmux-connector.ts:1036`: change `"then sendKeys() to deliver the next prompt"` to `"then pasteContent() + sendControlKeys('Enter') to deliver the next prompt"`

**TmuxHandle JSDoc still lists sendKeys as a consumer method** - `src/core/tmux-types.ts:25`
**Confidence**: 88%
- Problem: The TmuxHandle interface comment reads "Returned from TmuxConnectorPort.spawn(); passed back to destroy/sendKeys/isAlive." After this PR, the primary prompt delivery path uses `pasteContent` + `sendControlKeys`, not `sendKeys`. `sendKeys` is still used for `/clear` but is no longer the primary consumer-facing method for prompt delivery.
- Fix: Update to: `"Returned from TmuxConnectorPort.spawn(); passed back to destroy/pasteContent/sendControlKeys/isAlive."`

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`/clear` still uses sendKeys (literal mode) while prompts use pasteContent** - `src/implementations/event-driven-worker-pool.ts:395`
**Confidence**: 65% (moved to Suggestions -- see below)

## Suggestions (Lower Confidence)

- **Mixed delivery mechanisms for `/clear` vs prompts** - `src/implementations/event-driven-worker-pool.ts:395` (Confidence: 65%) -- `/clear` is still sent via `sendKeys` + `sendControlKeys('Enter')` while prompts use `pasteContent` + `sendControlKeys('Enter')`. This is likely intentional (short fixed string vs long variable-length content), but the inconsistency means two distinct code patterns for "send text to TUI and press Enter." A helper method could unify both, though the simplicity of `/clear` may not warrant it.

- **`sendKeys` method retained on `TmuxConnectorPort` interface** - `src/core/tmux-types.ts:170` (Confidence: 60%) -- After this PR, `sendKeys` is only used for `/clear` in the worker pool. The method remains on the port interface without deprecation annotation. If the project wants to signal that `pasteContent` is the preferred delivery mechanism per ADR-004, a `@deprecated` JSDoc tag on `sendKeys` would make the intent visible to future contributors.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

This PR implements a clean, well-scoped architectural change that unifies tmux prompt delivery across all 4 call sites to use `pasteContent` + `sendControlKeys('Enter')`, consistent with the established pattern in `channel-manager.ts` (applies ADR-004). The change respects the existing layering: core-layer consumers (`EventDrivenWorkerPool`, `orchestrate-interactive.ts`) continue to interact with `TmuxConnectorPort` methods without implementation knowledge. Error handling is thorough -- every new call site checks the `Result` from both `pasteContent` and `sendControlKeys`, with proper rollback (destroy session, cleanup worker state) on failure.

The one blocking MEDIUM is informational rather than risky -- the two-phase delivery is inherently non-atomic, but the synchronous nature of `spawnSync`-based tmux calls and the correct rollback logic in all paths make this acceptable. The should-fix items are stale documentation that should be updated to maintain consistency with ADR-004.

**Conditions for merge**: Update the 4 stale JSDoc references to `sendKeys(prompt)` in `tmux-types.ts` and `tmux-connector.ts` to reflect the new `pasteContent` + `sendControlKeys('Enter')` delivery pattern. These are documentation-only changes.
