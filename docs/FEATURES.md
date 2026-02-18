# Claudine v0.3.x - Current Features

This document lists all features that are **currently implemented and working** in Claudine v0.3.x.

Last Updated: February 2026

## ✅ Core Task Delegation

### MCP Tools
- **DelegateTask**: Submit tasks to background Claude Code instances with full worktree/PR options
- **TaskStatus**: Check status of running/completed tasks
- **TaskLogs**: Retrieve stdout/stderr output from tasks (with tail option)
- **CancelTask**: Cancel running tasks with optional reason

### Task Management
- **Priority Levels**: P0 (Critical), P1 (High), P2 (Normal)
- **Task Status Tracking**: QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED
- **Per-Task Configuration**: Custom timeout and output buffer per task
- **Working Directory Support**: Run tasks in specific directories
- **Git Worktree Isolation**: Branch-based task execution with automatic creation/cleanup
- **Merge Strategies**: PR (pull request), auto, manual, patch
- **GitHub Integration**: Automatic PR creation with custom titles/descriptions
- **Retry Logic**: Exponential backoff for git push and API operations

## ✅ Autoscaling & Resource Management

### Dynamic Worker Pool
- **Automatic Scaling**: Spawns workers based on CPU and memory availability
- **Resource Monitoring**: Real-time CPU and memory usage tracking
- **Intelligent Limits**: Maintains 20% CPU headroom and 1GB RAM reserve
- **No Artificial Limits**: Uses all available system resources

### Resource Protection
- **CPU Threshold**: Configurable CPU usage limit (default: 80%)
- **Memory Reserve**: Configurable memory reserve (default: 1GB)
- **Worker Lifecycle**: Automatic cleanup on completion/failure
- **Resource Tracking**: Per-worker CPU and memory monitoring

### Settling Workers Tracking (v0.3.1+)
- **Problem Solved**: Load average is a 1-minute rolling average that doesn't reflect recent spawns
- **Settling Window**: Recently spawned workers are tracked for 15 seconds (configurable via `WORKER_SETTLING_WINDOW_MS`)
- **Resource Projection**: Includes settling workers in resource calculations to prevent spawn burst overload
- **Spawn Delay**: Minimum 10 seconds between spawns for stability (configurable via `WORKER_MIN_SPAWN_DELAY_MS`)

## ✅ Task Persistence & Recovery

### Database Storage
- **SQLite Backend**: Persistent task storage with WAL mode
- **Complete Task History**: All tasks, outputs, and metadata stored
- **Automatic Recovery**: Restores QUEUED/RUNNING tasks on startup
- **Database Cleanup**: Automatic removal of old completed tasks (7 days)

### Crash Recovery
- **State Recovery**: Resumes interrupted tasks after crashes
- **Duplicate Prevention**: Prevents re-queuing already processed tasks
- **Status Reconciliation**: Marks crashed RUNNING tasks as FAILED

## ✅ Output Management

### Buffered Output Capture
- **Memory Buffering**: In-memory capture up to configurable limit (default: 10MB)
- **File Overflow**: Automatic file storage when buffer exceeded
- **Stream Processing**: Real-time stdout/stderr capture
- **Output Repository**: Persistent storage of all task output

### Configurable Limits
- **Per-Task Buffer Size**: Override buffer limit per task (1KB - 1GB)
- **Global Defaults**: System-wide output buffer configuration
- **Automatic Cleanup**: Old output files removed with tasks

## ✅ Configuration System

### Environment Variables
- `TASK_TIMEOUT`: Default task timeout (default: 1800000ms = 30min)
- `MAX_OUTPUT_BUFFER`: Default output buffer size (default: 10MB)
- `CPU_THRESHOLD`: CPU usage threshold (default: 80%)
- `MEMORY_RESERVE`: Memory reserve in bytes (default: 1GB)
- `LOG_LEVEL`: Logging verbosity (debug/info/warn/error)

### Runtime Configuration
- **Validation**: Zod schema validation with fallbacks
- **Range Checking**: Min/max limits for all numeric values
- **Graceful Degradation**: Falls back to defaults on invalid config

## ✅ Process Management

### Claude Code Integration
- **CLI Spawning**: Spawns `claude` processes with proper arguments
- **Permission Handling**: Uses `--dangerously-skip-permissions` flag
- **Working Directory**: Supports custom working directories
- **Process Monitoring**: Tracks PIDs, exit codes, and resource usage

### Task Execution
- **Timeout Enforcement**: Configurable per-task timeouts (1s - 24h)
- **Graceful Termination**: SIGTERM then SIGKILL for task cancellation
- **Exit Code Tracking**: Captures and stores process exit codes
- **Error Handling**: Distinguishes timeout vs failure vs cancellation

## ✅ Logging & Monitoring

### Structured Logging
- **JSON Logs**: Production structured logging with context
- **Console Logs**: Development-friendly console output
- **Log Levels**: Configurable verbosity (debug/info/warn/error)
- **Context Enrichment**: Automatic context addition per module

### Monitoring
- **System Resources**: Real-time CPU/memory monitoring
- **Task Metrics**: Creation, start, completion timestamps
- **Worker Tracking**: Active worker count and resource usage
- **Error Tracking**: Structured error logging with context

## ✅ CLI Interface

### MCP Server Commands
- `claudine mcp start`: Start the MCP server
- `claudine mcp test`: Test server startup and validation
- `claudine mcp config`: Show MCP configuration examples
- `claudine help`: Show help and usage

### Direct Task Commands (New in v0.2.1)
- `claudine delegate <prompt>`: Delegate task directly to background Claude instance
- `claudine status [task-id]`: Check status of all tasks or specific task
- `claudine logs <task-id>`: Retrieve task output and logs
- `claudine cancel <task-id> [reason]`: Cancel running task with optional reason

### Configuration Examples
- **NPM Package**: Global installation support
- **Local Development**: Source code execution
- **Claude Desktop**: MCP server configuration
- **Environment Variables**: Runtime configuration options

## ✅ Architecture

### Core Components
- **MCP Adapter**: JSON-RPC 2.0 protocol implementation
- **Task Manager**: Orchestrates task lifecycle
- **Autoscaling Manager**: Dynamic worker pool management
- **Recovery Manager**: Startup task recovery
- **Resource Monitor**: System resource tracking

### Design Patterns (v0.2.1 Event-Driven Architecture)
- **Event-Driven Architecture**: Complete event-based coordination via EventBus
- **Event Handlers**: Specialized handlers (Persistence, Queue, Worker, Output)
- **Singleton EventBus**: Shared event bus across all system components
- **Zero Direct State**: TaskManager emits events, handlers manage state
- **Dependency Injection**: Container-based DI with Result types
- **Result Pattern**: No exceptions in business logic
- **Immutable Domain**: Readonly data structures
- **Database-First Pattern**: Single source of truth with no memory-database divergence
- **Proper Process Handling**: Fixed stdin management (`stdio: ['ignore', 'pipe', 'pipe']`)

## ✅ Task Dependencies (v0.3.0)

### DAG-Based Dependency Management
- **Dependency Declaration**: Tasks can depend on other tasks via `dependsOn` array in task specification
- **Cycle Detection**: DFS-based algorithm prevents circular dependencies (A→B→A patterns)
- **Transitive Cycle Detection**: Detects complex cycles across multiple tasks (A→B→C→A)
- **Automatic Resolution**: Dependencies automatically resolved on task completion/failure/cancellation
- **Blocked Task Management**: Tasks with unmet dependencies remain in BLOCKED state until resolved
- **Multiple Dependencies**: Tasks can depend on multiple prerequisite tasks simultaneously
- **Diamond Patterns**: Supports complex dependency graphs (A→B, A→C, B→D, C→D)

### Database Schema
- **Foreign Key Constraints**: Database-enforced referential integrity
- **Resolution Tracking**: Automatic resolution timestamp on dependency completion
- **Atomic Transactions**: TOCTOU-safe dependency addition with synchronous better-sqlite3 transactions
- **Composite Indexes**: Optimized queries for dependency lookups and blocked task checks

### Event-Driven Integration
- **TaskDependencyAdded**: Emitted when new dependency relationship created
- **DependencyResolved**: Emitted when blocking dependency completes
- **TaskUnblocked**: Emitted when all dependencies resolved, triggers automatic queuing

## ✅ Task Scheduling (v0.4.0)

### MCP Tools
- **ScheduleTask**: Create recurring (cron) or one-time scheduled tasks
- **ListSchedules**: List all schedules with optional status filter and pagination
- **GetSchedule**: Get schedule details including execution history
- **CancelSchedule**: Cancel an active schedule with optional reason
- **PauseSchedule**: Pause an active schedule (can be resumed later)
- **ResumeSchedule**: Resume a paused schedule

### Schedule Types
- **CRON**: Standard 5-field cron expressions for recurring task execution
- **ONE_TIME**: ISO 8601 datetime for single future execution

### Configuration
- **Timezone Support**: IANA timezone identifiers (e.g., `America/New_York`) with DST awareness
- **Missed Run Policies**: `skip` (ignore missed runs), `catchup` (execute missed runs), `fail` (mark as failed)
- **Max Runs**: Optional limit on number of executions for cron schedules
- **Expiration**: Optional ISO 8601 expiry datetime for schedules

### Concurrent Execution Prevention
- **Lock-Based Protection**: Prevents overlapping executions of the same schedule
- **Execution Tracking**: Full history of schedule executions with status and timing

### Event-Driven Integration
- **ScheduleCreated**: Emitted when a new schedule is created
- **ScheduleCancelled**: Emitted when a schedule is cancelled
- **SchedulePaused**: Emitted when a schedule is paused
- **ScheduleResumed**: Emitted when a schedule is resumed
- **ScheduleExecuted**: Emitted when a scheduled task is triggered

## ❌ NOT Implemented (Despite Some Documentation Claims)
- **Distributed Processing**: Single-server only
- **Web UI**: No dashboard interface
- **Task Templates**: No preset task configurations
- **Multi-User Support**: Single-user focused
- **REST API**: MCP protocol only

---

---

## 🆕 What's New in v0.2.1

### Event-Driven Architecture
- **Complete Rewrite**: Moved from direct method calls to event-based coordination
- **EventBus**: Central coordination hub for all system communication
- **Event Handlers**: Specialized handlers for different concerns (persistence, queue, workers, output)
- **Zero Direct State**: TaskManager is stateless, handlers manage all state via events

### Direct CLI Commands  
- **Task Management**: Direct CLI interface without MCP connection required
- **Real-time Testing**: Instant task delegation and status checking
- **Better DX**: No need to reconnect MCP server for testing

### Process Handling Improvements
- **Fixed Output Capture**: Resolved Claude CLI hanging issues
- **Proper stdin**: Uses `stdio: ['ignore', 'pipe', 'pipe']` instead of hack
- **Robust Spawning**: Eliminated stdin injection workarounds

---

**Note**: This document reflects the actual implemented features as of v0.3.x. For planned features, see [ROADMAP.md](./ROADMAP.md).