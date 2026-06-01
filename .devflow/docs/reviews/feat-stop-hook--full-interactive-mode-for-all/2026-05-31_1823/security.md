# Security Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-05-31

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing CURRENT_TASK_ID validation on early-exit path in stop hook** - `scripts/autobeat-stop-hook.sh:24-34`
**Confidence**: 85%
- Problem: When `RESPONSE` is empty (lines 24-35), the script reads `CURRENT_TASK_ID` from the tmux environment or the `AUTOBEAT_TASK_ID` env var and uses it directly in a path (`$SESSIONS_DIR/$CURRENT_TASK_ID`) without the regex validation (`^[a-z0-9][a-z0-9_-]*$`) that is applied on the main path at line 43. A malicious or malformed task ID containing path traversal sequences (e.g., `../../etc`) would bypass the validation and write `.exit` to an arbitrary directory.
- Fix: Add the same validation check before using CURRENT_TASK_ID on the early-exit path:
```bash
if [ -z "$RESPONSE" ]; then
  TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
  CURRENT_TASK_ID=$(tmux show-environment -t "$TMUX_SESSION" AUTOBEAT_TASK_ID 2>/dev/null | cut -d= -f2-)
  [ -z "$CURRENT_TASK_ID" ] && CURRENT_TASK_ID="${AUTOBEAT_TASK_ID:-}"
+ [[ "$CURRENT_TASK_ID" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 0
  SESSIONS_DIR="${AUTOBEAT_SESSIONS_DIR:-}"
+ [ -z "$SESSIONS_DIR" ] && exit 0
+ [[ "$SESSIONS_DIR" =~ \.\. ]] && exit 0
  if [ -n "$CURRENT_TASK_ID" ] && [ -n "$SESSIONS_DIR" ]; then
    TASK_DIR="$SESSIONS_DIR/$CURRENT_TASK_ID"
    mkdir -p "$TASK_DIR"
    echo "1" > "$TASK_DIR/.exit.tmp"
    mv "$TASK_DIR/.exit.tmp" "$TASK_DIR/.exit"
  fi
  exit 0
fi
```

### MEDIUM

**Stop hook reads from stdin without size limit** - `scripts/autobeat-stop-hook.sh:8`
**Confidence**: 80%
- Problem: `HOOK_DATA=$(cat)` reads the entire stdin into a shell variable with no upper-bound check. If the calling CLI delivers a very large payload (e.g., a large transcript embedded in `.last_assistant_message`), this can exhaust memory or cause the hook to hang. While the caller (Claude Code/Codex CLI) is trusted, a defense-in-depth approach would cap the input.
- Fix: Consider limiting the read to a reasonable maximum (e.g., 10MB):
```bash
HOOK_DATA=$(head -c 10485760)
```
  Alternatively, if the CLIs guarantee bounded payloads, document this assumption with a comment.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **SESSIONS_DIR path validation regex is minimal** - `scripts/autobeat-stop-hook.sh:48` (Confidence: 65%) — The `..` check rejects literal `..` anywhere in the path but does not handle URL-encoded or symlink-based traversal. In practice the env var comes from the trusted shim (line 73 of tmux-hooks.ts), so this is low-risk, but a stricter absolute-path assertion (`[[ "$SESSIONS_DIR" == /* ]]`) would be more robust.

- **Hook config writes to user home directory without confirming ownership** - `src/cli/commands/init.ts:92-94` (Confidence: 62%) — `AGENT_HOOK_CONFIG_PATHS` resolves to `~/.claude/settings.json` and `~/.codex/hooks.json`. On shared systems or when HOME is overridden, this could write to unintended locations. The `mode: 0o600`/`0o700` mitigates exposure, but a HOME-is-expected-user check would add defense-in-depth.

- **Backup file (.bak) not permission-restricted to 0o600** - `src/cli/commands/init.ts:183-185` (Confidence: 60%) — The backup write uses the same `deps.writeFile` (mode 0o600), which is correct. However if the original file had broader permissions, the backup atomically replaces the content without adjusting the original's perms. Not a real issue given the implementation always writes fresh with 0o600.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The overall security posture of this PR is strong. The existing patterns (SAFE_PATH_REGEX validation, singleQuoteToken escaping, TASK_ID_REGEX enforcement, FILE_MODE 0o700/0o600, atomic writes via tmp+rename) are well-maintained through the refactoring. The new `configureAgentHook` function uses proper file permissions and atomic writes. The removal of the wrapper pipeline eliminates an entire class of shell-injection surface area (the old `buildWrapperScript` with embedded agent output piping).

The one HIGH finding (missing task ID validation on the early-exit path of the stop hook) is a straightforward fix that should be addressed before merge — it is an inconsistency where the main code path validates but the error/empty-response path does not.
