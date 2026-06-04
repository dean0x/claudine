# Dependencies Review Report

**Branch**: fix/wait-for-tui-readiness -> main
**Date**: 2026-06-04

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Lockfile bin section was out of sync with package.json** - `package-lock.json:24`
**Confidence**: 95%
- Problem: On `main`, `package.json` declares two bin entries (`beat` and `autobeat-stop-hook`) but `package-lock.json` only listed `beat`. This branch's loop auto-commit (ebab98b) ran `npm install` which synced the lockfile, adding the missing `autobeat-stop-hook` entry. The lockfile drift was pre-existing.
- Impact: Minimal in practice since npm resolves bin from `package.json`, but a drifted lockfile can cause `npm ci` to behave differently from `npm install` in CI environments.
- Note: This is now resolved by the change in this branch. No action needed.

### LOW

**npm audit reports 9 vulnerabilities (3 critical, 1 high, 5 moderate) — all pre-existing** - `package-lock.json`
**Confidence**: 95%
- Problem: `npm audit` shows vulnerabilities in transitive dependencies: `vitest` (critical — Vitest UI arbitrary file read, GHSA-5xrq-8626-4rwp), `fast-uri` (high — path traversal), `hono` (moderate — multiple), `ws` (moderate — uninitialized memory disclosure), `qs` (moderate — DoS), `ip-address` (moderate — XSS). All are present on `main` with identical counts.
- Impact: The `vitest`/`@vitest/ui`/`@vitest/coverage-v8` criticals are dev-only dependencies (not shipped to production). `fast-uri`, `hono`, `ws`, `qs`, `ip-address` are transitive dev dependencies. None affect the runtime package. `npm audit fix` reports all as fixable.
- Fix: Run `npm audit fix` in a separate PR to update transitive dev dependencies. Not blocking for this PR since no new dependencies were introduced.

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**Dependencies Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This branch introduces zero new runtime or dev dependencies. The only `package-lock.json` change is a single line adding the `autobeat-stop-hook` bin entry, which syncs the lockfile with the `package.json` that already declares it on `main`. The change was produced by a loop auto-commit running `npm install` (avoids PF-006 — the lockfile change is a side effect of the loop's `git add -A` sweep). All npm audit vulnerabilities are pre-existing and confined to dev-only transitive dependencies. The dependency tree is clean (`npm ls --depth=0` reports no issues) and `npm ci --dry-run` confirms lockfile-to-manifest consistency.
