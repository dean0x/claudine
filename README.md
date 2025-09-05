# Claudine - Claude Code Background Task Delegation MCP Server

[![npm version](https://img.shields.io/npm/v/claudine.svg)](https://www.npmjs.com/package/claudine)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)
[![CI](https://github.com/dean0x/claudine/actions/workflows/ci.yml/badge.svg)](https://github.com/dean0x/claudine/actions/workflows/ci.yml)
![MCP](https://img.shields.io/badge/MCP-Compatible-purple)

Claudine is an MCP server designed for **dedicated servers** that enables Claude Code to delegate tasks to background Claude Code instances, with automatic scaling based on available system resources.

## Features

✅ **Currently Available in v0.2.0**:
- **Task Persistence**: SQLite-based storage with automatic recovery on startup
- **Autoscaling**: Automatically spawns workers based on available CPU and memory  
- **Priority Levels**: P0 (Critical), P1 (High), P2 (Normal) task prioritization
- **Git Worktree Support**: Optional task isolation in separate worktrees
- **Resource Management**: Dynamic worker scaling with CPU/memory monitoring
- **Output Capture**: Buffered output with file overflow (configurable limits)
- **Recovery System**: Automatic task recovery after crashes
- **Configuration**: Environment variables and per-task overrides

📋 **MCP Tools**:
- **DelegateTask**: Submit tasks to background Claude Code instances
- **TaskStatus**: Real-time status of all running and queued tasks
- **TaskLogs**: Stream or retrieve execution logs from any task
- **CancelTask**: Cancel tasks with automatic resource cleanup

See [FEATURES.md](./FEATURES.md) for complete feature documentation.

## Quick Start

### Prerequisites

- Node.js 20.0.0+ 
- npm 10.0.0+
- Claude Code CLI installed (`claude` command available)

### System Requirements

**Minimum** (for development/testing):
- 8+ CPU cores
- 16GB RAM
- 100GB SSD

**Recommended** (for production):
- 32+ CPU cores
- 64GB+ RAM
- 500GB+ NVMe SSD
- Dedicated Linux server (Ubuntu 22.04+)

### Installation

#### Option 1: Install from npm (Recommended)
```bash
npm install -g claudine
```

#### Option 2: Install from source
```bash
# Clone the repository
git clone https://github.com/dean0x/claudine.git
cd claudine

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

#### Quick Setup

Get the configuration for your platform:
```bash
claudine mcp config
```

#### For Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "claudine": {
      "command": "npx",
      "args": ["-y", "claudine", "mcp", "start"]
    }
  }
}
```

#### For Local Development

When developing or testing Claudine locally, use the built files directly:

```json
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["/path/to/claudine/dist/cli.js", "mcp", "start"]
    }
  }
}
```

Replace `/path/to/claudine` with your actual path. You can also use relative paths if the config file is in a stable location:

```json
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["../claudine/dist/cli.js", "mcp", "start"]
    }
  }
}
```

#### For Global Installation

If you installed Claudine globally with `npm install -g claudine`:

```json
{
  "mcpServers": {
    "claudine": {
      "command": "claudine",
      "args": ["mcp", "start"]
    }
  }
}
```

After adding the configuration, restart Claude Code or Claude Desktop to connect to Claudine.

## Usage

### CLI Commands

```bash
# Start the MCP server
claudine mcp start

# Test server startup and validation
claudine mcp test

# Show MCP configuration
claudine mcp config

# Show help
claudine help
```

### MCP Tools in Claude Code

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

```bash
# Run tests
npm test

# Run comprehensive tests
npm run test:comprehensive

# Validate entire setup
npm run validate
```

### Project Structure

```
claudine/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # CLI interface
│   ├── bootstrap.ts          # Dependency injection
│   ├── core/                 # Core interfaces and types
│   ├── implementations/      # Service implementations
│   ├── services/             # Business logic
│   └── adapters/             # MCP adapter
├── dist/                     # Compiled JavaScript
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── .docs/                    # Internal documentation
└── README.md
```

## Architecture

### Dedicated Server Design

Claudine is optimized for **dedicated servers** with ample resources, not constrained environments:

- **Autoscaling Workers**: Spawns as many Claude Code instances as your system can handle
- **Dynamic Resource Monitoring**: Continuously checks CPU and memory availability
- **Queue-Based Load Management**: Processes tasks from queue as resources become available
- **Zero Configuration**: No worker limits or tuning required

### Core Components

1. **MCP Server**: Handles JSON-RPC requests from Claude Code
2. **Autoscaling Manager**: Dynamically adjusts worker count based on system resources
3. **Task Queue**: Priority-based queue for pending tasks
4. **Process Manager**: Spawns and manages background Claude Code instances
5. **Output Capture**: Buffers and stores process output (10MB limit, overflow to files)
6. **Task Persistence**: SQLite database for task history and recovery
7. **Recovery Manager**: Restores queued tasks after crashes

### Task Lifecycle

1. **Queued**: Task waiting for available resources
2. **Running**: Claude Code process actively executing
3. **Completed**: Task finished successfully (exit code 0)
4. **Failed**: Task failed with error
5. **Cancelled**: Task manually cancelled by user

## Configuration

### Environment Variables

- `TASK_TIMEOUT`: Task timeout in milliseconds (default: 1800000 = 30 minutes, range: 1000-86400000)
- `MAX_OUTPUT_BUFFER`: Output buffer size in bytes (default: 10485760 = 10MB, range: 1024-1073741824)  
- `CPU_THRESHOLD`: CPU usage threshold percentage (default: 80, range: 1-100)
- `MEMORY_RESERVE`: Memory reserve in bytes (default: 1073741824 = 1GB, range: 0+)
- `LOG_LEVEL`: Logging level (default: 'info', options: 'debug', 'info', 'warn', 'error')

### Per-Task Configuration

You can override timeout and buffer limits for individual tasks via MCP parameters:

```javascript
// Example: Long-running task with larger buffer
await claudine.DelegateTask({
  prompt: "analyze large dataset and generate report", 
  timeout: 7200000,        // 2 hours
  maxOutputBuffer: 104857600  // 100MB
});

// Example: Quick task with minimal resources  
await claudine.DelegateTask({
  prompt: "run eslint on current file",
  timeout: 30000,          // 30 seconds
  maxOutputBuffer: 1048576    // 1MB
});
```

## Current Limitations

- No task dependency resolution (planned for v0.3.0)  
- No distributed execution across multiple machines (planned for v0.4.0)
- No web dashboard (monitoring via logs only)

For complete feature list, see [FEATURES.md](./FEATURES.md).

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

Run in development mode:
```bash
npm run dev
```

## Roadmap

- [x] **v0.2.0**: Autoscaling and persistence (Current - Released Sep 2025)
- [ ] **v0.3.0**: Task dependency resolution (Q4 2025)
- [ ] **v0.4.0**: Distributed processing (Q1 2026)
- [ ] **v0.5.0**: Advanced orchestration and monitoring (Q2 2026)

See [ROADMAP.md](./ROADMAP.md) for detailed feature plans and timelines.

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details

## Support

- Report issues: [GitHub Issues](https://github.com/dean0x/claudine/issues)

## Acknowledgments

Built with the [Model Context Protocol SDK](https://modelcontextprotocol.io)