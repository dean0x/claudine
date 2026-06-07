<!-- TL;DR: 9 decisions. Key: ADR-005, ADR-006, ADR-007, ADR-008, ADR-009 -->
# Architecture Decision Records

Explicit design choices and trade-offs made during development.

## ADR-001: Channel name validation constrained to tmux SESSION_NAME_REGEX compatibility

- **Context**: Channel domain design for Phase 6 of tmux migration epic — channels map directly to tmux sessions
- **Decision**: `CHANNEL_NAME_REGEX` is constrained to be a subset of tmux `SESSION_NAME_REGEX` so channel names can be used as tmux session names without transformation
- **Rationale**: Avoids a separate sanitization/mapping step and keeps channel-to-session name derivation deterministic and collision-free. Any valid channel name is a valid tmux session name by construction.
- **Status**: Active
- **Source**: sidecar:obs_b8e1d6

## ADR-002: Greptile code review false positives dismissed with explicit reply explanations

- **Context**: PR review resolution cycle with automated Greptile review comments (2x P1, 2x P2)
- **Decision**: False positives and intentional design choices receive explicit reply comments rather than being silently closed or ignored
- **Rationale**: Keeps the review thread auditable, documents reasoning for anyone reading the PR later, and prevents the same issues being re-raised in future review cycles. The 300ms hardcoded wait in the tmux worker path was specifically documented as intentional (no feedback signal available).
- **Status**: Active
- **Source**: sidecar:obs_c3d9e5

## ADR-003: Pre-existing design gaps found during PR review are tracked as GitHub issues rather than fixed in-scope

- **Context**: PR #193 (channel service layer) — Greptile surfaced a P1 about recovered tmux sessions having no output callbacks, a limitation in `TmuxConnectorPort` that predates the PR
- **Decision**: Pre-existing gaps not introduced by the current PR are replied to with an explanation and tracked as a GitHub issue (e.g. #194) rather than fixed in-scope
- **Rationale**: Keeps PR scope bounded and avoids scope creep on already-large feature PRs. A GitHub issue provides a durable record that a reply comment alone would not — it cannot be forgotten and can be prioritized, assigned, and referenced in future work.
- **Status**: Active
- **Source**: sidecar:obs_e2c7b3

## ADR-004: tmux prompt delivery uses pasteContent + sendControlKeys('Enter'), not sendKeys -l with \n suffix

- **Context**: Stop hook / full interactive mode implementation — autobeat spawns tmux sessions to run Claude Code and Codex; prompts must be delivered and submitted
- **Decision**: Deliver prompts via `pasteContent` (tmux load-buffer/paste-buffer) followed by a separate `sendControlKeys('Enter')` call — never via `sendKeys -l` with a trailing `\n`
- **Rationale**: `tmux send-keys -l` runs in literal mode, which sends `\n` as the raw byte `0x0A` into the TUI's input buffer, not as an Enter keypress. The TUI receives the prompt text but never submits it. Using `pasteContent` + `sendControlKeys('Enter')` (without `-l`) sends the literal prompt safely and then fires the actual key binding for submission. This pattern was already established in `channel-manager.ts:968-983` — the fix unified all delivery sites to use the same mechanism.
- **Status**: Active
- **Source**: sidecar:2e5714e4

## ADR-005: Code review convergence is judged by issue nature, not issue count

- **Context**: 3 rounds of code review on the stop hook PR produced issue counts of 18 → 22 → 20 — not converging by count
- **Decision**: Stop iterating code review cycles when the *nature* of findings converges to marginal improvements (documentation accuracy, `satisfies` annotations, minor extractions) with zero regressions from prior cycle's fixes — regardless of whether the raw count has decreased
- **Rationale**: Issue count is a noisy signal; LLM reviewers are stochastic and will always find something. The meaningful signal is: (1) zero regressions from the most recent fix cycle, (2) remaining issues are hardening/polish rather than correctness gaps, (3) prior regression reviewer gave APPROVED. Stopping at this point avoids diminishing-returns churn while ensuring safety and correctness.
- **Status**: Active
- **Source**: sidecar:36c1ccff

## ADR-006: CI formatting/linting failures are caught pre-push with biome check; not post-push via CI failure

- **Context**: PR #198 CI failed on a biome formatting issue (ternary layout); required an extra push to fix
- **Decision**: Run `npm run check` (biome format+lint) locally before committing and pushing to avoid a CI round-trip for cosmetic failures
- **Rationale**: Biome formatting is deterministic and can always be validated locally. A CI failure for a formatting issue burns time on a round-trip push+wait cycle that adds no value. The pattern is already established in the project (`biome check --write` or `npm run check`).
- **Status**: Active
- **Source**: sidecar:17a3b878

## ADR-007: Run mode must await recovery synchronously before bootstrap() returns

- **Context**: PR #201 — `beat run` delegates a task immediately after `bootstrap()` returns. Recovery was fire-and-forget, so Phase 0 built a stale tmux session snapshot before the new worker spawned; Phase 3 checked that snapshot, found the session missing, and marked the freshly-spawned task as FAILED.
- **Decision**: Add `awaitRecovery: boolean` to `ModeFlags`; `deriveModeFlags` sets `awaitRecovery: mode === 'run'`; `bootstrap()` awaits `recovery.recover()` synchronously before returning the container when `awaitRecovery` is true. Server and CLI modes retain fire-and-forget.
- **Rationale**: `beat run` is a dedicated single-task process — there is no benefit to parallelizing bootstrap and the 100–500ms recovery cost is negligible. Fire-and-forget is only safe when work arrives long after recovery has completed (server mode via MCP connections). The await eliminates the entire class of race conditions, not just the Phase 3 stale-set symptom.
- **Status**: Active
- **Source**: sidecar:obs_n8q3v5

## ADR-008: bootstrap() returns error to caller when recovery fails in run mode — not logged-and-swallowed

- **Context**: PR #201 Greptile P2 — after adding `awaitRecovery`, the original code still returned a healthy container even when `recovery.recover()` returned an error, silently proceeding on inconsistent state.
- **Decision**: In run mode (`awaitRecovery=true`), a recovery failure is a fatal bootstrap error — `bootstrap()` returns `Err` to the caller. Server mode retains log-and-continue behavior because it is not vulnerable to the same race.
- **Rationale**: If recovery did not complete, stale `RUNNING` tasks have not been cleaned up. Proceeding in that state could trigger the exact race the fix was designed to eliminate. Failing loudly is correct; the caller can surface the error and exit.
- **Status**: Active
- **Source**: sidecar:obs_k7p4m1

## ADR-009: Autobeat is CLI-first; the MCP server is parity-only and a candidate for removal — all functionality must work without an MCP server running

- **Date**: 2026-06-07
- **Status**: Accepted
- **Context**: E2E testing of v1.5.2 revealed that nearly every mutating CLI command (loop, pipeline, channel, msg, schedule create, cancel, retry, resume) is silently MCP-server-only — each writes records to SQLite then calls process.exit(0), leaving no executor process alive to consume the emitted events. Only beat run works standalone, because it uses spawnDetachedProcess() to re-run itself with --foreground in run mode and stays alive on waitForTaskCompletion(). decision: pivot autobeat to a CLI-first architecture in which every command works standalone regardless of whether an MCP server is running. The MCP server is retained only for convention/parity and is an explicit candidate for complete removal. The fix model is to give every mutating command the same detach/foreground keep-alive mechanism beat run already uses, so each command keeps a process alive long enough to drive its handlers to completion. rationale: the CLI is the primary intended usage surface for the product. Designing features that assume a long-lived MCP server is always running is backwards for a CLI-first tool and produced an entire class of commands that appear to succeed (DB record created) but silently do nothing. Making the CLI self-sufficient eliminates the hidden MCP dependency. User explicitly directed this direction and authorized refactoring out the MCP server
- **Decision**: pivot autobeat to a CLI-first architecture in which every command works standalone regardless of whether an MCP server is running. The MCP server is retained only for convention/parity and is an explicit candidate for complete removal. The fix model is to give every mutating command the same detach/foreground keep-alive mechanism beat run already uses, so each command keeps a process alive long enough to drive its handlers to completion. rationale: the CLI is the primary intended usage surface for the product. Designing features that assume a long-lived MCP server is always running is backwards for a CLI-first tool and produced an entire class of commands that appear to succeed (DB record created) but silently do nothing. Making the CLI self-sufficient eliminates the hidden MCP dependency. User explicitly directed this direction and authorized refactoring out the MCP server
- **Consequences**: the CLI is the primary intended usage surface for the product. Designing features that assume a long-lived MCP server is always running is backwards for a CLI-first tool and produced an entire class of commands that appear to succeed (DB record created) but silently do nothing. Making the CLI self-sufficient eliminates the hidden MCP dependency. User explicitly directed this direction and authorized refactoring out the MCP server
- **Source**: self-learning:obs_p7r2x9
