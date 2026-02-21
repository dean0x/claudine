# X (Twitter) Launch Thread

> **Platform notes**: Thread of 5 tweets. Keep each tweet under 280 characters. Include demo GIF in tweet 2. GitHub link in final tweet.

---

## Tweet 1 — Hook

Claude Code is powerful, but it can only do one thing at a time.

I built Delegate — an MCP server that lets you orchestrate multiple Claude Code instances from one session.

Delegate tasks in parallel. Get more done. Here's how it works:

🧵

---

## Tweet 2 — Before/After

Before: Switch between terminal tabs. Lose context. Wait for each task sequentially.

After: "Build auth, write tests, refactor the DB" — all running simultaneously as background Claude Code processes.

[ATTACH: demo GIF showing parallel task delegation via CLI]

---

## Tweet 3 — Architecture

Under the hood:

- Event-driven (EventBus, no polling)
- Task dependencies as a DAG with cycle detection
- SQLite persistence + crash recovery
- Autoscaling workers (CPU/memory aware)
- Task resumption from automatic checkpoints

No magic. Just solid engineering.

---

## Tweet 4 — Scheduling

v0.4.0 added task scheduling:

- Cron expressions (daily backups, recurring analysis)
- One-time scheduled tasks (deploy at 8am tomorrow)
- Timezone support
- Missed run policies (skip, catchup, fail)

Combine with dependency chains: build → test → deploy on a schedule.

---

## Tweet 5 — CTA

Delegate is open source (MIT), built with TypeScript, and works anywhere Claude Code runs.

One command: npx @dean0x/delegate mcp start

GitHub: https://github.com/dean0x/delegate

Stars appreciated, issues welcome, PRs even more so.
