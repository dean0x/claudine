import { readFileSync } from 'fs';
import path from 'path';
import { bold, cyan, stdout } from '../ui.js';

export function showHelp(dirname: string) {
  const pkg = JSON.parse(readFileSync(path.join(dirname, '..', 'package.json'), 'utf-8'));
  const v = pkg.version ?? '0.0.0';

  stdout(`${bold(`Delegate v${v}`)} ${cyan('Task Delegation MCP Server')}

${bold('Usage:')}
  delegate <command> [options...]

${bold('MCP Server Commands:')}
  ${cyan('mcp start')}              Start the MCP server
  ${cyan('mcp test')}               Test server startup and validation
  ${cyan('mcp config')}             Show MCP configuration for Claude

${bold('Task Commands:')}
  ${cyan('delegate')} <prompt> [options]  Delegate a task (fire-and-forget; runs in current directory)
    -f, --foreground           Stream output and wait for task completion
    -p, --priority P0|P1|P2    Task priority (P0=critical, P1=high, P2=normal)
    -w, --working-directory D  Working directory for task execution
    --deps TASK_IDS            Comma-separated task IDs this task depends on (alias: --depends-on)
    -c, --continue TASK_ID     Continue from a dependency's checkpoint (alias: --continue-from)
    -t, --timeout MS           Task timeout in milliseconds
    -b, --buffer BYTES         Max output buffer size (1KB-1GB, default: 10MB)
                               (alias: --max-output-buffer)

  ${cyan('list')}, ${cyan('ls')}                     List all tasks
  ${cyan('status')} [task-id]             Get status of task(s)
    --show-dependencies        Show dependency graph for tasks
  ${cyan('logs')} <task-id> [--tail N]    Get output logs for a task (optionally limit to last N lines)
  ${cyan('cancel')} <task-id> [reason]    Cancel a running task with optional reason
  ${cyan('retry')} <task-id>              Retry a failed or completed task
  ${cyan('resume')} <task-id> [--context "additional instructions"]
                               Resume a failed/completed task with checkpoint context

${bold('Schedule Commands:')}
  ${cyan('schedule create')} <prompt> [options]   Create a scheduled task
    --cron "0 9 * * 1-5"              Cron expression (implies --type cron)
    --at "2025-03-01T09:00:00Z"       ISO 8601 datetime (implies --type one_time)
    --type cron|one_time               Explicit type (optional if --cron or --at given)
    --timezone "America/New_York"      IANA timezone (default: UTC)
    --missed-run-policy skip|catchup|fail  (default: skip)
    -p, --priority P0|P1|P2           Task priority
    -w, --working-directory DIR        Working directory
    --max-runs N                       Max executions for cron schedules
    --expires-at "ISO8601"             Schedule expiration
    --after <schedule-id>              Chain: wait for this schedule's task to complete

  ${cyan('schedule list')} [--status active|paused|...] [--limit N]
  ${cyan('schedule get')} <schedule-id> [--history] [--history-limit N]
  ${cyan('schedule cancel')} <schedule-id> [reason]
  ${cyan('schedule pause')} <schedule-id>
  ${cyan('schedule resume')} <schedule-id>

${bold('Pipeline Commands:')}
  ${cyan('pipeline')} <prompt> [<prompt>]...   Create chained one-time schedules
    Example: pipeline "set up db" "run migrations" "seed data"

${bold('Configuration:')}
  ${cyan('config show')}                Show current configuration (resolved values)
  ${cyan('config set')} <key> <value>   Set a config value (persisted to ~/.delegate/config.json)
  ${cyan('config reset')} <key>         Remove a key from config file (revert to default)
  ${cyan('config path')}                Print config file location

  ${cyan('help')}                       Show this help message

${bold('Examples:')}
  delegate mcp start                                    # Start MCP server
  delegate delegate "analyze this codebase"            # Fire-and-forget (default)
  delegate delegate "fix the bug" --foreground         # Stream output, wait
  delegate delegate "run tests" --deps task-abc123     # Wait for dependency
  delegate list                                        # List all tasks

  # Scheduling
  delegate schedule create "run tests" --cron "0 9 * * 1-5"
  delegate schedule create "deploy" --at "2025-03-01T09:00:00Z"
  delegate schedule list --status active
  delegate schedule pause <id>

  # Pipeline (sequential chained tasks)
  delegate pipeline "setup db" "run migrations" "seed data"

  # Resume failed task with context
  delegate resume <task-id> --context "Try a different approach"

  # Configuration
  delegate config show
  delegate config set timeout 300000
  delegate config reset timeout

Repository: https://github.com/dean0x/delegate`);
}
