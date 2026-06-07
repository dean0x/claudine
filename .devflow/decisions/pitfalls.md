<!-- TL;DR: 6 pitfalls. Key: PF-001, PF-002, PF-003, PF-004, PF-005, PF-006 -->
# Known Pitfalls

Area-specific gotchas, fragile areas, and past bugs.

## PF-001: Do not unilaterally defer code review issues to a future PR — always ask user before deferring

- **Area**: code review resolution strategy — the assistant categorized 3 issues as 'Pre-existing' and implicitly left them for later
- **Issue**: user directed to fix all pre-existing issues found, not just the new ones
- **Impact**: user had to explicitly redirect to include pre-existing items
- **Resolution**: when resolving review findings, do not treat 'pre-existing' as a deferral category — surface each item and ask whether to fix now or track. User's standing posture is 'fix it while we're here.'
- **Status**: Active
- **Source**: self-learning:obs_q7m2r5

## PF-002: Do not add migration or backward-compatibility paths for features with zero users — clean break is correct

- **Area**: renaming the `translate` config field to `proxy` in AgentConfig — a field that shipped in v1.4.0 with no known users
- **Issue**: assistant treated the config rename as a blocking issue requiring a migration fallback
- **Impact**: user had to explicitly reject it with 'clean break forward'
- **Resolution**: before proposing migration or deprecation scaffolding, verify whether anyone actually uses the feature. If adoption is zero or negligible, a clean break is always preferable.
- **Status**: Active
- **Source**: self-learning:obs_f8b3r7

## PF-003: Always verify and checkout the feature branch before starting implementation — commits can accidentally land on main

- **Area**: git workflow / branch discipline
- **Issue**: Assistant began implementing Phase 6 channel domain feature directly on `main` without first creating and checking out the feature branch, causing two feature commits to land on main
- **Impact**: Required a local `git reset --hard HEAD~2` + branch creation to recover. Safe only because changes had not been pushed upstream. If already pushed, this would require force-push or revert commits.
- **Resolution**: Before writing any feature code, run `git branch --show-current` and verify the branch. If not on the expected feature branch, create and checkout it explicitly. When the plan or issue specifies a branch name (e.g. `feat/181-channel-domain-persistence`), use it verbatim from the start.
- **Status**: Active
- **Source**: sidecar:obs_a4f7c2

## PF-004: Multi-step create rollback must clean all three layers — DB record, external resource, and in-memory state

- **Area**: error handling / rollback completeness in service layer
- **Issue**: `ChannelManager` rollback on `ChannelCreated` emit failure cleaned tmux sessions and in-memory state but omitted `channelRepository.delete()`, leaving an orphaned channel DB record with the channel name permanently occupied
- **Impact**: Channel name could not be reused until process restart; `ChannelCreated` re-emits or retries would fail with a name-collision error
- **Resolution**: When rolling back a multi-step create operation (DB write → external resource allocation → event emit), reverse all three layers in LIFO order. A rollback that only handles external resources and memory but skips the DB record leaves state permanently inconsistent until process restart.
- **Status**: Active
- **Source**: sidecar:obs_d1f4a8

## PF-005: Greptile re-reviews on every commit push — Greptile resolution is a multi-round cycle, not a one-shot pass

- **Area**: PR review workflow with Greptile automated reviewer
- **Issue**: Each time a fix is pushed to the branch, Greptile runs a fresh review of the entire diff and can surface new findings. Initial batch resolution is not final.
- **Impact**: Declaring "all comments resolved" after the first round led to the user having to explicitly ask for a re-check, which surfaced a new P1 (`rrFirstMemberSeen` never reset). Missing this would have merged a stateful reset bug.
- **Resolution**: After each push+fix cycle, explicitly poll the PR for new Greptile comments before declaring resolution complete. Expect 2–3 rounds on active PRs. Only close out when a full push-and-check cycle yields no new findings.
- **Status**: Active
- **Source**: sidecar:obs_f3a9d6

## PF-006: Loop handler commitAllChanges uses git add -A and sweeps all untracked files into iteration commits

- **Area**: `loop-handler.ts:1564-1567` — `commitAllChanges()` is called on loop iteration completion; `git-state.ts:421` runs `git add -A`
- **Issue**: `git add -A` stages every untracked file in the working directory, not just files the loop agent actually changed. Any leftover untracked artifacts (e.g. `.devflow/docs/reviews/` files from prior PR review sessions) get swept into the loop iteration commit, inflating the diff by dozens of unrelated files.
- **Impact**: PR #201 branch showed 49 file changes instead of the expected 4 because two loop auto-commits swept in 45 review artifacts. Confusing to reviewers; can cause Greptile or CI tools to flag unrelated files.
- **Resolution**: Fix `commitAllChanges` to stage only files changed since the pre-iteration commit SHA, or scope `git add` to the loop's designated workspace rather than the entire working directory. Tracked as GitHub issue #202.
- **Status**: Active (issue #202 open, not yet fixed)
- **Source**: sidecar:obs_j2n5w8
