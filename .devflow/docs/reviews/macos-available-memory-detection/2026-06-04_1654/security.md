# Security Review Report

**Branch**: macos-available-memory-detection -> main
**Date**: 2026-06-04T16:54

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**PATH-relative binary execution for vm_stat** - `src/utils/available-memory.ts:85`
**Confidence**: 82%
- Problem: `execFileSync('vm_stat', ...)` resolves `vm_stat` via the process PATH rather than using the absolute path `/usr/bin/vm_stat`. If a malicious `vm_stat` binary is placed earlier in PATH, it would be executed instead. This is a defense-in-depth concern -- exploitation requires the attacker to already have write access to a directory on PATH, which is a high prerequisite, but using the absolute path costs nothing and closes the vector entirely.
- Fix: Use the absolute path to the system binary:
  ```typescript
  const output = execFileSync('/usr/bin/vm_stat', [], { encoding: 'utf8', timeout: 5_000 });
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none -- no items in the 60-79% range)

## Positive Security Observations

The following security-positive patterns are worth noting:

1. **No shell execution**: Uses `execFileSync` (not `execSync`), which bypasses the shell entirely. No shell metacharacter injection is possible. This is the correct pattern.
2. **No user input in command**: The command name and arguments are hardcoded literals with an empty args array `[]`. There is zero user-controlled data flowing into the subprocess invocation.
3. **Timeout bound**: The 5-second timeout (`timeout: 5_000`) prevents the process from hanging indefinitely if `vm_stat` stalls.
4. **Graceful degradation**: All failure paths (exception, unparseable output, zero-page result) fall back to `os.freemem()` rather than throwing or returning unsafe values.
5. **Pure parser**: `parseVmStat` is a pure function with no I/O, using strict digit-only regex patterns (`\d+`) -- no dynamic code evaluation or unsafe parsing.
6. **Platform guard**: The darwin-specific code path is gated by `os.platform() !== 'darwin'`, so non-macOS platforms are completely unaffected.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The single MEDIUM finding (PATH-relative binary resolution) is a defense-in-depth hardening measure. The overall security posture of this change is strong: no shell execution, no user input in the command, proper timeout, and robust fallback handling. The condition for approval is using the absolute path `/usr/bin/vm_stat` to eliminate the theoretical PATH hijack vector.
