# Dev.to Article Outline

**Target publish date:** Week 2 of launch

**Title:** "I Built an Orchestration Layer for Claude Code — Here's Why Single-Instance AI Isn't Enough"

**Tags:** ai, typescript, opensource, productivity

---

## Outline

### 1. The Problem (400 words)

Open with the concrete pain point: multiple terminal tabs, each running a separate Claude Code session. Describe the workflow breakdown — context switching between sessions, manually copying output from one to another, losing track of which session is doing what.

Generalize: single-instance AI tools hit a ceiling when work spans multiple repos or requires coordination. The tool is powerful; the orchestration is missing.

### 2. Failed Approaches (300 words)

What I tried before building Delegate:
- Shell scripts wrapping Claude Code → no coordination, no dependency management, output scattered across files
- Manual session management → doesn't scale past 2-3 concurrent tasks
- Waiting for "native" multi-task support → not on the roadmap, and the problem exists now

Key insight: the issue isn't the AI's capability — it's the infrastructure around it.

### 3. What Delegate Does (500 words)

Concrete walkthrough with code examples:
- Delegating a task and getting output
- Setting up a dependency chain (build -> test -> deploy)
- Scheduling a recurring task with cron
- Resuming a failed task from checkpoint

Show the MCP integration — tools appearing directly in Claude Code's interface.

### 4. Architecture Decisions (600 words)

The most technically interesting section:

**Event-driven over polling:** Why events eliminate race conditions. The EventBus pattern and how components stay decoupled.

**DAG dependencies:** Cycle detection with DFS, TOCTOU protection via synchronous SQLite transactions. Why the dependency graph is validated at insertion time, not execution time.

**SQLite as the persistence layer:** WAL mode, why no external database is needed, how checkpoints enable crash recovery.

**Autoscaling with settling windows:** CPU/memory monitoring, why naive scaling causes spawn bursts, how settling window tracking prevents oscillation.

Include a simplified architecture diagram.

### 5. What I Learned (400 words)

- Event-driven architecture pays off immediately in testability (300 tests, all using events)
- SQLite is underrated for single-machine persistence (no operational overhead, synchronous transactions)
- Starting single-machine before distributed was the right call (validated abstractions first)
- Result types and dependency injection made the codebase composable from day one

### 6. What's Next (200 words)

- v0.5.0: Distributed multi-server processing
- The vision: transform dedicated servers into AI development clusters
- How the architecture is designed to support distribution (events + persistence = replayability)

### 7. Try It (100 words)

Install instructions, GitHub link, invitation for feedback and contributions.

---

## Notes

- Keep the tone technical but accessible — Dev.to audience is broader than HN
- Include code snippets for every feature mentioned
- Use headers and code blocks to make it scannable
- Link back to GitHub and relevant documentation
- Don't oversell — be honest about limitations (single-machine, Claude Code dependency)
