# Security Review Report

**Branch**: fix/fix-tmux-prompt-delivery-switch-from-sen -> main
**Date**: 2026-06-01
**PR**: #200

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

This PR switches all 4 prompt delivery sites from `sendKeys` (with trailing `\n`) to `pasteContent` + `sendControlKeys('Enter')`. The change is a correctness fix (applies ADR-004) with no new security surface introduced.

### Security Assessment

**1. Command Injection (OWASP A03)**
All changed code paths delegate to existing, already-hardened tmux methods:

- `pasteContent()` in `tmux-session-manager.ts:382-433` writes content to a temp file (UUID-named, in `os.tmpdir()`), loads it via `tmux load-buffer`, and pastes via `tmux paste-buffer`. The session name is validated against `SESSION_NAME_REGEX`, the temp file path is escaped via `escapeForSingleQuotes()`, and content never touches shell interpolation (it goes through a file, not a command argument). Content size is bounded by `MAX_PASTE_CONTENT_LENGTH` (256 KB).

- `sendControlKeys()` in `tmux-session-manager.ts:270-294` validates keys against a strict allowlist (`ALLOWED_CONTROL_KEYS` set: `C-c`, `C-d`, `C-z`, `C-\\`, `Enter`, `Escape`). Only `'Enter'` is used by this PR. The session name is validated against `SESSION_NAME_REGEX`. No shell injection is possible because the key token is checked before being interpolated.

- `sendKeys()` (still used for `/clear` command delivery) operates in `-l` (literal) mode with `escapeForSingleQuotes()` on the keys parameter and session name validation. The change from `'/clear\n'` to `'/clear'` (without the trailing newline) actually reduces the content sent through this path.

**2. Temp File Handling**
`pasteContent()` uses `crypto.randomUUID()` for temp file naming (collision-resistant) and cleans up via a `finally` block. No change to this mechanism in this PR.

**3. Error Handling**
All 4 delivery sites properly handle failure of both `pasteContent()` and the subsequent `sendControlKeys('Enter')` call independently, with appropriate cleanup (session destruction, worker state removal). The two-step approach introduces a window between paste and Enter where the prompt is in the buffer but not submitted -- on Enter failure, the session is destroyed, preventing a stale prompt from lingering.

**4. Atomicity Concern (pasteContent + Enter as two-step operation)**
The prior `sendKeys` approach delivered content and newline in a single call. The new approach is two calls (`pasteContent` then `sendControlKeys`). If the process crashes between the two calls, the prompt text is pasted into the tmux pane but never submitted. This is not a security issue -- it is a correctness concern at most, and the existing session liveness/heartbeat infrastructure would detect and clean up the stale session.

**5. No New Input Trust Boundaries**
The prompt content flowing through these paths originates from task definitions (already validated at the MCP adapter boundary via Zod schemas). No new user-facing input surfaces are introduced.

**6. Test Coverage**
Tests are updated to assert `pasteContent` + `sendControlKeys('Enter')` instead of `sendKeys`. The B1-2 failure path test now correctly tests `pasteContent` failure, and the Phase B ordering test verifies the correct call sequence including both new calls.
