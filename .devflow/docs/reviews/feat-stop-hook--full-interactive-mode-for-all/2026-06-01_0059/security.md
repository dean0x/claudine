# Security Review Report

**Branch**: feat/stop-hook--full-interactive-mode-for-all -> main
**Date**: 2026-06-01

## Issues in Your Changes (BLOCKING)

### HIGH

**Transcript path traversal in stop hook** - `scripts/autobeat-stop-hook.sh:28`
**Confidence**: 82%
- Problem: The `TRANSCRIPT` variable is read from untrusted JSON input (`$HOOK_DATA`) via `jq -r '.transcript_path // empty'`. The subsequent check is `[ -f "$TRANSCRIPT" ]` followed by `tail -n 50 "$TRANSCRIPT"`, which reads content from any readable file path the hook data can dictate. While the hook only runs when `AUTOBEAT_WORKER=true` (which limits the attack surface to processes controlled by autobeat), a malicious or corrupted hook payload could point `transcript_path` at an arbitrary file (e.g. `/etc/shadow`, SSH keys) and expose its last 50 lines as the task "response" which is then written to the sessions directory where the orchestrator reads it.
- Impact: Potential information disclosure if an attacker can influence the JSON payload delivered to the hook's stdin. In practice the attack surface is narrow because the hook is invoked by Claude Code/Codex CLIs in a controlled tmux session, but the defense-in-depth principle is violated.
- Fix: Validate that the transcript path is within an expected prefix before reading it. For example:
  ```bash
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    # Only read transcripts from expected directories
    case "$TRANSCRIPT" in
      /tmp/claude-*|"$HOME"/.claude/*|"$HOME"/.codex/*)
        RESPONSE=$(tail -n 50 "$TRANSCRIPT" | jq -s '...' 2>/dev/null)
        ;;
      *)
        # Unexpected path — skip transcript fallback
        ;;
    esac
  fi
  ```

### MEDIUM

**`eval` on jq output — safe by construction but fragile** - `scripts/autobeat-stop-hook.sh:17`
**Confidence**: 80%
- Problem: `eval "$(printf '%s' "$HOOK_DATA" | jq -r '...' 2>/dev/null)" 2>/dev/null || true` uses `eval` to assign variables from jq output. The `@sh` filter in jq is the correct mechanism for this pattern and produces properly shell-quoted strings. However, if `jq` is replaced by a malicious binary on PATH (supply chain), or if jq has a bug in `@sh` escaping, the `eval` becomes an arbitrary code execution vector. The `|| true` means parse failures are silently swallowed rather than causing the hook to abort.
- Impact: Under normal conditions this is safe (jq `@sh` is well-tested). The concern is defense-in-depth: if jq ever emits unquoted output for a crafted input, `eval` would execute it. The `2>/dev/null || true` suppresses all diagnostics, making debugging difficult.
- Fix: Consider validating that the eval'd output only contains variable assignments before executing, or use an alternative extraction pattern that avoids eval entirely (e.g., separate jq invocations per field). At minimum, document this trust assumption explicitly:
  ```bash
  # SECURITY: @sh output from jq is shell-safe by design. If jq is compromised,
  # this eval is an arbitrary code execution vector. Acceptable because the hook
  # only runs inside autobeat-managed tmux sessions where PATH is controlled.
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stop hook runs with world-readable+executable permissions** - `scripts/autobeat-stop-hook.sh`
**Confidence**: 83%
- Problem: The script is committed with 755 permissions (`-rwxr-xr-x`). As an npm bin entry, npm will install it with whatever permissions the package has. The script itself does not contain secrets, but it processes sensitive data (agent output, usage costs) and writes to a controlled directory. While the generated setup shim and session directories use restrictive mode 0o700, the stop hook script installed globally via npm has no such restriction.
- Impact: Any local user can read the script (low concern — it is open source) and can technically invoke it, although the `AUTOBEAT_WORKER=true` guard and the need for a valid `AUTOBEAT_SESSIONS_DIR` prevent meaningful exploitation.
- Fix: This is acceptable for an npm bin entry since npm manages permissions per platform. No code change needed, but document in the script header that the security boundary is the environment variables, not file permissions.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Config file written at 0o600 but backup at default umask** - `src/cli/commands/init.ts:143`
**Confidence**: 81%
- Problem: `createDefaultHookConfigDeps()` writes config files with mode `0o600` (owner-only read/write) and creates directories with mode `0o700` (owner-only). However, the `backupIfNeeded()` function at line 143 calls `deps.writeFile(backupPath, original)` which uses the same 0o600 mode (correct). This is actually fine — the implementation does pass the right mode. No issue here upon closer inspection.

## Suggestions (Lower Confidence)

- **SESSIONS_DIR path traversal check is regex-only** - `scripts/autobeat-stop-hook.sh:48` (Confidence: 65%) — The `[[ "$SESSIONS_DIR" =~ \.\. ]] && exit 0` check rejects literal `..` anywhere in the string, which is a good basic guard. However, it does not canonicalize the path (no `realpath` check). A symlink-based traversal would bypass this. Low practical risk because SESSIONS_DIR is set by the setup shim from a validated `sessionsDir` value.

- **10MB stdin read without timeout** - `scripts/autobeat-stop-hook.sh:8` (Confidence: 62%) — `head -c 10485760` reads up to 10MB from stdin with no timeout. If the calling process hangs or sends data very slowly, the hook will block indefinitely. Claude Code and Codex fire hooks synchronously, so a blocked hook could stall the entire agent session. The bounded read size (10MB) prevents memory exhaustion but not indefinite blocking.

- **No integrity check on hook command name** - `src/cli/commands/init.ts:104` (Confidence: 60%) — The hook command `'autobeat-stop-hook'` is registered by name only. After installation, if an attacker places a malicious `autobeat-stop-hook` earlier in PATH, it would execute instead. This is a general PATH-injection concern that applies to all CLI tools and is not specific to this implementation.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The stop hook introduces a sound security model: environment-variable-gated execution, task ID regex validation, path traversal rejection for SESSIONS_DIR, proper single-quote escaping in the setup shim, atomic file writes, and restrictive directory permissions. The main concern is the transcript path read (line 28) which trusts the hook payload's `transcript_path` field without validating it is within an expected prefix. This should be addressed before merge to uphold the defense-in-depth principle documented in the codebase.

The `eval` usage with jq `@sh` is technically safe under normal operation but represents a fragility point worth documenting explicitly. The removal of the wrapper pipeline (-1,187 lines) reduces attack surface significantly by eliminating the stdout-piping architecture that previously processed untrusted agent output through shell pipelines.
