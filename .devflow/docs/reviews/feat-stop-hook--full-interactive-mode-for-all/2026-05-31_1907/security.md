# Security Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31
**Cycle**: 2 (incremental after cycle 1 resolved 17/18 issues)

## Cross-Cycle Awareness

Cycle 1 fixed 17 security-relevant issues including:
- Missing task ID regex validation on early-exit path (now fixed at line 33 of stop hook)
- Stdin read without size limit (now capped at 10MB via `head -c 10485760`)
- `configureAgentHook` throwing instead of returning Result (now returns `err()`)
- Orphaned `.tmp` on rename failure (now best-effort truncated)
- Path traversal prevention on `SESSIONS_DIR` (now checks `..`)

This cycle reviews the current state of the branch after those fixes.

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

- **Transcript path not validated against SAFE_PATH_REGEX** - `scripts/autobeat-stop-hook.sh:18` (Confidence: 65%) -- `TRANSCRIPT` is extracted from `jq -r '.transcript_path // empty'` and used with `tail -n 50 "$TRANSCRIPT"` without path validation (no `..` check, no regex). However, `transcript_path` is supplied by the agent CLI itself (trusted caller), not by the user, and the file is read-only via `tail`. The blast radius is limited to reading (not writing) an arbitrary file readable by the current user. Still, defense-in-depth would suggest validating or rejecting paths containing `..`.

- **STOP_REASON whitelist is permissive in the default case** - `scripts/autobeat-stop-hook.sh:85-88` (Confidence: 62%) -- The `case` statement allows any `STOP_REASON` value from jq in the default `*` branch, writing a `.exit` sentinel. The value itself is not embedded in any file or shell command (only the literal string `"1"` is written), so this is not an injection vector. However, validating `STOP_REASON` against a known set before the `case` would be stricter defense-in-depth.

- **ensureDir called before fileExists check** - `src/cli/commands/init.ts:134-135` (Confidence: 60%) -- `configureAgentHook` calls `deps.ensureDir(configDir)` unconditionally before checking if the config file exists. If the config directory does not exist (e.g., CLI not installed), the function creates it as a side effect. The caller `defaultConfigureHooks` already guards with `deps.fileExists(configDir)` and skips if absent, so this is unreachable in production. But `configureAgentHook` is exported and could be called directly by future callers without the guard.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Rationale

This PR demonstrates strong security posture across all changed files:

**Shell script (autobeat-stop-hook.sh)**:
- Task ID validated via regex (`^[a-z0-9][a-z0-9_-]*$`) -- line 33
- SESSIONS_DIR validated against path traversal (`..`) -- line 38
- Stdin capped at 10MB (`head -c 10485760`) -- line 8
- All file writes use atomic `.tmp` + `mv` pattern -- lines 43-44, 77-78, 82-84, 87-88
- No shell expansion risks: variables are double-quoted throughout; `jq` handles JSON parsing
- AUTOBEAT_WORKER env-var gate prevents execution outside managed sessions -- line 4

**Hook configuration (init.ts)**:
- Config paths hardcoded via `AGENT_HOOK_CONFIG_PATHS` -- no user-controlled paths
- Atomic writes with `.tmp` + rename -- lines 204-210
- Restrictive file permissions: `0o600` for config files, `0o700` for directories
- Idempotent: checks for existing hook before modification -- lines 161-174
- Backup created before first modification -- lines 181-189
- Disk errors return `err()` instead of throwing -- lines 206-219

**TmuxConnector (prepareForReuse)**:
- `initTaskDirectory` validates taskId via `TASK_ID_REGEX` and sessionsDir via `SAFE_PATH_REGEX`
- Duplicate taskId guard prevents orphaning existing watchers -- line 350
- Orphan cleanup on buildActiveSession failure -- line 396
- Session directories use `0o700` permissions

**Adapter changes (base-agent-adapter.ts, claude-adapter.ts, codex-adapter.ts)**:
- Removal of wrapper pipeline (`buildWrapperFlags`, `buildArgs`) reduces attack surface (fewer CLI args assembled)
- `--dangerously-skip-permissions` retained for Claude -- required for unattended operation, documented as intentional
- No new external inputs introduced; all removed code paths were strictly additive in surface area

**Prior cycle fixes verified in place**: All 17 fixes from cycle 1 are confirmed present in the current diff. The deferred item (reuseSession complexity) is architectural, not security.
