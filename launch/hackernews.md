# Hacker News — Show HN Post

## Title

Show HN: Delegate – Orchestrate multiple Claude Code instances via MCP

## URL

https://github.com/dean0x/delegate

---

## First Comment (post immediately after submission)

Hey HN, I built Delegate because I was frustrated with the single-instance limitation of Claude Code. I'd have 3-4 terminal tabs open, each running a separate Claude session, with no coordination between them.

Delegate is an MCP (Model Context Protocol) server that lets you delegate tasks to background Claude Code processes from your main session. You say "build the API, write the tests, refactor the DB layer" and they run in parallel.

**Technical decisions worth discussing:**

- **Event-driven over polling**: All components communicate via an EventBus. No timers, no polling loops. When a task completes, downstream handlers react immediately. This eliminated an entire class of race conditions we had in the early prototype.

- **DAG for dependencies**: Tasks can depend on other tasks (build → test → deploy). We use a dependency graph with DFS-based cycle detection and TOCTOU protection via synchronous SQLite transactions. The graph is validated before every edge insertion.

- **Why MCP**: MCP is the standard protocol for extending Claude Code's capabilities. Using it means Delegate works as a native tool inside Claude Code — no separate UI, no API to learn. You just call `DelegateTask()` and it works.

- **SQLite, not Postgres**: Single-machine architecture. WAL mode handles concurrent reads from multiple workers. No need for a separate database process. The data is local to where the work happens.

- **Not distributed (yet)**: Current architecture is single-machine. Distributed multi-server is on the roadmap (v0.5.0) but I wanted to ship something solid for the single-machine case first rather than over-engineer.

Happy to answer questions about the architecture, trade-offs, or anything else.

---

## Anticipated Q&A

### "Why not just use shell scripts to run multiple Claude instances?"

You could, and for simple cases that works fine. Delegate adds: dependency ordering (task B waits for task A), crash recovery (tasks resume after restart), resource-aware autoscaling (won't spawn 20 instances on 8 cores), persistent state (SQLite), and scheduling (cron + one-time). If you don't need any of that, shell scripts are the right tool.

### "How is this different from Cursor/Windsurf/other AI editors?"

Different problem space. Cursor and Windsurf are AI-assisted editors — they help you write code interactively. Delegate is a task orchestrator — it runs multiple autonomous Claude Code processes in the background. You define what to do, and Delegate manages the execution. They're complementary, not competing.

### "MCP in 2026? Is that still relevant?"

MCP has become the standard way to extend Claude Code's capabilities. Anthropic actively maintains it, the SDK is stable, and the ecosystem is growing. It's how Claude Code talks to external tools — databases, APIs, and now task orchestrators like Delegate.

### "Why not distributed from day one?"

Premature abstraction. The single-machine case needed to be rock-solid first: correct task lifecycle, proper crash recovery, dependency resolution, scheduling. Adding network partitions, consensus, and distributed state on top of a shaky foundation would have been a mess. v0.5.0 will add distribution once the core is proven.

### "What happens when a task fails?"

The task enters FAILED state. Dependent tasks are notified and won't execute. You can retry the failed task (which creates a new task with the same prompt) or resume it (which provides the checkpoint context — last 50 lines of output, git state — to a new task so it can pick up where the previous one left off).
