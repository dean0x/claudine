# Reddit Posts

## r/ClaudeAI

**Title:** I built an MCP server that lets you run multiple Claude Code tasks in parallel from one session

**Body:**

I've been using Claude Code daily and the biggest friction point was always: one session, one task. If I wanted to work on three things across different repos, I'd have three terminals open and lose track of what each was doing.

So I built Delegate — an MCP server that orchestrates multiple Claude Code instances from a single session.

You delegate tasks, define dependencies between them (e.g., "run tests after build"), and schedule recurring work. It handles the rest: worker lifecycle, crash recovery, autoscaling.

**What it does:**
- Delegates tasks to background Claude Code instances
- DAG-based dependencies (task B waits for task A)
- Cron + one-time scheduling with timezone support
- Automatic checkpoints and task resumption
- Full CLI + MCP tool interface

Install: `npx @dean0x/delegate mcp start` (add to your `.mcp.json`)

GitHub: https://github.com/dean0x/delegate

Feedback welcome — this is v0.4.0 and I'm actively working on it.

---

## r/programming

**Title:** Delegate: Event-driven orchestration of AI coding agents with DAG dependencies and SQLite persistence

**Body:**

I built an MCP (Model Context Protocol) server for orchestrating multiple Claude Code instances. The interesting part is the architecture.

**Event-driven coordination:** All components communicate through an EventBus. Task state transitions, dependency resolution, worker lifecycle — everything is an event. No polling, no shared mutable state.

**DAG-based dependencies:** Tasks can depend on other tasks, validated at insertion time with DFS cycle detection. TOCTOU protection via synchronous SQLite transactions prevents race conditions in concurrent dependency creation.

**Persistence:** SQLite with WAL mode. All task state, schedules, checkpoints, and execution history survive crashes. No external infrastructure required.

**Autoscaling:** Workers scale based on CPU and memory thresholds. Settling window tracking prevents spawn bursts when load metrics lag behind actual resource consumption.

**Scheduling:** Cron expressions (5-field) and one-time schedules with IANA timezone support, missed-run policies (skip/catchup/fail), and concurrent execution prevention.

The system is written in TypeScript, uses Zod for boundary validation, Result types for error handling, and dependency injection throughout. ~300 tests.

GitHub: https://github.com/dean0x/delegate

Happy to discuss the architecture decisions. The event-driven approach eliminated an entire class of race conditions we had with the original polling-based design.

---

## r/commandline

**Title:** delegate — CLI tool to orchestrate multiple Claude Code instances with task dependencies and scheduling

**Body:**

Built a CLI tool for running multiple Claude Code tasks in parallel with dependency chains and scheduling.

```bash
# Install
npx @dean0x/delegate mcp start

# Delegate tasks
delegate delegate "npm run build" --priority P1
delegate delegate "npm test" --depends-on task-abc123

# Schedule recurring work
delegate schedule create "Run linter" --cron "0 9 * * 1-5"

# Check status
delegate status
delegate logs task-abc123

# Resume a failed task from checkpoint
delegate resume task-abc123
```

Key features:
- Background task delegation to Claude Code instances
- Dependency chains: build -> test -> deploy
- Cron scheduling with timezone support
- SQLite persistence (survives crashes)
- Autoscaling based on system resources

Works as both a standalone CLI and an MCP server (integrates directly into Claude Code's tool interface).

GitHub: https://github.com/dean0x/delegate

---

## r/LocalLLaMA

**Title:** Built an orchestration layer for parallel AI coding agent tasks — architecture is model-agnostic even though it currently targets Claude Code

**Body:**

I built Delegate, an orchestration server for running multiple AI coding agent tasks in parallel. It currently targets Claude Code specifically, but the core architecture (event-driven coordination, DAG dependencies, SQLite persistence, autoscaling) is model-agnostic.

The system uses the Model Context Protocol (MCP) for integration, which is an open standard. The interesting bits:

- **Event-driven architecture:** Components communicate via events, not shared state
- **Dependency DAG:** Tasks can depend on other tasks, with cycle detection
- **Scheduling:** Cron expressions and one-time schedules
- **Crash recovery:** Automatic checkpoints with task resumption

If you're running local models with tool-use capabilities (or any CLI-based AI agent), the orchestration pattern is transferable. The abstractions don't assume anything Claude-specific — the Claude Code dependency is isolated to the worker spawning layer.

GitHub: https://github.com/dean0x/delegate

Would be interested in hearing if anyone has similar needs for orchestrating local AI agents.

---

## r/devops

**Title:** Delegate: Parallel task execution across repos using orchestrated AI coding agents

**Body:**

I built a tool for orchestrating multiple Claude Code instances to work across repos in parallel. It's not CI/CD — it's an orchestration layer for AI coding agents.

**Use case:** You're working across multiple repos and want to parallelize: "Build auth module in repo A, write integration tests in repo B, refactor database layer in repo C." Delegate coordinates independent Claude Code instances for each, with dependency management and scheduling.

**What it does:**
- Delegates tasks to background Claude Code processes
- DAG-based dependencies (deploy waits for test, test waits for build)
- Cron scheduling for recurring tasks (daily linting, nightly test runs)
- Autoscaling based on CPU/memory availability
- SQLite persistence — everything survives crashes
- Automatic checkpoints and task resumption

**What it's NOT:**
- Not a CI/CD replacement (no pipelines, no artifact management)
- Not distributed (single machine, for now — v0.5.0 roadmap item)
- Not model-agnostic yet (requires Claude Code CLI)

Install: `npx @dean0x/delegate mcp start`

GitHub: https://github.com/dean0x/delegate

Currently v0.4.0, actively developed. Curious to hear from anyone who's tried to integrate AI coding agents into their development workflows.
