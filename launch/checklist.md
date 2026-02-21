# Delegate Public Launch Checklist

## Pre-Launch Verification

### Repository Quality
- [ ] README renders correctly on GitHub (badges, code blocks, tables)
- [ ] All 5 badges render and are clickable (npm, license, node, CI, MCP)
- [ ] LICENSE file present and correct (MIT)
- [ ] CODE_OF_CONDUCT.md present (Contributor Covenant v2.1)
- [ ] SECURITY.md present with disclosure process
- [ ] PR template present at `.github/pull_request_template.md`
- [ ] CHANGELOG.md is current through v0.4.0
- [ ] No secrets, credentials, or internal URLs in committed files

### Functionality
- [ ] `npx @dean0x/delegate mcp start` works on a clean machine (no prior install)
- [ ] `npx @dean0x/delegate --help` shows available commands
- [ ] MCP integration works when added to `.mcp.json` and Claude Code restarted
- [ ] At least one successful task delegation end-to-end
- [ ] Task scheduling (cron) creates and fires correctly
- [ ] Task dependencies (A -> B -> C chain) resolve in order

### CI/CD
- [ ] CI pipeline is green on main
- [ ] `npm run build` succeeds
- [ ] `npm run test:all` passes locally
- [ ] npm package is published at correct version (0.4.0)
- [ ] `npm pack --dry-run` confirms `launch/` is excluded from package

### GitHub Metadata
- [ ] Repository description is accurate
- [ ] Topics include: ai-tools, automation, claude, claude-code, mcp, task-delegation, typescript, event-driven, sqlite, task-scheduling
- [ ] Social preview image is set (render `launch/social-preview.svg` to PNG first)
- [ ] Homepage URL points to npm package or README

### Content Ready
- [ ] Demo GIF recorded showing parallel task delegation
- [ ] All launch posts reviewed and finalized in `launch/` directory
- [ ] GitHub link formatted correctly for each platform

---

## Rollout Schedule

### Day 1 — Final Polish
- [ ] Final review of all launch content
- [ ] Verify npm package installs cleanly: `npx @dean0x/delegate mcp start`
- [ ] Confirm GitHub repo page looks professional (badges, description, social preview)
- [ ] Stage LinkedIn post (save as draft)

### Day 2 — LinkedIn
- [ ] Publish LinkedIn post (see `launch/linkedin.md`)
- [ ] GitHub link as first comment (LinkedIn suppresses external links in body)
- [ ] Engage with early comments within first 2 hours

### Day 3 — Hacker News + X (Twitter)
- [ ] Submit Show HN post (see `launch/hackernews.md`)
- [ ] Post first comment with technical context immediately
- [ ] Post X thread (see `launch/twitter.md`)
- [ ] Monitor HN comments — respond to technical questions within 1 hour

### Days 4-5 — Reddit
- [ ] Post to r/ClaudeAI (see `launch/reddit.md`)
- [ ] Post to r/programming
- [ ] Post to r/commandline
- [ ] Post to r/LocalLLaMA
- [ ] Post to r/devops
- [ ] GitHub link as first comment where appropriate
- [ ] Respond to questions and feedback

### Week 2 — Dev.to Blog Post
- [ ] Write full blog post from outline (see `launch/devto-outline.md`)
- [ ] Cross-post to personal blog if applicable
- [ ] Share on relevant Discord communities (see `launch/discord.md`)

---

## Post-Launch Monitoring

### First 48 Hours
- [ ] Monitor GitHub issues for install/setup problems
- [ ] Respond to HN comments (technical questions get priority)
- [ ] Track npm install count (`npm info delegate`)
- [ ] Track GitHub stars and forks
- [ ] Note recurring questions — add to README FAQ if pattern emerges

### First Week
- [ ] Triage incoming GitHub issues (bug vs feature request vs question)
- [ ] Update README if common confusion points emerge
- [ ] Thank contributors for any PRs
- [ ] Capture feedback themes for v0.5.0 planning

### Ongoing
- [ ] Weekly check on open issues
- [ ] Monthly npm download trends
- [ ] Respond to new issues within 48 hours

---

## What NOT To Do

- **Don't oversell as a CI/CD replacement.** Delegate orchestrates Claude Code instances — it's not Jenkins, GitHub Actions, or a build system. It delegates AI-powered tasks.
- **Don't hide the Claude Code dependency.** Be upfront: Delegate requires Claude Code CLI installed and available. It's a multiplier for Claude Code, not a standalone tool.
- **Don't claim "unlimited scaling."** Current architecture is single-machine. Distributed multi-server is on the roadmap (v0.5.0) but not shipped.
- **Don't ignore limitations.** If someone asks about edge cases or limitations, answer honestly. The project earns trust through transparency.
- **Don't spam.** One post per platform. Engage authentically. If a post doesn't gain traction, that's fine — let the work speak for itself.
