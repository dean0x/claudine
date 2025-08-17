# Claudine Research Documentation

## Overview
This directory contains comprehensive research and architectural documentation for Claudine, an MCP server that enables Claude to delegate tasks to background Claude Code instances.

## Document Index

### Core Architecture
- **[mcp-architecture.md](./mcp-architecture.md)** - MCP protocol fundamentals and server implementation patterns
- **[implementation-blueprint.md](./implementation-blueprint.md)** - Complete architectural design and implementation roadmap

### Technical Components
- **[claude-code-cli.md](./claude-code-cli.md)** - Claude Code CLI capabilities and session management
- **[process-management.md](./process-management.md)** - Process spawning, IPC, and resource management
- **[git-worktree.md](./git-worktree.md)** - Git worktree operations for task isolation
- **[logging-strategy.md](./logging-strategy.md)** - Structured logging and output capture

### Design Decisions
- **[tool-naming-conventions.md](./tool-naming-conventions.md)** - Tool naming strategy and PascalCase conventions
- **[adaptive-resource-management.md](./adaptive-resource-management.md)** - Intelligent resource management approach

## Quick Reference

### Claudine MCP Tools
All tools follow PascalCase naming to complement Claude Code's native tools:

| Tool | Purpose |
|------|---------|
| `DelegateTask` | Delegate a task to a background Claude Code instance |
| `TaskStatus` | Get status of delegated tasks |
| `TaskLogs` | Retrieve execution logs from tasks |
| `ListTasks` | List all tasks with filtering options |
| `CancelTask` | Cancel a running task |
| `SuspendTask` | Suspend a running task |
| `ResumeTask` | Resume a suspended task |
| `TaskMetrics` | Get resource metrics for a task |

### Key Architectural Decisions

1. **Task Delegation over Spawning**: We use "delegate" terminology instead of "spawn" to better convey the concept of assigning work to background instances.

2. **Adaptive Resource Management**: Instead of hard limits, we use:
   - Heartbeat monitoring (activity tracking)
   - Resource-based monitoring (memory, CPU)
   - User-controlled cancellation
   - Soft limits with warnings

3. **Git Worktree Isolation**: Each task can run in an isolated git worktree for:
   - Complete filesystem isolation
   - Parallel development without conflicts
   - Clean state management

4. **Session Continuity**: Leveraging Claude Code's `--resume` capability for:
   - Task checkpointing
   - Session persistence
   - Recovery from interruptions

5. **Structured Logging**: Using Pino for:
   - JSON structured logs
   - Real-time output streaming
   - Performance metrics
   - Debug traceability

## Implementation Status

### Research Phase ✅
- [x] MCP server architecture and best practices
- [x] Claude Code CLI internals and session management
- [x] Process spawning and management strategies
- [x] Git worktree integration approaches
- [x] Inter-process communication for notifications
- [x] Logging and output capture mechanisms
- [x] Tool naming conventions alignment

### Next Steps
1. Implement core MCP server with TypeScript SDK
2. Build DelegateTask tool with basic task execution
3. Add task queue with priority management
4. Integrate git worktree support
5. Implement monitoring and logging
6. Add remaining tools (suspend/resume, metrics)
7. Create comprehensive test suite

## Usage Example

```typescript
// Delegate a new task
await DelegateTask({
  prompt: "Implement user authentication with OAuth",
  priority: "P1",
  useWorktree: true,
  branch: "feature/oauth"
});

// Check task status
const status = await TaskStatus({ taskId: "abc-123" });

// View logs
const logs = await TaskLogs({ 
  taskId: "abc-123",
  tail: 50 
});

// Cancel if needed
await CancelTask({ 
  taskId: "abc-123",
  reason: "Requirements changed"
});
```

## Design Principles

1. **Complement, Don't Compete**: Tools are designed to work alongside Claude Code's native tools
2. **User Control**: Users maintain control over task execution and resource usage
3. **Transparency**: Clear visibility into task status and resource consumption
4. **Resilience**: Support for checkpointing, recovery, and graceful degradation
5. **Scalability**: Adaptive resource management for varying workloads

## Contributing

When adding new research or updating existing documentation:
1. Maintain consistent terminology (e.g., "delegate" not "spawn")
2. Follow PascalCase for tool names
3. Update this README with any new documents
4. Ensure cross-references between documents are accurate
5. Keep tool naming aligned with Claude Code conventions