# Claudine v0.4.0 - Task Scheduling & Task Resumption

## Major Features

### Task Scheduling (Cron & One-Time)

Schedule tasks for future or recurring execution with full lifecycle management.

**Key Capabilities:**
- **Cron Schedules**: Standard 5-field cron expressions (`0 9 * * 1-5` for weekday mornings)
- **One-Time Schedules**: ISO 8601 datetime scheduling with timezone support
- **Timezone Support**: IANA timezone names (e.g., `America/New_York`, `Europe/London`)
- **Missed Run Policies**: `skip` (default), `catchup`, or `fail` for overdue triggers
- **Max Runs**: Limit total executions for recurring schedules
- **Expiration**: Auto-expire schedules after a given datetime
- **Execution History**: Full audit trail of every schedule trigger and resulting task

**MCP Tools (6 new):**
- `ScheduleTask` - Create cron or one-time schedules
- `ListSchedules` - List with optional status filtering
- `GetSchedule` - Get schedule details with execution history
- `CancelSchedule` - Cancel with reason tracking
- `PauseSchedule` / `ResumeSchedule` - Pause and resume schedules

**CLI Commands (6 new + pipeline):**
```bash
# Cron schedule
claudine schedule create "run linter" --type cron --cron "0 9 * * 1-5"

# One-time schedule
claudine schedule create "deploy v2" --type one_time --at "2026-03-01T09:00:00Z"

# List and manage
claudine schedule list --status active
claudine schedule get <id> --history
claudine schedule pause <id>
claudine schedule resume <id>
claudine schedule cancel <id> "no longer needed"

# Pipeline: sequential tasks with delays
claudine pipeline "set up DB" --delay 5m "run migrations" --delay 10m "seed data"
```

**Architecture:**
- `ScheduleManagerService`: Business logic extracted from MCP adapter, reused by CLI
- `ScheduleHandler`: Event-driven lifecycle management (create, trigger, cancel, pause, resume)
- `ScheduleExecutor`: Tick-based engine with configurable intervals, concurrent execution prevention, graceful shutdown
- `ScheduleRepository`: SQLite persistence with prepared statements and Zod boundary validation
- Database migrations v3-v4: `schedules` and `schedule_executions` tables with proper FK constraints

### Task Resumption

Resume failed or completed tasks with enriched context from automatic checkpoints.

**Key Capabilities:**
- **Auto-Checkpoints**: Automatically captured on task completion or failure
- **Git State Capture**: Branch, commit SHA, dirty files recorded at checkpoint time
- **Output Summary**: Last 50 lines of stdout/stderr preserved for context
- **Enriched Prompts**: Resumed tasks receive full checkpoint context in their prompt
- **Retry Chains**: Track resume lineage via `parentTaskId` and `retryOf` fields
- **Additional Context**: Provide extra instructions when resuming

**MCP Tool:**
- `ResumeTask` - Resume a terminal task with optional additional context

**CLI Command:**
```bash
claudine resume <task-id>
claudine resume <task-id> --context "Try a different approach this time"
```

**Architecture:**
- `CheckpointHandler`: Subscribes to `TaskCompleted`/`TaskFailed`, auto-captures checkpoints
- `CheckpointRepository`: SQLite persistence for `task_checkpoints` table (migration v5)
- `git-state.ts`: Utility to capture git branch, SHA, and dirty files via child_process
- `TaskManagerService.resume()`: Fetches checkpoint, constructs enriched prompt, creates new task

---

## Bug Fixes

### FK Cascade on Task/Schedule Updates
**Issue**: `INSERT OR REPLACE` in task and schedule repositories triggered `ON DELETE CASCADE`/`ON DELETE SET NULL` on child tables (`schedule_executions`, `task_checkpoints`), destroying execution history and checkpoint data during routine status updates.

**Fix**: Separated `save()` (initial insert with `INSERT OR IGNORE`) from `update()` (proper `UPDATE ... WHERE id = ?`). Refactored `PersistenceHandler` to use `update()` for all status changes.

**Impact**: Schedule execution history and task checkpoints now survive task lifecycle transitions.

### CJS/ESM Import Compatibility
**Issue**: `cron-parser@4.9.0` is CommonJS. Node.js ESM runtime cannot use named imports from CJS modules, causing `SyntaxError: Named export 'parseExpression' not found` in CI.

**Fix**: Changed to default import with destructure pattern. Added separate type-only import for TypeScript types.

**Impact**: CLI and schedule executor now work correctly in Node.js ESM environments.

---

## Infrastructure

### Schedule Service Extraction
Extracted ~375 lines of schedule business logic from MCP adapter into `ScheduleManagerService`. MCP adapter is now a thin protocol wrapper delegating to the service. CLI reuses the same service for full feature parity.

### CLI Bootstrap Helper
Added `withServices()` helper that eliminates 15-line bootstrap boilerplate repeated across every CLI command. Returns typed service references with no `as any` casts.

### Database Migrations
- **v3**: `schedules` table (schedule definitions, cron config, timezone, missed run policy)
- **v4**: `schedule_executions` table (execution history, FK to schedules and tasks)
- **v5**: `task_checkpoints` table (auto-checkpoints with git state, output summary)

---

## Test Coverage

### New Test Files (11)
- `schedule-manager.test.ts` - Service method validation, error propagation (456 lines)
- `schedule-handler.test.ts` - Event handler lifecycle tests (441 lines)
- `schedule-executor.test.ts` - Tick engine, missed run policies, concurrency (435 lines)
- `schedule-repository.test.ts` - CRUD, pagination, FK constraints (557 lines)
- `checkpoint-repository.test.ts` - CRUD, boundary validation (555 lines)
- `checkpoint-handler.test.ts` - Auto-checkpoint on task events (477 lines)
- `cron.test.ts` - Cron parsing, next run calculation, timezone (224 lines)
- `task-scheduling.test.ts` - End-to-end schedule lifecycle integration (616 lines)
- `task-resumption.test.ts` - End-to-end resume with retry chains integration (559 lines)
- `cli.test.ts` - Schedule, pipeline, and resume command coverage (693 lines added)
- `mcp-adapter.test.ts` - Updated for schedule tools

**Total**: ~9,900 lines added across 41 files. 844+ tests passing.

---

## Breaking Changes

**None** - All changes are backward compatible. Scheduling and resumption are additive features. Existing databases auto-migrate on startup.

---

## Installation

```bash
npm install -g claudine@0.4.0
```

Or add to your `.mcp.json`:
```json
{
  "mcpServers": {
    "claudine": {
      "command": "npx",
      "args": ["-y", "claudine@0.4.0", "mcp", "start"]
    }
  }
}
```

---

## What's Next

**v0.5.0** (Distributed Execution):
- Remote worker nodes
- Task routing and load balancing
- Cross-machine worktree sync

See [ROADMAP.md](../ROADMAP.md) for complete roadmap.

---

## Upgrade Notes

No special upgrade steps required. Simply update to 0.4.0:

```bash
npm install -g claudine@0.4.0
```

Existing databases will automatically migrate through v3-v5 schemas on first startup.

---

## Contributors

- **Dean Sharon** (@dean0x) - Feature design and implementation
- **Claude Code** - Development assistance and code review

---

## Links

- NPM Package: https://www.npmjs.com/package/claudine
- Documentation: https://github.com/dean0x/claudine/blob/main/docs/FEATURES.md
- Issues: https://github.com/dean0x/claudine/issues
