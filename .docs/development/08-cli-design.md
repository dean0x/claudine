# CLI Design Document

## Overview
Claudine will support dual-mode operation: MCP server for Claude Desktop integration and CLI for terminal users. This document outlines the design and implementation plan for the CLI interface, scheduled for Phase 2 (Week 3, Day 13).

## Motivation
While the MCP interface enables seamless Claude Desktop integration, a CLI interface provides:
- Direct terminal access for power users
- Easier debugging and development testing
- Scriptability and automation capabilities
- Alternative access method when Claude Desktop isn't available

## Architecture

### Dual-Mode Design
```
┌──────────────────────────────────────────────┐
│              Claudine Core                    │
│                                               │
│  ┌─────────────────────────────────────┐    │
│  │         TaskManager                  │    │
│  │  - Task queue management            │    │
│  │  - Priority handling                │    │
│  │  - Dependency resolution            │    │
│  └─────────────────────────────────────┘    │
│                                               │
│  ┌─────────────────────────────────────┐    │
│  │      ProcessExecutor                 │    │
│  │  - Claude Code spawning             │    │
│  │  - Output capture                   │    │
│  │  - Session management               │    │
│  └─────────────────────────────────────┘    │
└───────────────┬───────────────┬─────────────┘
                │               │
        ┌───────▼───────┐ ┌────▼──────┐
        │  MCP Server   │ │    CLI     │
        │   (stdio)     │ │ (commander)│
        └───────────────┘ └────────────┘
```

### Shared State Management
- Location: `~/.claudine/state.json`
- Format: JSON with file locking for concurrent access
- Contents:
  ```json
  {
    "tasks": {
      "task-id": {
        "id": "task-id",
        "command": "analyze codebase",
        "status": "running|completed|failed",
        "priority": "P0|P1|P2",
        "created": "2024-01-01T00:00:00Z",
        "output": "/path/to/output.log"
      }
    },
    "config": {
      "maxConcurrent": 3,
      "defaultPriority": "P2"
    }
  }
  ```

## Command Specifications

### Current Commands (Phase 1)

#### `claudine mcp start`
Start the MCP server for Claude Code integration.

**Examples:**
```bash
# Start MCP server
claudine mcp start
```

#### `claudine mcp test`
Test the MCP server in mock mode.

**Examples:**
```bash
# Test server functionality
claudine mcp test
```

### Future Commands (Phase 2)

#### `claudine delegate <task>`
Delegate a task to a background Claude Code instance.

**Options:**
- `-p, --priority <level>` - Set priority (P0|P1|P2), default: P2
- `-d, --deps <ids...>` - Specify dependency task IDs
- `-w, --worktree` - Use git worktree isolation (Phase 3)
- `--timeout <ms>` - Set task timeout in milliseconds

**Examples:**
```bash
# Simple task
claudine delegate "find all TODO comments in the codebase"

# High priority task
claudine delegate "fix auth bug" --priority P0

# Task with dependencies
claudine delegate "deploy to prod" --deps task-123 task-456
```

#### `claudine status [task-id]`
Check the status of tasks.

**Options:**
- `-a, --all` - Show all tasks (default if no task-id)
- `-f, --format <type>` - Output format (json|table|simple)
- `--live` - Live update mode (refreshes every 2s)

**Examples:**
```bash
# Check specific task
claudine status task-abc123

# Show all tasks in table format
claudine status --all --format table

# Live monitoring
claudine status --live
```

#### `claudine logs <task-id>`
Retrieve output from a task.

**Options:**
- `-f, --follow` - Stream logs as they arrive
- `-n, --lines <num>` - Show last N lines (default: all)
- `--since <time>` - Show logs since timestamp

**Examples:**
```bash
# Get all logs
claudine logs task-abc123

# Stream logs from running task
claudine logs task-abc123 --follow

# Get last 100 lines
claudine logs task-abc123 --lines 100
```

#### `claudine cancel <task-id>`
Cancel a running task.

**Options:**
- `-f, --force` - Force kill if graceful shutdown fails

**Examples:**
```bash
# Cancel task
claudine cancel task-abc123

# Force cancel
claudine cancel task-abc123 --force
```

#### `claudine list`
List all tasks with their current status.

**Options:**
- `-s, --status <status>` - Filter by status (running|completed|failed)
- `-f, --format <type>` - Output format (json|table|simple)
- `-n, --limit <num>` - Limit number of results

**Examples:**
```bash
# List all tasks
claudine list

# Show only running tasks
claudine list --status running

# JSON output for scripting
claudine list --format json
```

### Utility Commands

#### `claudine config`
View or modify configuration.

**Options:**
- `--get <key>` - Get config value
- `--set <key> <value>` - Set config value
- `--list` - List all config

#### `claudine clean`
Clean up completed/failed tasks.

**Options:**
- `--older-than <time>` - Clean tasks older than specified time
- `--keep-failed` - Don't remove failed tasks

## Implementation Plan

### Epic: CLI-001 - CLI Interface Implementation (3 days)

#### Task 1: CLI Scaffold (2 hours)
```typescript
// src/cli/index.ts
import { Command } from 'commander';
import { version } from '../package.json';
import { DelegateCommand } from './commands/delegate';
import { StatusCommand } from './commands/status';
// ... other command imports

const program = new Command();

program
  .name('claudine')
  .description('Delegate tasks to background Claude Code instances')
  .version(version);

// Register commands
new DelegateCommand(program);
new StatusCommand(program);
// ... register other commands

program.parse();
```

#### Task 2: Shared State Management (4 hours)
```typescript
// src/state/manager.ts
import { promises as fs } from 'fs';
import { lock } from 'proper-lockfile';
import path from 'path';

export class StateManager {
  private statePath: string;
  
  constructor() {
    this.statePath = path.join(
      process.env.HOME || '~',
      '.claudine',
      'state.json'
    );
  }
  
  async read(): Promise<State> {
    const release = await lock(this.statePath);
    try {
      const data = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(data);
    } finally {
      await release();
    }
  }
  
  async write(state: State): Promise<void> {
    const release = await lock(this.statePath);
    try {
      await fs.writeFile(
        this.statePath,
        JSON.stringify(state, null, 2)
      );
    } finally {
      await release();
    }
  }
}
```

#### Task 3: Command Implementations (6 hours)
- Implement each command class
- Add input validation
- Format output appropriately
- Handle errors gracefully

#### Task 4: Testing & Documentation (4 hours)
- Unit tests for commands
- Integration tests for state management
- Update README with CLI examples
- Add man page generation

### Dependencies
```json
{
  "commander": "^11.0.0",
  "chalk": "^5.0.0",
  "ora": "^7.0.0",
  "cli-table3": "^0.6.0",
  "proper-lockfile": "^4.1.0"
}
```

## User Experience

### Installation
```bash
# Global installation
npm install -g claudine

# Or use npx (Phase 1 - MCP commands)
npx claudine mcp start

# Future Phase 2 commands
npx claudine delegate "task"
```

### First Run
```bash
$ claudine delegate "analyze project structure"
✓ Task delegated successfully
Task ID: task-7f3a9b2c
Status: running
Use 'claudine logs task-7f3a9b2c --follow' to stream output
```

### Output Formatting
- Use colors for status (green=completed, yellow=running, red=failed)
- Provide progress indicators for long-running operations
- Format tables cleanly for list/status commands
- Support JSON output for scripting

## Testing Strategy

### Unit Tests
- Command parsing and validation
- State management operations
- Output formatting

### Integration Tests
- CLI ↔ Core integration
- Concurrent access to shared state
- MCP server and CLI running simultaneously

### E2E Tests
- Full task lifecycle via CLI
- Interoperability with MCP server
- Error scenarios and recovery

## Migration Path

### Phase 2 (Week 3)
- Day 13: Implement basic CLI with core commands
- Shared JSON state file
- No breaking changes to MCP interface

### Phase 3 (Week 5)
- Migrate to SQLite for better concurrency
- Add advanced features (templates, scheduling)
- Maintain backward compatibility

## Success Metrics

### Adoption
- 30% of users try CLI within first week
- 50% prefer CLI over MCP for certain tasks

### Performance
- Command response time < 100ms
- State file operations < 50ms
- No conflicts between CLI and MCP

### Usability
- Zero configuration required
- Intuitive command structure
- Helpful error messages

## Security Considerations

### File Permissions
- State file: 600 (user read/write only)
- Log files: 644 (user write, others read)
- Config directory: 700 (user only)

### Input Validation
- Sanitize task commands
- Validate task IDs format
- Prevent command injection

### Process Isolation
- CLI doesn't directly spawn Claude Code
- All execution through TaskManager
- Proper cleanup on exit

## Future Enhancements

### Phase 3
- Interactive mode with REPL
- Task templates
- Batch operations
- Shell completions

### Phase 4
- Web dashboard
- Remote CLI access
- Task sharing between users
- Scheduled tasks (cron-like)

## Decision Log

### Why Commander.js?
- Most popular Node.js CLI framework
- Excellent TypeScript support
- Built-in help generation
- Subcommand support

### Why JSON State (initially)?
- Simple to implement
- Human-readable for debugging
- Easy migration path to SQLite
- No additional dependencies

### Why ~/.claudine directory?
- Standard location for CLI configs
- User-specific isolation
- Easy to backup/migrate
- Follows Unix conventions