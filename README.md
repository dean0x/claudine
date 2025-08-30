# Claudine - Claude Code Background Task Delegation MCP Server

[![npm version](https://img.shields.io/npm/v/claudine.svg)](https://www.npmjs.com/package/claudine)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)
[![CI](https://github.com/dean0x/claudine/actions/workflows/ci.yml/badge.svg)](https://github.com/dean0x/claudine/actions/workflows/ci.yml)
![MCP](https://img.shields.io/badge/MCP-Compatible-purple)

Claudine is an MCP server designed for **dedicated servers** that enables Claude Code to delegate tasks to background Claude Code instances, with automatic scaling based on available system resources.

## Features

- **Task Persistence**: SQLite-based storage with automatic recovery on startup
- **Autoscaling**: Automatically spawns workers based on available CPU and memory
- **DelegateTask**: Process tasks in parallel with no artificial limits
- **Queue Management**: Tasks queue when resources are busy, process when available
- **TaskStatus**: Real-time status of all running and queued tasks
- **TaskLogs**: Stream or retrieve execution logs from any task
- **CancelTask**: Cancel tasks with automatic resource cleanup
- **Zero Configuration**: Works optimally out of the box on dedicated servers
- **Non-interactive Mode**: Uses `--print` flag for automated Claude CLI execution

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

# Test the server in mock mode
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
├── scripts/
│   ├── install.sh            # Installation script
│   └── validate.sh           # Validation script
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

## Current Limitations

- 30-minute timeout per task (configurable via TASK_TIMEOUT env var)
- 10MB output buffer limit per task (larger outputs saved to files)
- No distributed execution across multiple machines (planned for v0.5.0)

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

- [x] Phase 1: MVP with autoscaling (Current - v0.2.0)
- [ ] Phase 2: Persistence and recovery
- [ ] Phase 3: Priority levels and dependencies  
- [ ] Phase 4: Distributed processing (multi-server)
- [ ] Phase 5: Advanced orchestration and monitoring

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details

## Support

- Report issues: [GitHub Issues](https://github.com/dean0x/claudine/issues)

## Acknowledgments

Built with the [Model Context Protocol SDK](https://modelcontextprotocol.io)