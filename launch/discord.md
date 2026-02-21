# Discord Announcements

## Claude / Anthropic Community Discord

**Channel:** #showcase or #projects (check current channel names)

**Message:**

Built an open-source MCP server for orchestrating multiple Claude Code instances from a single session.

**What it does:** Delegate tasks to background Claude Code workers, define dependency chains (build -> test -> deploy), schedule recurring tasks with cron, and resume from automatic checkpoints.

**Why:** Claude Code is one-session-one-task. If you want parallel work across repos, you end up manually juggling terminals. Delegate handles the coordination.

**Quick start:**
```json
{
  "mcpServers": {
    "delegate": {
      "command": "npx",
      "args": ["-y", "@dean0x/delegate", "mcp", "start"]
    }
  }
}
```

GitHub: https://github.com/dean0x/delegate

v0.4.0 — event-driven architecture, DAG dependencies, SQLite persistence, autoscaling. Written in TypeScript, MIT licensed.

Feedback and contributions welcome.

---

## MCP Community Discord

**Channel:** #showcase or #projects

**Message:**

Sharing an MCP server I built: **Delegate** — orchestrates multiple Claude Code instances for parallel task execution.

MCP tools exposed:
- `DelegateTask` — submit tasks to background instances
- `TaskStatus` / `TaskLogs` — monitor execution
- `ScheduleTask` — cron and one-time scheduling
- `ResumeTask` — resume from automatic checkpoints
- Dependency management (DAG-based, cycle detection)

Uses `@modelcontextprotocol/sdk`, event-driven architecture, SQLite for persistence.

Install: add to `.mcp.json` and restart Claude Code.

```json
{
  "mcpServers": {
    "delegate": {
      "command": "npx",
      "args": ["-y", "@dean0x/delegate", "mcp", "start"]
    }
  }
}
```

GitHub: https://github.com/dean0x/delegate

Would love feedback on the MCP tool design — especially around the scheduling and dependency interfaces.

---

## AI Tools / AI Dev Discord Communities

**Message:**

Open-sourced an orchestration layer for Claude Code: **Delegate**

Solves the "one instance, one task" limitation by managing background Claude Code workers with:
- Task delegation and dependency chains
- Cron scheduling
- Crash recovery from checkpoints
- Autoscaling based on system resources

TypeScript, MIT license, one-line install: `npx @dean0x/delegate mcp start`

GitHub: https://github.com/dean0x/delegate
