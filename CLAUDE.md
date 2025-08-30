# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudine is an MCP (Model Context Protocol) server designed for dedicated servers that acts as a sidekick to Claude, enabling task delegation to background Claude Code instances. It features automatic scaling based on system resources, with no artificial worker limits - spawning as many Claude Code instances as the server can handle.

## Core Architecture

### MCP Server Implementation
- Claudine operates as an MCP server that Claude can connect to via the Model Context Protocol
- Enables Claude to delegate tasks to background Claude Code instances for parallel task execution
- Implements task queue management with priority levels and dependency resolution

### Key Components

1. **Autoscaling Manager**
   - Monitors system CPU and memory in real-time
   - Spawns new workers when resources are available
   - No artificial worker limits - uses all available resources
   - Maintains 20% CPU headroom and 1GB RAM for system stability

2. **Task Queue**
   - FIFO queue for pending tasks
   - Processes tasks as soon as resources become available
   - No queue size limits (only limited by memory)
   - Priority support (P0 = critical, P1 = high, P2 = normal)

3. **Claude Code Instance Manager**
   - Spawns background Claude Code instances dynamically
   - Each instance runs with --dangerously-skip-permissions
   - Monitors instance health and resource usage
   - Automatic cleanup on completion or failure

4. **MCP Protocol Handler**
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

# Start the MCP server
claudine mcp start
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

## Engineering Principles

**IMPORTANT**: Follow these principles strictly when implementing features:

1. **Always use Result types** - Never throw errors in business logic
2. **Inject dependencies** - Makes testing trivial
3. **Compose with pipes** - Readable, maintainable chains
4. **Immutable by default** - No mutations, return new objects
5. **Type everything** - No any types, explicit returns
6. **Test behaviors, not implementation** - Focus on integration tests
7. **Resource cleanup** - Always use try/finally or "using" pattern
8. **Structured logging** - JSON logs with context
9. **Validate at boundaries** - Parse, don't validate (Zod schemas)
10. **Performance matters** - Measure, benchmark, optimize

### Code Example (Good)
```typescript
// Result type instead of throwing
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Dependency injection
class TaskManager {
  constructor(
    private readonly processSpawner: ProcessSpawner,
    private readonly resourceMonitor: ResourceMonitor,
    private readonly logger: Logger
  ) {}
}

// Composable functions with pipes
const processTask = pipe(
  validateInput,
  checkResources,
  spawnWorker,
  captureOutput,
  handleResult
);

// Immutable updates
const updateTask = (task: Task, update: Partial<Task>): Task => ({
  ...task,
  ...update,
  updatedAt: Date.now()
});
```

## Important Considerations

1. **Dedicated Server Focus**: Claudine is designed for dedicated servers with ample resources, not constrained cloud environments
2. **Autoscaling by Default**: No configuration needed - automatically uses all available system resources
3. **Resource Management**: Maintains 20% CPU headroom and 1GB RAM reserve for system stability
4. **Error Handling**: Use Result types, never throw in business logic
5. **Queue Persistence**: Implement persistent task queue for reliability (Phase 2)
6. **Security**: Validate all task inputs at boundaries using Zod
7. **Logging**: Structured JSON logging with context
8. **No Worker Limits**: Unlike traditional approaches, we spawn as many workers as the system can handle
9. **Testing**: Focus on integration tests that verify behaviors
10. **Performance**: Measure and optimize critical paths


## Release Process

### Pre-release Checklist
1. **Clean up workspace**
   - Remove test files (*.txt, test_*.py, etc.)
   - Ensure no temporary files are committed

2. **Update version**
   ```bash
   # Update version in package.json
   npm version patch  # for bug fixes (0.1.1 -> 0.1.2)
   npm version minor  # for new features (0.1.1 -> 0.2.0)
   npm version major  # for breaking changes (0.1.1 -> 1.0.0)
   ```

3. **Create/Update RELEASE_NOTES.md**
   - Document new features, bug fixes, breaking changes
   - Include migration instructions if needed

4. **Test everything**
   ```bash
   npm run build
   npm test
   ```

### Release Steps

1. **Create Pull Request**
   ```bash
   # Commit all changes
   git add .
   git commit -m "chore: prepare v0.2.0 release"
   
   # Push branch
   git push origin feature/your-branch
   
   # Create PR via GitHub CLI
   gh pr create --title "Release v0.2.0" --body "Release notes..."
   ```

2. **After PR is merged**
   ```bash
   # Switch to main
   git checkout main
   git pull
   
   # Create and push tag
   git tag v0.2.0
   git push origin v0.2.0
   
   # Publish to npm
   npm publish
   ```

3. **Create GitHub Release**
   - Go to GitHub releases page
   - Create release from tag
   - Copy RELEASE_NOTES.md content
   - Publish release

### NPM Publishing Requirements
- Must be logged in: `npm login`
- Must have publish permissions for 'claudine' package
- Ensure all files in `files` array exist in package.json

## Important Guidelines

When working on this codebase:

1. **NO FAKE SOLUTIONS** - Never hardcode responses or data to simulate working
functionality
2. **BE TRANSPARENT** - Always explain when something is a workaround, mock, or temporary
fix
3. **FAIL HONESTLY** - If something can't work, say so clearly instead of hiding it
4. **LABEL EVERYTHING** - Use clear comments: HACK:, MOCK:, TEMPORARY:, NOT-PRODUCTION:
5. **PRODUCTION ONLY** - Unless specifically asked for mocks/demos, only implement real
solutions

When encountering limitations:
- State the blocker clearly
- Provide real alternatives
- Don't paper over problems with fake data

Preferred response format:
- "❌ This won't work because [reason]"
- "⚠️ I could work around it by [approach], but this isn't production-ready"
- "✅ Here's a real solution: [approach]"