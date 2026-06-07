# Consistency Review Report

**Branch**: macos-available-memory-detection -> main
**Date**: 2026-06-04

## Issues in Your Changes (BLOCKING)

No blocking consistency issues found.

## Issues in Code You Touched (Should Fix)

No should-fix consistency issues found.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Inconsistent `os` module import style across codebase** - multiple files
**Confidence**: 85%
- Problem: The codebase mixes `import os from 'os'` (default import, 7 files including `config-validator.ts`) with `import * as os from 'os'` (namespace import, 4 files including `resource-monitor.ts` and the new `available-memory.ts`). Both are valid TypeScript for a CommonJS module, but the inconsistency is a minor style drift.
- Note: The new file matches its closest consumer (`resource-monitor.ts`), so this is not a regression. The inconsistency predates this PR.

### LOW

**Utility test files not included in any named test group** - `tests/unit/utils/`
**Confidence**: 90%
- Problem: The `tests/unit/utils/` directory (8 test files including the new `available-memory.test.ts`) is not included in any named `test:*` script in `package.json`. These tests only run via `test:unit` or `test:all` (both run all tests). Every other test directory has a named group for safe Claude Code execution.
- Note: Pre-existing gap -- all 7 prior util test files also lack a named group. Not introduced by this PR.

## Suggestions (Lower Confidence)

(none -- no findings in the 60-79% range)

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**Consistency Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This PR demonstrates strong consistency with established codebase patterns:

1. **Utility file structure**: New `src/utils/available-memory.ts` follows the single-responsibility, module-level JSDoc, exported-function pattern used by `process-liveness.ts`, `output.ts`, `session-sweep.ts`, and others.

2. **Barrel export**: Export added to `src/utils/index.ts` with a descriptive comment, matching the existing style exactly (comment line + named export line).

3. **Import from barrel**: Both consumers (`config-validator.ts`, `resource-monitor.ts`) import `getAvailableMemory` from `'../utils/index.js'` -- consistent with each other and establishing a clean pattern for this utility.

4. **`child_process` import**: Uses `import { execFileSync } from 'child_process'` with bare module specifier, matching the majority pattern (49 bare vs 16 `node:` prefixed imports). The PR description claims alignment with `git-state.ts` which uses `execFile` (async) -- the new file uses `execFileSync` instead, but this is intentional and documented in the JSDoc ("3 ms synchronous").

5. **DESIGN DECISION comment**: Module-level JSDoc explains the "why" thoroughly, consistent with the pattern in `process-liveness.ts`, `session-sweep.ts`, and `url-probe.ts`.

6. **Pure parser + IO wrapper**: `parseVmStat()` is pure (no side effects, testable without mocks) and `getAvailableMemory()` wraps it with IO -- this separation is a strong design pattern consistent with project philosophy.

7. **Test structure**: Test file follows existing patterns (vitest imports, describe blocks, module-level vi.mock, beforeEach/afterEach cleanup). The resource-monitor test mock addition is minimal and well-documented.

8. **Error handling**: Fallback to `os.freemem()` on any failure (try/catch without rethrowing) matches the project's "never throw in business logic" principle. The function signature returns `number` directly (not `Result`) because it can never fail -- it always has a fallback value. This is appropriate: `Result` types are for operations that can meaningfully fail, not for functions with guaranteed fallbacks. (applies ADR-007 principle -- fail-safe behavior matches the pattern of degrading gracefully rather than propagating errors that would block worker spawning)
