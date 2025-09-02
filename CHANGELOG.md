# Changelog

All notable changes to Claudine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2025-09-02

### 🐛 Critical Bug Fixes
- **Task Resubmission Bug**: Fixed critical issue where tasks were resubmitted on every MCP server restart, causing Claude instances to crash
- **Duplicate Prevention**: Added `contains()` method to TaskQueue to prevent duplicate task processing
- **Database Recovery**: Improved RecoveryManager to only restore QUEUED/RUNNING tasks, not all tasks
- **Cleanup Logic**: Added automatic cleanup of old completed tasks (7 day retention) on startup
- **Output Buffer Logic**: Fixed bug where zero buffer size configurations were ignored due to falsy value handling

### 📚 Documentation Overhaul  
- **FEATURES.md**: New comprehensive documentation of all implemented features
- **ROADMAP.md**: Unified roadmap replacing 3+ conflicting versions
- **CHANGELOG.md**: Added proper version history and migration guides
- **Documentation Cleanup**: Archived outdated/conflicting documentation in `.docs/archive/`
- **README.md**: Updated to accurately reflect v0.2.1 capabilities
- **CLAUDE.md**: Updated with current architecture information

### 🛠️ Build & Development
- **Package Scripts**: Added missing npm scripts that were documented but didn't exist:
  - `npm run test:comprehensive` - Run tests with coverage
  - `npm run test:coverage` - Same as above for compatibility
  - `npm run validate` - Full validation pipeline (typecheck + build + test)
- **Configuration Examples**: Fixed MCP configuration examples to use correct entry points

### 💡 Technical Improvements
- **Mock Factories**: Updated test mock factories with new methods (cleanupOldTasks, contains)
- **Type Safety**: Enhanced TaskRepository and TaskQueue interfaces
- **Error Handling**: Better error separation in RecoveryManager

### 📝 Notes
- No breaking changes - fully backward compatible with v0.2.0
- All MCP tools continue to work exactly the same
- Database migration is automatic on first startup

## [0.2.0] - 2025-09-02

### 🚀 Added
- **Task Persistence**: SQLite database with automatic task recovery on startup
- **Autoscaling Manager**: Dynamic worker pool that scales based on CPU and memory
- **Recovery Manager**: Restores QUEUED/RUNNING tasks after crashes or restarts
- **Priority System**: P0 (Critical), P1 (High), P2 (Normal) task prioritization
- **Git Worktree Support**: Optional task isolation in separate git worktrees
- **Resource Monitoring**: Real-time CPU and memory usage tracking
- **Output Management**: Buffered output capture with file overflow
- **Configuration System**: Environment variable configuration with validation
- **Database Cleanup**: Automatic removal of old completed tasks (7 day retention)
- **Per-Task Configuration**: Override timeout and buffer size per task
- **Working Directory Support**: Run tasks in custom working directories
- **Task Status Tracking**: Complete lifecycle management (QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED)

### 🛠️ Enhanced
- **MCP Tools**: All tools now support the full feature set
  - `DelegateTask`: Added priority, timeout, maxOutputBuffer, workingDirectory, useWorktree parameters
  - `TaskStatus`: Shows comprehensive task information including resource usage
  - `TaskLogs`: Added tail parameter for log output control
  - `CancelTask`: Proper task cancellation with cleanup
- **Error Handling**: Comprehensive Result pattern implementation
- **Logging**: Structured JSON logging with contextual information
- **CLI Interface**: Full CLI implementation with `mcp start`, `mcp test`, `mcp config` commands

### 🐛 Fixed  
- **Task Resubmission Bug**: Fixed critical bug where tasks were resubmitted on every MCP server restart
- **Duplicate Prevention**: Added checks to prevent duplicate task processing
- **Memory Leaks**: Proper cleanup of completed tasks and workers
- **Process Handling**: Improved process spawning and termination

### 📚 Documentation
- **FEATURES.md**: Comprehensive list of all implemented features
- **ROADMAP.md**: Unified development roadmap with accurate timelines
- **README.md**: Updated to reflect actual v0.2.0 capabilities
- **CLAUDE.md**: Updated with current architecture and implementation status
- **Documentation Cleanup**: Archived outdated/conflicting documentation

### ⚙️ Technical
- **Dependencies**: Zod schema validation for all inputs
- **Database**: SQLite with WAL mode for better concurrency
- **Architecture**: Clean dependency injection with Result types
- **Testing**: Comprehensive test suite with mock factories
- **Build**: TypeScript compilation with proper ES modules

---

## [0.1.0] - 2025-08-XX (Initial Release)

### 🚀 Added
- **Basic MCP Server**: Initial Model Context Protocol server implementation
- **Single Task Execution**: Basic task delegation to background Claude Code instances
- **Core MCP Tools**:
  - `DelegateTask`: Submit single task for execution
  - `TaskStatus`: Basic status checking
  - `TaskLogs`: Output retrieval
  - `CancelTask`: Task cancellation
- **Process Management**: Claude Code process spawning and monitoring
- **Output Capture**: Basic stdout/stderr capture
- **CLI Interface**: Basic command-line interface

### 📝 Notes
- Single-task execution only (no concurrency)
- In-memory state (no persistence)
- Basic error handling
- Limited configuration options

---

## Development Versions

### Unreleased Features (Future Versions)

#### v0.3.0 - Task Dependencies (Planned Q4 2025)
- Task dependency resolution and execution ordering
- Conditional task execution based on dependency outcomes
- Dependency graph visualization and management
- Enhanced CLI with dependency support

#### v0.4.0 - Distributed Processing (Planned Q1 2026)
- Multi-server task distribution
- Shared task queue across instances  
- Load balancing and fault tolerance
- gRPC inter-server communication

#### v0.5.0 - Advanced Orchestration (Planned Q2 2026)
- Task templates and workflow definitions
- Conditional logic and loops in workflows
- Human approval steps
- YAML-based workflow specifications

---

## Migration Guide

### Upgrading to v0.2.0

#### For New Users
- Install via npm: `npm install -g claudine`
- Configure MCP: See [README.md](./README.md#configuration) for setup instructions
- No migration needed for new installations

#### For v0.1.0 Users
- **Task State**: All previous in-memory task state will be lost during upgrade
- **Configuration**: Check new environment variables in [README.md](./README.md#configuration)
- **MCP Tools**: Existing tool usage remains compatible, but new parameters are available
- **Database**: SQLite database will be created automatically on first run

#### Breaking Changes
- None - v0.2.0 is backward compatible with v0.1.0 MCP tool usage

---

## Support

- **Documentation**: See [README.md](./README.md) for setup and usage
- **Features**: See [FEATURES.md](./FEATURES.md) for complete feature list
- **Roadmap**: See [ROADMAP.md](./ROADMAP.md) for future plans
- **Issues**: Report bugs at [GitHub Issues](https://github.com/dean0x/claudine/issues)
- **Discussions**: Feature requests at [GitHub Discussions](https://github.com/dean0x/claudine/discussions)