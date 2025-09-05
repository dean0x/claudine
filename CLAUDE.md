# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claudine is an MCP (Model Context Protocol) server designed for dedicated servers that acts as a sidekick to Claude, enabling task delegation to background Claude Code instances. It features automatic scaling based on system resources, with no artificial worker limits - spawning as many Claude Code instances as the server can handle.

## Core Architecture

### MCP Server Implementation
- Claudine operates as an MCP server that Claude can connect to via the Model Context Protocol
- Enables Claude to delegate tasks to background Claude Code instances for parallel task execution
- Implements task queue management with priority levels

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
2. **Task Delegation**: DelegateTask accepts specifications with priority levels
3. **Status Monitoring**: TaskStatus and ListTasks provide task status and health info
4. **Result Retrieval**: TaskLogs and TaskMetrics fetch results from tasks

## Task Specification Format

Tasks submitted to Claudine should follow this structure:
```json
{
  "prompt": "claude-code command or instruction",
  "priority": "P0|P1|P2",
  "timeout": 300000,
  "maxOutputBuffer": 10485760,
  "workingDirectory": "/path/to/work/in",
  "useWorktree": false
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
5. **Queue Persistence**: ✅ **IMPLEMENTED** - SQLite-based persistent task queue with recovery
6. **Security**: Validate all task inputs at boundaries using Zod
7. **Logging**: Structured JSON logging with context
8. **No Worker Limits**: Unlike traditional approaches, we spawn as many workers as the system can handle
9. **Testing**: Focus on integration tests that verify behaviors
10. **Performance**: Measure and optimize critical paths

## Current Architecture (v0.2.0)

### Implemented Components
- **Task Persistence**: SQLite database with WAL mode
- **Autoscaling Manager**: Dynamic worker pool based on system resources
- **Recovery Manager**: Restores interrupted tasks on startup
- **Configuration System**: Environment-based configuration with validation
- **Output Management**: Buffered capture with file overflow
- **Resource Monitoring**: Real-time CPU/memory tracking


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

### Release Steps (CI/CD Only)

**IMPORTANT**: Only use automated CI/CD releases to prevent versioning errors.

1. **Create Pull Request**
   ```bash
   # Commit all changes
   git add .
   git commit -m "chore: prepare v0.2.1 release"
   
   # Push branch
   git push origin feature/your-branch
   
   # Create PR via GitHub CLI
   gh pr create --title "Release v0.2.1" --body "Release notes..."
   ```

2. **After PR is merged to main**
   ```bash
   # Switch to main branch
   git checkout main
   git pull origin main
   
   # Use npm version to bump AND create git tag automatically
   npm version minor  # Creates commit + tag automatically
   
   # Push both commit and tag
   git push origin main --follow-tags
   ```

3. **Create GitHub Release** (triggers automatic npm publish)
   ```bash
   # Create release - this triggers GitHub Actions CI/CD
   gh release create v0.2.1 \
     --title "🚀 Claudine v0.2.1 - Event-Driven Architecture" \
     --notes-file CHANGELOG.md \
     --generate-notes
   ```
   
   **GitHub Actions will automatically:**
   - Build and test the code
   - Publish to npm with public access  
   - Verify git tag matches package.json version
   - Fail if any step is incorrect

### Release Safeguards

To prevent versioning issues like missing tags:

1. **Always use `npm version`** - creates both version bump AND git tag
2. **Always use `--follow-tags`** - ensures tags are pushed with commits
3. **Never manual publish** - CI/CD handles npm publishing
4. **Verify before release**:
   ```bash
   git log --oneline -1  # Check latest commit
   git tag --points-at HEAD  # Verify tag exists on current commit
   git push --dry-run --follow-tags  # Verify what will be pushed
   npm run build && npm test  # Final validation
   ```

5. **Post-release verification**:
   ```bash
   # After GitHub release is created, verify everything matches:
   npm view claudine versions --json  # Check npm registry
   git tag --list | tail -5  # Check git tags
   gh release list --limit 5  # Check GitHub releases
   ```

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