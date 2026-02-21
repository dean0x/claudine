# LinkedIn Launch Post

> **Platform notes**: LinkedIn suppresses reach for posts with external links in the body. Place the GitHub link as a **first comment**, not in the post itself. Aim for ~1300 characters (LinkedIn's sweet spot for engagement).

---

I kept opening multiple terminal tabs, each running its own Claude Code session.

One for building auth in the backend. Another for writing frontend components. A third for running tests. All separate, all uncoordinated, all losing context the moment I switched between them.

That's when I realized: the bottleneck isn't Claude Code's capability — it's that you can only do one thing at a time with a single instance.

So I built Delegate.

Delegate is an MCP server that lets you orchestrate multiple Claude Code instances from one main session. You delegate tasks in the background — "build the API endpoint," "write tests for the auth module," "refactor the database layer" — and they run in parallel, each in its own Claude Code process.

What makes it interesting:

- Event-driven architecture (no polling, no race conditions)
- Task dependencies as a DAG (build → test → deploy, with cycle detection)
- Cron scheduling and one-time scheduled tasks
- SQLite persistence with crash recovery
- Task resumption from automatic checkpoints
- Autoscaling workers based on CPU and memory

One command to start: npx @dean0x/delegate mcp start

It's open source (MIT), built with TypeScript, and works anywhere Claude Code runs.

If you've ever wished you could tell Claude "do these 5 things at once" — that's what this is for.

Link in the first comment.

---

## First Comment (post immediately after publishing)

GitHub: https://github.com/dean0x/delegate

Install: `npx @dean0x/delegate mcp start`

npm: https://www.npmjs.com/package/@dean0x/delegate
