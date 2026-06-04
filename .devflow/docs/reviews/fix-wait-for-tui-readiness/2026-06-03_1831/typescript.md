# TypeScript Review Report

**Branch**: fix-wait-for-tui-readiness -> main
**Date**: 2026-06-03

## Issues in Your Changes (BLOCKING)

### MEDIUM

**`as string` cast bypasses type narrowing in test helper** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:106`
**Confidence**: 82%
- Problem: The expression `return ok(val as string)` uses an assertion cast rather than a type guard. After the `instanceof Error` check above (line 103), TypeScript should already narrow `val` to `string` via the `Array<string | Error>` union. If the narrowing is not working, the `as string` masks a real type issue. This violates the project Iron Law (`unknown` over `any` / prefer guards over casts).
- Fix: Remove the `as string` cast. After the `if (val instanceof Error)` branch returns, `val` is already narrowed to `string`:
```typescript
if (val instanceof Error) {
  return err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, val.message));
}
return ok(val);
```
If TypeScript does not narrow correctly due to the `captureValues[captureValues.length - 1]` assignment (which yields `string | Error | undefined`), add an explicit guard:
```typescript
if (typeof val !== 'string') {
  return err(new AutobeatError(ErrorCode.TMUX_SESSION_FAILED, 'unexpected capture value'));
}
return ok(val);
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing negative-value guards on WaitForReadyOptions numeric fields** - `src/core/tmux-types.ts:110-118` (Confidence: 65%) -- The interface fields `initialDelayMs`, `pollIntervalMs`, `maxAttempts`, and `contentThreshold` accept any `number`, including negatives and zero. While the implementation handles zero `initialDelayMs` (it becomes a no-op `setTimeout(..., 0)`), a negative `maxAttempts` would cause the for-loop to never execute, and a negative `contentThreshold` would match on the first poll unconditionally. Runtime validation at the top of `waitForReady()` (clamping or erroring on nonsensical values) would harden the boundary. Low priority since callers are internal.

- **`as unknown as TmuxSessionManagerPort` double-cast in test helper** - `tests/unit/implementations/tmux/wait-for-ready.test.ts:108` (Confidence: 62%) -- The `as unknown as TmuxSessionManagerPort` cast is used because the mock object literal does not satisfy every property of `TmuxSessionManagerPort`. This is a common test pattern but it silently allows the mock to drift from the real interface. Consider using `vi.mocked` or a `satisfies` assertion to get compile-time feedback when the interface changes.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The type safety of the production code is strong. The `WaitForReadyOptions` interface uses `readonly` modifiers correctly, the `Result<void, AutobeatError>` return types are consistent with the existing port pattern, and the async conversion of `launchAndRegister` correctly changes its return type from `Result<Worker>` to `Promise<Result<Worker>>` while the public `spawn()` method already returned `Promise<Result<Worker>>`. The `capturePaneContent` method was correctly added to both `TmuxSessionManagerCorePort` and `TmuxConnectorPort` with matching signatures. The one blocking issue is a minor cast in test code that should be removed.

Applies ADR-004 -- the PR correctly inserts `waitForReady()` between spawn and the `pasteContent + sendControlKeys('Enter')` delivery pattern, preserving the established prompt delivery mechanism.
