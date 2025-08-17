# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudine is an MCP (Model Context Protocol) server that acts as a sidekick to Claude, enabling task delegation to background Claude Code instances. It provides sophisticated task management capabilities including priority-based execution (P0, P1, P2) and dependency ordering.

## Core Architecture

### MCP Server Implementation
- Claudine operates as an MCP server that Claude can connect to via the Model Context Protocol
- Enables Claude to delegate tasks to background Claude Code instances for parallel task execution
- Implements task queue management with priority levels and dependency resolution

### Key Components

1. **Task Manager**
   - Handles task prioritization (P0 = critical, P1 = high, P2 = normal)
   - Manages task dependencies and execution order
   - Maintains task state and execution history

2. **Claude Code Instance Manager**
   - Delegates tasks to background Claude Code instances
   - Routes tasks to appropriate instances
   - Monitors instance health and resource usage

3. **MCP Protocol Handler**
   - Implements MCP server specification
   - Handles tool registration and invocation (DelegateTask, TaskStatus, etc.)
   - Manages communication between Claude and background instances

## Development Setup

### Prerequisites
- Node.js 18+ or Python 3.9+ (depending on implementation choice)
- Claude Code CLI installed
- MCP SDK for the chosen language

### Initial Setup
```bash
# Install dependencies (Node.js example)
npm install

# Or for Python
pip install -r requirements.txt
```

### Running the MCP Server
```bash
# Start the MCP server (adjust based on implementation)
npm run start

# Or for Python
python -m claudine.server
```

### Testing
```bash
# Run tests
npm test

# With coverage
npm run test:coverage
```

### Development Mode
```bash
# Run in development with auto-reload
npm run dev
```

## MCP Integration

When implementing MCP tools for Claudine, follow these patterns:

1. **Tool Registration**: All tools use PascalCase naming (DelegateTask, TaskStatus, etc.)
2. **Task Delegation**: DelegateTask accepts specifications with priority and dependencies
3. **Status Monitoring**: TaskStatus and ListTasks provide task status and health info
4. **Result Retrieval**: TaskLogs and TaskMetrics fetch results from tasks

## Task Specification Format

Tasks submitted to Claudine should follow this structure:
```json
{
  "id": "unique-task-id",
  "priority": "P0|P1|P2",
  "dependencies": ["task-id-1", "task-id-2"],
  "command": "claude-code command or instruction",
  "context": {},
  "timeout": 300000
}
```

## Testing MCP Server

Use the MCP Inspector or Claude Code to test the server:
1. Configure Claude Code MCP settings (~/.config/claude/mcp_servers.json)
2. Test tool invocations (DelegateTask, TaskStatus, CancelTask, etc.)
3. Verify background instance delegation and management

## CLI Usage

### MCP Server Commands
```bash
# Start the MCP server
claudine mcp start

# Test the server in mock mode
claudine mcp test
```

### Phase 2 - Direct Task Commands (Future)
- `claudine delegate <task>` - Delegate a task to background Claude Code instance
- `claudine status [task-id]` - Check task status (all tasks if no ID provided)
- `claudine logs <task-id>` - Get task output and logs
- `claudine cancel <task-id>` - Cancel a running task
- `claudine list` - List all tasks with their current status

### Future CLI Examples
```bash
# Delegate a simple task
claudine delegate "analyze the codebase and find all TODO comments"

# Delegate with priority
claudine delegate "fix critical bug in auth system" --priority P0

# Check status of specific task
claudine status task-abc123

# Stream logs from running task
claudine logs task-abc123 --follow

# List all tasks
claudine list --format table
```

## Important Considerations

1. **Resource Management**: Monitor and limit the number of concurrent Claude Code instances
2. **Error Handling**: Implement robust error handling for failed tasks and instance crashes
3. **Queue Persistence**: Consider implementing persistent task queue for reliability
4. **Security**: Validate all task inputs and implement appropriate sandboxing
5. **Logging**: Implement comprehensive logging for debugging and monitoring