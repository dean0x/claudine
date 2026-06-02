# Regression Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Stale comment reference to "wrapper"** - `src/cli/commands/orchestrate-interactive.ts:264` (Confidence: 65%) — Line 264 comment says "the wrapper is now alive and ready" but should say "the setup shim is now alive and ready" or "the agent is now alive and ready". This is a documentation-level inconsistency, not a functional issue.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

### Migration Completeness

The removal of the wrapper pipeline is complete:

1. **Removed types**: `WrapperConfig`, `WrapperManifest`, `CommunicationMode` — zero remaining references in src/ or tests/.
2. **Removed methods**: `buildWrapperFlags()` (abstract + overrides in Claude/Codex adapters), `buildWrapperScript()`, `buildArgs()`, `buildInteractiveArgs()`, `generateWrapper()` — all removed with no dangling consumers.
3. **Removed CLI flags**: `--print`, `--output-format json`, `--output-format stream-json`, `--quiet` — no remaining references in source code.
4. **Barrel exports**: `WrapperConfig`, `WrapperManifest`, `CommunicationMode` removed from `tmux/index.ts`; `SetupShimConfig` and `SetupShimManifest` added.
5. **All consumers updated**: `TmuxConnector.spawn()` no longer branches between wrapper and setup shim paths. All sessions now follow the unified interactive (setup shim) path.

### Behavioral Equivalence

1. **Non-persistent (one-shot) tasks**: Previously used wrapper pipeline (`--print` mode). Now use interactive mode with Stop hook. Output capture is equivalent — the Stop hook writes the same `OutputMessage` JSON format that the wrapper script produced. Sentinel files (`.done`/`.exit`) are written by the Stop hook instead of the wrapper, using the same file format and atomic write pattern (`.tmp` + `mv`).

2. **Persistent (loop iteration) tasks**: Previously used setup shim with `--output-format stream-json`. Now use setup shim without `--output-format` — the Stop hook captures output per-turn instead of relying on stream-json format. The session lifecycle (park/reuse/destroy) is preserved and enhanced with `prepareForReuse()`.

3. **Usage/cost capture**: The Stop hook explicitly writes a synthetic `stdout` type message containing `{"type":"result","usage":...,"total_cost_usd":...}` (lines 97-112 of stop hook script). This matches the marker pattern that `UsageParser.parseClaudeUsage()` searches for via `combined.lastIndexOf('{"type":"result"')`. Prior resolution (cycle 2) verified.

4. **Interactive orchestrator**: Strips `AUTOBEAT_WORKER=true` from env, causing the Stop hook to exit immediately (line 4 guard). This is NOT a regression — the interactive orchestrator previously also did not use the wrapper pipeline for output capture. Exit detection relies on the staleness timer and tmux attach process exit, which is unchanged behavior.

5. **taskIdRef ordering**: Prior resolution (cycle 2) fixed ordering. In this PR, `taskIdRef.current` is set at Step 5 (line 437 in reuseSession) before `prepareForReuse()`, ensuring callbacks route correctly before any output can arrive. The redundant set in `reRegisterWorkerForReuse` (line 515) is harmless/idempotent.

### New Port Method: `prepareForReuse()`

Added to `TmuxConnectorPort` interface with proper JSDoc. The mock in `tests/fixtures/mocks.ts` is updated. All callers are covered by tests (`tmux-connector.test.ts` has a dedicated `prepareForReuse()` describe block).

### Deleted Test File

`tests/integration/tmux/hook-script-generation.test.ts` — 348 lines deleted. This tested the wrapper pipeline script generation (the `buildWrapperScript` function output). Since the wrapper pipeline is removed, this deletion is appropriate. The equivalent functionality (Stop hook script) has its own comprehensive test file: `tests/integration/tmux/stop-hook.test.ts` (927 lines).

### Cross-Cycle Awareness

Prior cycle 2 resolutions verified as maintained:
- Usage/cost capture regression: Fixed and verified — Stop hook preserves the `{"type":"result"}` marker pattern.
- taskIdRef ordering: Fixed and verified — ordering is explicit (set before prepareForReuse, before sendKeys).
