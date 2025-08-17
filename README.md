# Claudine - MCP Server for Claude Code Task Delegation

Claudine is an MCP (Model Context Protocol) server that enables Claude Code to delegate tasks to background Claude Code instances, allowing for parallel task execution without context switching.

## Features

- **DelegateTask**: Spawn background Claude Code instances with specific prompts
- **TaskStatus**: Check the status of running or completed tasks
- **TaskLogs**: Retrieve execution logs from delegated tasks  
- **CancelTask**: Cancel running tasks with optional reason
- **Auto-permissions**: Uses `--dangerously-skip-permissions` flag for autonomous file operations

## Quick Start

### Prerequisites

- Node.js 20.0.0+ 
- npm 10.0.0+
- Claude Code CLI installed (`claude` command available)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/claudine.git
cd claudine

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

Add Claudine to your Claude Code MCP configuration:

1. Find your Claude Code MCP config file:
   - macOS/Linux: `~/.config/claude/mcp_servers.json`
   - Windows: `%USERPROFILE%\.config\claude\mcp_servers.json`

2. Add Claudine to the `mcpServers` section:

```json
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["/absolute/path/to/claudine/dist/index.js"],
      "env": {}
    }
  }
}
```

3. The MCP server will be available in your next Claude Code session

## Usage

Once configured, you can use Claudine's tools in Claude Code:

### Delegate a Task

```
Use DelegateTask to run: "Create a Python script that analyzes CSV data"
```

### Check Task Status

```
Use TaskStatus to check the current task
```

### Get Task Logs

```
Use TaskLogs with taskId: <task-id-here>
```

### Cancel a Task

```
Use CancelTask with taskId: <task-id-here> and reason: "Taking too long"
```

## Development

### Available Scripts

```bash
# Development mode (with auto-reload)
npm run dev

# Build TypeScript
npm run build

# Run built server
npm start

# Type checking
npm run typecheck

# Run tests
npm test

# Clean build artifacts
npm run clean
```

### Testing

For testing without Claude CLI installed, use mock mode:

```bash
# Test with mock processes
npm run test:mock

# Test cancellation
npm run test:cancel

# Run comprehensive tests
npm run test:comprehensive

# Validate entire setup
npm run validate
```

### Project Structure

```
claudine/
├── src/
│   ├── index.ts        # Entry point
│   ├── server.ts       # MCP server implementation
│   └── types.ts        # TypeScript type definitions
├── dist/               # Compiled JavaScript
├── tests/
│   ├── unit/           # Unit tests
│   └── manual/         # Manual test scripts
├── scripts/
│   ├── install.sh      # Installation script
│   └── validate.sh     # Validation script
├── examples/           # Usage examples
├── docs/               # Documentation
├── logs/               # Execution logs
└── README.md
```

## Architecture

Claudine implements the MCP protocol to communicate with Claude Code:

1. **MCP Server**: Handles JSON-RPC requests from Claude Code
2. **Process Manager**: Spawns and manages background Claude Code instances
3. **Output Capture**: Buffers and stores process output (10MB limit)
4. **Task Registry**: Tracks task state and history (last 10 tasks)

### Task Lifecycle

1. **Queued**: Task created but not started (future feature)
2. **Running**: Claude Code process actively executing
3. **Completed**: Task finished successfully (exit code 0)
4. **Failed**: Task failed with error
5. **Cancelled**: Task manually cancelled by user

## Limitations (MVP)

- One task at a time (no queue or concurrency yet)
- Tasks don't persist across server restarts
- 30-minute timeout per task
- 10MB output buffer limit per task
- No git worktree isolation

## Troubleshooting

### Claude CLI not found

Ensure `claude` CLI is in your PATH:
```bash
which claude
```

### Server won't start

Check logs in stderr and verify Node.js version:
```bash
node --version  # Should be v20.0.0+
```

### Tasks fail immediately

Enable mock mode for testing:
```bash
MOCK_MODE=true npm run dev
```

## Roadmap

- [ ] Phase 1: MVP (Current)
- [ ] Phase 2: Task queue and concurrency
- [ ] Phase 3: Priority levels and dependencies
- [ ] Phase 4: Persistence and recovery
- [ ] Phase 5: Advanced orchestration

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details

## Support

- Report issues: [GitHub Issues](https://github.com/dean0x/claudine/issues)
- Documentation: [docs/](./docs/)
- Discord: Coming soon

## Acknowledgments

Built with the [Model Context Protocol SDK](https://modelcontextprotocol.io)