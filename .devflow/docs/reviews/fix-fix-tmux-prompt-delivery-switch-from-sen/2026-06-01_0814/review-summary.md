# Code Review Summary

**Branch**: fix-fix-tmux-prompt-delivery-switch-from-sen -> main
**Date**: 2026-06-01_0814
**Cycle**: 1

## Merge Recommendation: CHANGES_REQUESTED

This PR implements a critical correctness fix (applies ADR-004: tmux prompt delivery via `pasteContent` + `sendControlKeys('Enter')` instead of `sendKeys`). The change is architecturally sound and all existing tests pass. However, the two-step delivery mechanism introduces **3 new error-handling branches with missing test coverage** that must be addressed before merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** | 0 | 3 | 6 | 0 | **9** |
| **Should Fix** | 0 | 0 | 3 | 0 | **3** |
| **Pre-existing** | 0 | 0 | 3 | 1 | **4** |

---

## Blocking Issues (9 total — must fix before merge)

### HIGH SEVERITY (3 issues — test coverage)

**1. Missing test for sendControlKeys('Enter') failure in fresh spawn (launchAndRegister)**
- **Files**: `tests/unit/implementations/event-driven-worker-pool.test.ts`
- **Confidence**: 90%
- **Problem**: New failure path where `sendControlKeys('Enter')` fails after `pasteContent` succeeds is untested. Triggers `cleanupWorkerState` + `destroySessionWithWarning` + error return.
- **Fix Required**: Add test that mocks `sendControlKeys` to fail on 'Enter' while `pasteContent` succeeds, then assert result.ok is false, destroy is called, worker count is 0.
- **Reviewers**: Testing (HIGH 90%)

**2. Missing test for sendControlKeys('Enter') failure after /clear in reuse path (prepareSessionForIteration)**
- **Files**: `tests/unit/implementations/event-driven-worker-pool.test.ts`
- **Confidence**: 88%
- **Problem**: New failure branch where `sendControlKeys('Enter')` fails after `/clear` is untested. Triggers `cleanupPersistentSession` and falls through to fresh spawn.
- **Fix Required**: Add test mocking `sendControlKeys` to fail when called with 'Enter' after `/clear`, verify fallthrough to fresh spawn.
- **Reviewers**: Testing (HIGH 88%)

**3. Missing test for sendControlKeys('Enter') failure after pasteContent in reuse path (reuseSession)**
- **Files**: `tests/unit/implementations/event-driven-worker-pool.test.ts`
- **Confidence**: 88%
- **Problem**: New failure branch where `sendControlKeys('Enter')` fails after `pasteContent` during session reuse is untested. Triggers `cleanupWorkerState` + `cleanupPersistentSession`.
- **Fix Required**: Add test analogous to existing pasteContent failure test but for `sendControlKeys('Enter')` failure path.
- **Reviewers**: Testing (HIGH 88%), Regression (MEDIUM 82%)

### MEDIUM SEVERITY (6 issues — architecture, documentation, complexity)

**4. Non-atomic two-step prompt delivery creates a failure window**
- **Files**: `src/implementations/event-driven-worker-pool.ts:712-733`, `:512-533`, `src/cli/commands/orchestrate-interactive.ts:267-274`
- **Confidence**: 82%
- **Problem**: Split delivery (`pasteContent` + `sendControlKeys('Enter')`) is inherently non-atomic. If pasteContent succeeds but Enter fails, prompt text is pasted but never submitted. Mitigated by synchronous spawnSync calls and correct rollback logic in all sites.
- **Assessment**: Acceptable given ADR-004 mandate and synchronous nature. Documentation update needed (see #5 below).
- **Reviewers**: Architecture (MEDIUM 82%)

**5. Stale JSDoc in TmuxConnectorPort.prepareForReuse (and 2 other files)**
- **Files**: `src/core/tmux-types.ts:210`, `src/implementations/tmux/tmux-connector.ts:380`, `:1036`
- **Confidence**: 92% (architecture), 92% (regression)
- **Problem**: JSDoc still references old `sendKeys(prompt)` pattern. Contradicts ADR-004 decision and new production code using `pasteContent` + `sendControlKeys('Enter')`.
- **Fix Required**:
  - `src/core/tmux-types.ts:210`: Change "BEFORE sendKeys(prompt)" to "BEFORE pasteContent(prompt) + sendControlKeys('Enter')"
  - `src/implementations/tmux/tmux-connector.ts:380`: Same update
  - `src/implementations/tmux/tmux-connector.ts:1036`: Change "then sendKeys()" to "then pasteContent() + sendControlKeys('Enter')"
- **Reviewers**: Architecture (MEDIUM 88%), Regression (LOW 92% confidence but pre-existing)

**6. Stale JSDoc in spawnAndDeliverPrompt function**
- **Files**: `src/cli/commands/orchestrate-interactive.ts:191,194`
- **Confidence**: 92%
- **Problem**: JSDoc still references "send-keys" but function now uses `pasteContent` + `sendControlKeys('Enter')`.
- **Fix Required**: Update lines 191 and 194 to reference `pasteContent + Enter` instead of `send-keys`.
- **Reviewers**: TypeScript (MEDIUM 92%)

**7. TmuxHandle JSDoc lists sendKeys as primary consumer**
- **Files**: `src/core/tmux-types.ts:25`
- **Confidence**: 88%
- **Problem**: Comment reads "passed back to destroy/sendKeys/isAlive" but primary delivery now uses `pasteContent` and `sendControlKeys`.
- **Fix Required**: Update to "passed back to destroy/pasteContent/sendControlKeys/isAlive".
- **Reviewers**: Architecture (MEDIUM 88%)

**8. Ordering test does not validate sendControlKeys('Enter') positions**
- **Files**: `tests/unit/implementations/event-driven-worker-pool.test.ts:1304-1348`
- **Confidence**: 82%
- **Problem**: Test comment describes 6-step ordering but assertions only check 4 constraints. The two `sendControlKeys('Enter')` calls are not validated, so regressions in their ordering would not be caught.
- **Fix Required**: Add assertions for both Enter call positions (after /clear and after prompt paste).
- **Reviewers**: Testing (MEDIUM 82%)

**9. Duplicated error-handling blocks across 3 prompt delivery sites**
- **Files**: `src/implementations/event-driven-worker-pool.ts:512-533`, `:712-732`, `:405-414`
- **Confidence**: 82%
- **Problem**: Each of 3 sites has nearly identical `pasteContent` failure and `sendControlKeys('Enter')` failure blocks (6 blocks total). Cleanup logic is duplicated across all 6. Changes to cleanup semantics must be replicated everywhere.
- **Fix Required**: Extract `deliverPromptToSession(handle, prompt)` helper that encapsulates both calls and returns single Result. Reduces to 3 error blocks (one per site) and brings method lengths closer to 50-line guideline.
- **Reviewers**: Complexity (MEDIUM 82%)

---

## Should-Fix Issues (3 total — same file, context cleanup)

**10. prepareSessionForIteration exceeds 50-line guideline (67 lines)**
- **Files**: `src/implementations/event-driven-worker-pool.ts:375-442`
- **Confidence**: 80%
- **Problem**: Method is 67 lines (14 lines over 50-line guideline). Addition of separate `sendControlKeys('Enter')` error block pushed it past threshold.
- **Fix**: Addressed by #9 (helper extraction) which reduces ~10 lines.

**11. reuseSession exceeds 50-line guideline (79 lines)**
- **Files**: `src/implementations/event-driven-worker-pool.ts:466-545`
- **Confidence**: 80%
- **Problem**: 79 lines, well above guideline. Prompt delivery split added ~10 lines.
- **Fix**: Addressed by #9 (helper extraction).

**12. launchAndRegister near threshold (62 lines)**
- **Files**: `src/implementations/event-driven-worker-pool.ts:681-743`
- **Confidence**: 80%
- **Problem**: 62 lines, borderline above guideline. Separate error blocks inflate method.
- **Fix**: Addressed by #9 (helper extraction).

---

## Pre-existing Issues (4 total — informational)

**13. `/clear` uses sendKeys while prompts use pasteContent**
- **Files**: `src/implementations/event-driven-worker-pool.ts:395`
- **Confidence**: 65% (moved to suggestions by consistency reviewer)
- **Note**: Intentional design choice. `/clear` is a short fixed command without shell metacharacters; `sendKeys -l` is safe and appropriate. Not a regression.

**14-15. Stale comments in build-tmux-command tests (2 occurrences)**
- **Files**: `tests/unit/implementations/build-tmux-command.test.ts:139`, `:164`
- **Confidence**: 85%
- **Note**: Tests reference old "sendKeys" delivery mechanism. Fix in follow-up PR; these tests were not modified in this PR.

**16. event-driven-worker-pool.ts is 1301 lines**
- **Files**: `src/implementations/event-driven-worker-pool.ts`
- **Confidence**: 85%
- **Note**: Well above 500-line critical threshold. PR adds ~20 net lines only (not introduced by this change). Informational only.

---

## Convergence Status

| Reviewer | Score | Recommendation | Key Finding |
|----------|-------|-----------------|-------------|
| Architecture | 9/10 | APPROVED_WITH_CONDITIONS | ADR-004 applied cleanly; JSDoc stale refs need updates |
| Testing | 6/10 | CHANGES_REQUESTED | 3 new HIGH error branches untested + ordering assertion gap |
| Performance | 8/10 | APPROVED | 5x syscall overhead acceptable; non-hot path; documented |
| Reliability | 9/10 | APPROVED | ADR-004 fixes stalling bug; cleanup logic correct |
| Regression | 8/10 | APPROVED_WITH_CONDITIONS | Migration well-executed; 2 MEDIUM test coverage gaps |
| TypeScript | 9/10 | APPROVED_WITH_CONDITIONS | Types correct; 2 JSDoc stale refs need updates |
| Security | 9/10 | APPROVED | No new security surface; injection paths hardened |
| Complexity | 7/10 | APPROVED_WITH_CONDITIONS | Duplication pattern suggests helper extraction |
| Consistency | 9/10 | APPROVED | Uniform application across 4 sites; /clear distinction intentional |

**Convergence**: All 9 reviewers agree on the core fix (ADR-004 applied correctly). Blockers are **test coverage for new error branches** (3 HIGH tests) + **documentation updates** (4 JSDoc fixes) + **code deduplication** (helper extraction). No disagreement on safety or correctness.

---

## Action Items for Developer

### BLOCKING — Must complete before merge

1. **Add 3 missing error-path tests** (HIGH priority)
   - Test: sendControlKeys('Enter') failure after pasteContent in fresh spawn
   - Test: sendControlKeys('Enter') failure after /clear in reuse
   - Test: sendControlKeys('Enter') failure after pasteContent in reuse
   - Location: `tests/unit/implementations/event-driven-worker-pool.test.ts`

2. **Update stale JSDoc references** (MEDIUM priority)
   - File: `src/core/tmux-types.ts` lines 25, 210
   - File: `src/implementations/tmux/tmux-connector.ts` lines 380, 1036
   - File: `src/cli/commands/orchestrate-interactive.ts` lines 191, 194
   - Change: Replace `sendKeys(prompt)` / `send-keys` with `pasteContent` + `sendControlKeys('Enter')`

3. **Fix ordering test assertion gap** (MEDIUM priority)
   - File: `tests/unit/implementations/event-driven-worker-pool.test.ts:1340-1348`
   - Add: Two assertions validating sendControlKeys('Enter') call positions in sequence

### SHOULD-FIX — Recommended code quality improvements

4. **Extract deliverPromptToSession helper** (Optional but recommended)
   - Consolidates 6 duplicated error blocks into 3
   - Brings 3 methods into 50-line guideline compliance
   - Location: `src/implementations/event-driven-worker-pool.ts`

---

## Summary

This is a **necessary correctness fix** that unifies tmux prompt delivery across 4 call sites per ADR-004. The change eliminates a critical stalling bug where prompts were pasted but never submitted. All existing tests pass, architecture is sound, and error handling is thorough.

The 3 HIGH test coverage gaps are the only blockers — they represent new error-handling paths introduced by the two-step delivery mechanism that need validation. The documentation stale references (4 JSDoc comments) must be updated for accuracy and future maintainability.

Once these items are addressed, the PR is merge-ready.

---

## Next Steps

1. Add the 3 failing error-path tests
2. Update the 6 stale JSDoc references
3. Fix the ordering test assertion gap
4. (Optional) Extract the deliverPromptToSession helper for code quality
5. Re-run `npm run test:core && npm run test:handlers && npm run test:integration` to verify all tests pass
6. Resubmit for final validation
