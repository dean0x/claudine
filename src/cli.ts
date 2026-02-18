#!/usr/bin/env node

// Set process title for easy identification in ps/pgrep/pkill
process.title = 'claudine-cli';

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootstrap } from './bootstrap.js';
import { validatePath, validateBufferSize, validateTimeout } from './utils/validation.js';
import type { Task } from './core/domain.js';
import type { TaskManager, ScheduleService } from './core/interfaces.js';
import { TaskId, ScheduleId } from './core/domain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI with subcommand pattern
const args = process.argv.slice(2);
const mainCommand = args[0];
const subCommand = args[1];

/**
 * Bootstrap and resolve services, eliminating repeated boilerplate
 * Returns typed services or exits on failure
 */
async function withServices(): Promise<{
  taskManager: TaskManager;
  scheduleService: ScheduleService;
}> {
  console.log('🚀 Bootstrapping Claudine...');
  const containerResult = await bootstrap();
  if (!containerResult.ok) {
    console.error('❌ Bootstrap failed:', containerResult.error.message);
    process.exit(1);
  }
  const container = containerResult.value;

  const taskManagerResult = await container.resolve<TaskManager>('taskManager');
  if (!taskManagerResult.ok) {
    console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
    process.exit(1);
  }

  const scheduleServiceResult = container.get<ScheduleService>('scheduleService');
  if (!scheduleServiceResult.ok) {
    console.error('❌ Failed to get schedule service:', scheduleServiceResult.error.message);
    process.exit(1);
  }

  return {
    taskManager: taskManagerResult.value,
    scheduleService: scheduleServiceResult.value,
  };
}

function showHelp() {
  console.log(`
🤖 Claudine - MCP Server for Task Delegation

Usage:
  claudine <command> [options...]

MCP Server Commands:
  mcp start              Start the MCP server
  mcp test               Test server startup and validation
  mcp config             Show MCP configuration for Claude

Task Commands:
  delegate <prompt> [options]  Delegate a task to Claude Code (runs in current directory by default)
    -p, --priority P0|P1|P2    Task priority (P0=critical, P1=high, P2=normal)
    -w, --working-directory D  Working directory for task execution
    --depends-on TASK_IDS      Comma-separated task IDs this task depends on (blocks until complete)
    --use-worktree             [EXPERIMENTAL] Use git worktree for isolation (opt-in)
    --keep-worktree            Always preserve worktree after completion (requires --use-worktree)
    --delete-worktree          Always cleanup worktree after completion (requires --use-worktree)
    -s, --strategy STRATEGY    Merge strategy: pr|auto|manual|patch (default: pr)
    -b, --branch NAME          Custom branch name
    --base BRANCH              Base branch (default: current)
    -t, --timeout MS           Task timeout in milliseconds

⚠️  EXPERIMENTAL Worktree Features (advanced users only):
  worktree list              List all active worktrees with status
  worktree cleanup [options] Safely clean up old worktrees
    --strategy safe|force      Cleanup strategy (default: safe)
    --older-than N            Only remove worktrees older than N days (default: 30)
  worktree status <task-id>  Get detailed status of specific worktree

  Note: Worktrees are complex and most users don't need them. Tasks run in your
        current directory by default. Use --use-worktree to opt-in to isolation.

Schedule Commands:
  schedule create <prompt> [options]   Create a scheduled task
    --type cron|one_time               Schedule type (required)
    --cron "0 9 * * 1-5"              Cron expression (5-field, for cron type)
    --at "2025-03-01T09:00:00Z"       ISO 8601 datetime (for one_time type)
    --timezone "America/New_York"      IANA timezone (default: UTC)
    --missed-run-policy skip|catchup|fail  (default: skip)
    -p, --priority P0|P1|P2           Task priority
    -w, --working-directory DIR        Working directory
    --max-runs N                       Max executions for cron schedules
    --expires-at "ISO8601"             Schedule expiration
    --after <schedule-id>              Chain: wait for this schedule's task to complete

  schedule list [--status active|paused|...] [--limit N]
  schedule get <schedule-id> [--history] [--history-limit N]
  schedule cancel <schedule-id> [reason]
  schedule pause <schedule-id>
  schedule resume <schedule-id>

Pipeline Commands:
  pipeline <prompt> [--delay Nm <prompt>]...   Create chained one-time schedules
    Example: pipeline "set up db" --delay 5m "run migrations" --delay 10m "seed data"

Task Resumption:
  resume <task-id> [--context "additional instructions"]
    Resume a failed/completed task with context from its checkpoint

Configuration:
  config show                Show current configuration
  config set <key> <value>   Update configuration
  status [task-id]             Get status of task(s)
    --show-dependencies        Show dependency graph for tasks
  logs <task-id> [--tail N]    Get output logs for a task (optionally limit to last N lines)
  cancel <task-id> [reason]    Cancel a running task with optional reason
  retry-task <task-id>         Retry a failed or completed task
  help                         Show this help message

Examples:
  claudine mcp start                                    # Start MCP server
  claudine delegate "analyze this codebase"            # Delegate task
  claudine delegate "fix the bug" --priority P0        # High priority task
  claudine delegate "run tests" --depends-on task-abc123  # Wait for dependency

  # Scheduling
  claudine schedule create "run tests" --type cron --cron "0 9 * * 1-5"
  claudine schedule create "deploy" --type one_time --at "2025-03-01T09:00:00Z"
  claudine schedule list --status active
  claudine schedule pause <id>

  # Pipeline (sequential tasks with delays)
  claudine pipeline "setup db" --delay 5m "run migrations" --delay 10m "seed data"

  # Resume failed task with context
  claudine resume <task-id> --context "Try a different approach"

Repository: https://github.com/dean0x/claudine
`);
}

function showConfig() {
  const config = {
    mcpServers: {
      claudine: {
        command: "npx",
        args: ["-y", "claudine", "mcp", "start"]
      }
    }
  };

  console.log(`
📋 MCP Configuration for Claudine

Add this to your MCP configuration file:

${JSON.stringify(config, null, 2)}

Configuration file locations:
- Claude Code: .mcp.json (in project root)
- Claude Desktop (macOS): ~/Library/Application Support/Claude/claude_desktop_config.json
- Claude Desktop (Windows): %APPDATA%\\Claude\\claude_desktop_config.json

For local development, use:
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["/path/to/claudine/dist/index.js"]
    }
  }
}

For global installation, use:
{
  "mcpServers": {
    "claudine": {
      "command": "claudine",
      "args": ["mcp", "start"]
    }
  }
}

Learn more: https://github.com/dean0x/claudine#configuration
`);
}

async function delegateTask(prompt: string, options?: {
  priority?: 'P0' | 'P1' | 'P2';
  workingDirectory?: string;
  dependsOn?: readonly string[];
  useWorktree?: boolean;
  worktreeCleanup?: 'auto' | 'keep' | 'delete';
  mergeStrategy?: 'pr' | 'auto' | 'manual' | 'patch';
  branchName?: string;
  baseBranch?: string;
  autoCommit?: boolean;
  pushToRemote?: boolean;
  prTitle?: string;
  prBody?: string;
  timeout?: number;
  maxOutputBuffer?: number;
}) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const containerResult = await bootstrap();
    if (!containerResult.ok) {
      console.error('❌ Bootstrap failed:', containerResult.error.message);
      process.exit(1);
    }
    const container = containerResult.value;
    
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    console.log('📝 Delegating task:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
    
    const request = {
      prompt,
      ...options
    };
    
    // Log the parameters being used
    if (options) {
      console.log('🔧 Task parameters:');
      if (options.priority) console.log('  Priority:', options.priority);
      if (options.workingDirectory) console.log('  Working Directory:', options.workingDirectory);
      if (options.dependsOn && options.dependsOn.length > 0) {
        console.log('  Depends On:', options.dependsOn.join(', '));
        console.log('  ⏳ Task will wait for dependencies to complete before starting');
      }
      if (options.useWorktree) console.log('  Use Worktree:', options.useWorktree);
      if (options.timeout) console.log('  Timeout:', options.timeout, 'ms');
      if (options.maxOutputBuffer) console.log('  Max Output Buffer:', options.maxOutputBuffer, 'bytes');
    }
    
    const result = await taskManager.delegate(request);
    if (result.ok) {
      const task = result.value;
      console.log('✅ Task delegated successfully!');
      console.log('📋 Task ID:', task.id);
      console.log('🔍 Status:', task.status);
      console.log('⏰ Check status with: claudine status', task.id);
      process.exit(0);
    } else {
      console.error('❌ Failed to delegate task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function getTaskStatus(taskId?: string, showDependencies?: boolean) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const containerResult = await bootstrap();
    if (!containerResult.ok) {
      console.error('❌ Bootstrap failed:', containerResult.error.message);
      process.exit(1);
    }
    const container = containerResult.value;

    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }

    const taskManager = taskManagerResult.value as any;

    if (taskId) {
      console.log('🔍 Getting status for:', taskId);
      const result = await taskManager.getStatus(taskId);
      if (result.ok) {
        const task = result.value;
        console.log('📋 Task Details:');
        console.log('   ID:', task.id);
        console.log('   Status:', task.status);
        console.log('   Priority:', task.priority);
        if (task.startedAt) console.log('   Started:', new Date(task.startedAt).toISOString());
        if (task.completedAt) console.log('   Completed:', new Date(task.completedAt).toISOString());
        if (task.exitCode !== undefined) console.log('   Exit Code:', task.exitCode);
        if (task.completedAt && task.startedAt) {
          console.log('   Duration:', task.completedAt - task.startedAt, 'ms');
        }
        console.log('   Prompt:', task.prompt.substring(0, 100) + (task.prompt.length > 100 ? '...' : ''));

        // Show dependency information if present
        if (task.dependsOn && task.dependsOn.length > 0) {
          console.log('\n🔗 Dependencies:');
          console.log('   Depends On:', task.dependsOn.join(', '));
          if (task.dependencyState) {
            console.log('   Dependency State:', task.dependencyState);
            if (task.dependencyState === 'blocked') {
              console.log('   ⏳ Task is waiting for dependencies to complete');
            } else if (task.dependencyState === 'ready') {
              console.log('   ✅ All dependencies satisfied');
            }
          }
        }

        if (task.dependents && task.dependents.length > 0) {
          console.log('\n🔗 Dependents:');
          console.log('   Tasks blocked by this:', task.dependents.join(', '));
        }
      } else {
        console.error('❌ Failed to get task status:', result.error.message);
        process.exit(1);
      }
    } else {
      console.log('📋 Getting all tasks...');
      const result = await taskManager.getStatus();
      if (result.ok && Array.isArray(result.value) && result.value.length > 0) {
        console.log(`📋 Found ${result.value.length} tasks:\n`);
        result.value.forEach((task: Task) => {
          console.log(`${task.id} - ${task.status} - ${task.prompt.substring(0, 50)}...`);
        });
      } else if (result.ok) {
        console.log('📋 No tasks found');
      } else {
        console.error('❌ Failed to get tasks:', result.error.message);
        process.exit(1);
      }
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function getTaskLogs(taskId: string, tail?: number) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const containerResult = await bootstrap();
    if (!containerResult.ok) {
      console.error('❌ Bootstrap failed:', containerResult.error.message);
      process.exit(1);
    }
    const container = containerResult.value;
    
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    console.log('📤 Getting logs for:', taskId);
    
    const result = await taskManager.getLogs(taskId);
    if (result.ok) {
      const logs = result.value;
      
      // Apply tail limit if specified
      let stdoutLines = logs.stdout || [];
      let stderrLines = logs.stderr || [];
      
      if (tail && tail > 0) {
        stdoutLines = stdoutLines.slice(-tail);
        stderrLines = stderrLines.slice(-tail);
      }
      
      if (stdoutLines.length > 0) {
        console.log('\n📤 STDOUT' + (tail ? ` (last ${tail} lines)` : '') + ':');
        stdoutLines.forEach((line: string) => console.log('  ', line));
      }
      if (stderrLines.length > 0) {
        console.log('\n📤 STDERR' + (tail ? ` (last ${tail} lines)` : '') + ':');
        stderrLines.forEach((line: string) => console.log('  ', line));
      }
      if ((!logs.stdout || logs.stdout.length === 0) && (!logs.stderr || logs.stderr.length === 0)) {
        console.log('\n📤 No output captured');
      }
      process.exit(0);
    } else {
      console.error('❌ Failed to get task logs:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function cancelTask(taskId: string, reason?: string) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const containerResult = await bootstrap();
    if (!containerResult.ok) {
      console.error('❌ Bootstrap failed:', containerResult.error.message);
      process.exit(1);
    }
    const container = containerResult.value;

    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }

    const taskManager = taskManagerResult.value as any;
    console.log('🛑 Canceling task:', taskId);
    if (reason) {
      console.log('📝 Reason:', reason);
    }

    const result = await taskManager.cancel(taskId, reason);
    if (result.ok) {
      console.log('✅ Task canceled successfully');
      process.exit(0);
    } else {
      console.error('❌ Failed to cancel task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function retryTask(taskId: string) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const containerResult = await bootstrap();
    if (!containerResult.ok) {
      console.error('❌ Bootstrap failed:', containerResult.error.message);
      process.exit(1);
    }
    const container = containerResult.value;

    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }

    const taskManager = taskManagerResult.value as any;
    console.log('🔄 Retrying task:', taskId);

    const result = await taskManager.retry(taskId);
    if (result.ok) {
      const newTask = result.value;
      console.log('✅ Retry task created successfully');
      console.log(`📝 New Task ID: ${newTask.id}`);
      console.log(`📊 Status: ${newTask.status}`);
      console.log(`🔢 Retry count: ${newTask.retryCount || 1}`);
      if (newTask.parentTaskId) {
        console.log(`🔗 Parent task: ${newTask.parentTaskId}`);
      }
      process.exit(0);
    } else {
      console.error('❌ Failed to retry task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// ============================================================================
// SCHEDULE COMMANDS
// ============================================================================

async function handleScheduleCommand(subCmd: string | undefined, scheduleArgs: string[]) {
  if (!subCmd) {
    console.error('❌ Usage: claudine schedule <create|list|get|cancel|pause|resume>');
    process.exit(1);
  }

  const { scheduleService } = await withServices();

  switch (subCmd) {
    case 'create':
      await scheduleCreate(scheduleService, scheduleArgs);
      break;
    case 'list':
      await scheduleList(scheduleService, scheduleArgs);
      break;
    case 'get':
      await scheduleGet(scheduleService, scheduleArgs);
      break;
    case 'cancel':
      await scheduleCancel(scheduleService, scheduleArgs);
      break;
    case 'pause':
      await schedulePause(scheduleService, scheduleArgs);
      break;
    case 'resume':
      await scheduleResume(scheduleService, scheduleArgs);
      break;
    default:
      console.error(`❌ Unknown schedule subcommand: ${subCmd}`);
      console.log('Valid subcommands: create, list, get, cancel, pause, resume');
      process.exit(1);
  }
  process.exit(0);
}

async function scheduleCreate(service: ScheduleService, scheduleArgs: string[]) {
  let promptWords: string[] = [];
  let scheduleType: 'cron' | 'one_time' | undefined;
  let cronExpression: string | undefined;
  let scheduledAt: string | undefined;
  let timezone: string | undefined;
  let missedRunPolicy: 'skip' | 'catchup' | 'fail' | undefined;
  let priority: 'P0' | 'P1' | 'P2' | undefined;
  let workingDirectory: string | undefined;
  let maxRuns: number | undefined;
  let expiresAt: string | undefined;
  let afterScheduleId: string | undefined;

  for (let i = 0; i < scheduleArgs.length; i++) {
    const arg = scheduleArgs[i];
    const next = scheduleArgs[i + 1];

    if (arg === '--type' && next) {
      if (next !== 'cron' && next !== 'one_time') {
        console.error('❌ --type must be "cron" or "one_time"');
        process.exit(1);
      }
      scheduleType = next;
      i++;
    } else if (arg === '--cron' && next) {
      cronExpression = next;
      i++;
    } else if (arg === '--at' && next) {
      scheduledAt = next;
      i++;
    } else if (arg === '--timezone' && next) {
      timezone = next;
      i++;
    } else if (arg === '--missed-run-policy' && next) {
      if (!['skip', 'catchup', 'fail'].includes(next)) {
        console.error('❌ --missed-run-policy must be "skip", "catchup", or "fail"');
        process.exit(1);
      }
      missedRunPolicy = next as 'skip' | 'catchup' | 'fail';
      i++;
    } else if ((arg === '--priority' || arg === '-p') && next) {
      if (!['P0', 'P1', 'P2'].includes(next)) {
        console.error('❌ Priority must be P0, P1, or P2');
        process.exit(1);
      }
      priority = next as 'P0' | 'P1' | 'P2';
      i++;
    } else if ((arg === '--working-directory' || arg === '-w') && next) {
      const pathResult = validatePath(next);
      if (!pathResult.ok) {
        console.error(`❌ Invalid working directory: ${pathResult.error.message}`);
        process.exit(1);
      }
      workingDirectory = pathResult.value;
      i++;
    } else if (arg === '--max-runs' && next) {
      maxRuns = parseInt(next);
      if (isNaN(maxRuns) || maxRuns < 1) {
        console.error('❌ --max-runs must be a positive integer');
        process.exit(1);
      }
      i++;
    } else if (arg === '--expires-at' && next) {
      expiresAt = next;
      i++;
    } else if (arg === '--after' && next) {
      afterScheduleId = next;
      i++;
    } else if (arg.startsWith('-')) {
      console.error(`❌ Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      promptWords.push(arg);
    }
  }

  const prompt = promptWords.join(' ');
  if (!prompt) {
    console.error('❌ Usage: claudine schedule create <prompt> --type cron|one_time [options]');
    process.exit(1);
  }
  if (!scheduleType) {
    console.error('❌ --type is required (cron or one_time)');
    process.exit(1);
  }

  const { ScheduleType, MissedRunPolicy, Priority } = await import('./core/domain.js');

  const result = await service.createSchedule({
    prompt,
    scheduleType: scheduleType === 'cron' ? ScheduleType.CRON : ScheduleType.ONE_TIME,
    cronExpression,
    scheduledAt,
    timezone,
    missedRunPolicy: missedRunPolicy === 'catchup' ? MissedRunPolicy.CATCHUP : missedRunPolicy === 'fail' ? MissedRunPolicy.FAIL : missedRunPolicy ? MissedRunPolicy.SKIP : undefined,
    priority: priority ? Priority[priority] : undefined,
    workingDirectory,
    maxRuns,
    expiresAt,
    afterScheduleId: afterScheduleId ? ScheduleId(afterScheduleId) : undefined,
  });

  if (result.ok) {
    console.log('✅ Schedule created successfully!');
    console.log('📋 Schedule ID:', result.value.id);
    console.log('📅 Type:', result.value.scheduleType);
    console.log('🔄 Status:', result.value.status);
    if (result.value.nextRunAt) {
      console.log('⏰ Next run:', new Date(result.value.nextRunAt).toISOString());
    }
    if (result.value.cronExpression) {
      console.log('📝 Cron:', result.value.cronExpression);
    }
    if (result.value.afterScheduleId) {
      console.log('🔗 After schedule:', result.value.afterScheduleId);
    }
  } else {
    console.error('❌ Failed to create schedule:', result.error.message);
    process.exit(1);
  }
}

async function scheduleList(service: ScheduleService, scheduleArgs: string[]) {
  let status: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < scheduleArgs.length; i++) {
    const arg = scheduleArgs[i];
    const next = scheduleArgs[i + 1];

    if (arg === '--status' && next) {
      status = next;
      i++;
    } else if (arg === '--limit' && next) {
      limit = parseInt(next);
      i++;
    }
  }

  const { ScheduleStatus } = await import('./core/domain.js');
  const statusEnum = status ? (status as keyof typeof ScheduleStatus) : undefined;

  const result = await service.listSchedules(
    statusEnum ? ScheduleStatus[statusEnum.toUpperCase() as keyof typeof ScheduleStatus] : undefined,
    limit
  );

  if (result.ok) {
    const schedules = result.value;
    if (schedules.length === 0) {
      console.log('📋 No schedules found');
    } else {
      console.log(`📋 Found ${schedules.length} schedule(s):\n`);
      for (const s of schedules) {
        const nextRun = s.nextRunAt ? new Date(s.nextRunAt).toISOString() : 'none';
        console.log(`  ${s.id} | ${s.status} | ${s.scheduleType} | runs: ${s.runCount}${s.maxRuns ? '/' + s.maxRuns : ''} | next: ${nextRun}`);
      }
    }
  } else {
    console.error('❌ Failed to list schedules:', result.error.message);
    process.exit(1);
  }
}

async function scheduleGet(service: ScheduleService, scheduleArgs: string[]) {
  const scheduleId = scheduleArgs[0];
  if (!scheduleId) {
    console.error('❌ Usage: claudine schedule get <schedule-id> [--history] [--history-limit N]');
    process.exit(1);
  }

  const includeHistory = scheduleArgs.includes('--history');
  let historyLimit: number | undefined;
  const hlIdx = scheduleArgs.indexOf('--history-limit');
  if (hlIdx !== -1 && scheduleArgs[hlIdx + 1]) {
    historyLimit = parseInt(scheduleArgs[hlIdx + 1]);
  }

  const result = await service.getSchedule(ScheduleId(scheduleId), includeHistory, historyLimit);

  if (result.ok) {
    const { schedule, history } = result.value;
    console.log('📋 Schedule Details:');
    console.log('   ID:', schedule.id);
    console.log('   Status:', schedule.status);
    console.log('   Type:', schedule.scheduleType);
    if (schedule.cronExpression) console.log('   Cron:', schedule.cronExpression);
    if (schedule.scheduledAt) console.log('   Scheduled At:', new Date(schedule.scheduledAt).toISOString());
    console.log('   Timezone:', schedule.timezone);
    console.log('   Missed Run Policy:', schedule.missedRunPolicy);
    console.log('   Run Count:', schedule.runCount + (schedule.maxRuns ? `/${schedule.maxRuns}` : ''));
    if (schedule.lastRunAt) console.log('   Last Run:', new Date(schedule.lastRunAt).toISOString());
    if (schedule.nextRunAt) console.log('   Next Run:', new Date(schedule.nextRunAt).toISOString());
    if (schedule.expiresAt) console.log('   Expires:', new Date(schedule.expiresAt).toISOString());
    if (schedule.afterScheduleId) console.log('   After Schedule:', schedule.afterScheduleId);
    console.log('   Created:', new Date(schedule.createdAt).toISOString());
    console.log('   Prompt:', schedule.taskTemplate.prompt.substring(0, 100) + (schedule.taskTemplate.prompt.length > 100 ? '...' : ''));

    if (history && history.length > 0) {
      console.log(`\n📜 Execution History (${history.length} entries):`);
      for (const h of history) {
        const scheduled = new Date(h.scheduledFor).toISOString();
        const executed = h.executedAt ? new Date(h.executedAt).toISOString() : 'n/a';
        console.log(`  ${h.status} | scheduled: ${scheduled} | executed: ${executed}${h.taskId ? ' | task: ' + h.taskId : ''}${h.errorMessage ? ' | error: ' + h.errorMessage : ''}`);
      }
    }
  } else {
    console.error('❌ Failed to get schedule:', result.error.message);
    process.exit(1);
  }
}

async function scheduleCancel(service: ScheduleService, scheduleArgs: string[]) {
  const scheduleId = scheduleArgs[0];
  if (!scheduleId) {
    console.error('❌ Usage: claudine schedule cancel <schedule-id> [reason]');
    process.exit(1);
  }
  const reason = scheduleArgs.slice(1).join(' ') || undefined;

  const result = await service.cancelSchedule(ScheduleId(scheduleId), reason);
  if (result.ok) {
    console.log(`✅ Schedule ${scheduleId} cancelled`);
    if (reason) console.log('📝 Reason:', reason);
  } else {
    console.error('❌ Failed to cancel schedule:', result.error.message);
    process.exit(1);
  }
}

async function schedulePause(service: ScheduleService, scheduleArgs: string[]) {
  const scheduleId = scheduleArgs[0];
  if (!scheduleId) {
    console.error('❌ Usage: claudine schedule pause <schedule-id>');
    process.exit(1);
  }

  const result = await service.pauseSchedule(ScheduleId(scheduleId));
  if (result.ok) {
    console.log(`✅ Schedule ${scheduleId} paused`);
  } else {
    console.error('❌ Failed to pause schedule:', result.error.message);
    process.exit(1);
  }
}

async function scheduleResume(service: ScheduleService, scheduleArgs: string[]) {
  const scheduleId = scheduleArgs[0];
  if (!scheduleId) {
    console.error('❌ Usage: claudine schedule resume <schedule-id>');
    process.exit(1);
  }

  const result = await service.resumeSchedule(ScheduleId(scheduleId));
  if (result.ok) {
    console.log(`✅ Schedule ${scheduleId} resumed`);
  } else {
    console.error('❌ Failed to resume schedule:', result.error.message);
    process.exit(1);
  }
}

// ============================================================================
// PIPELINE COMMAND
// ============================================================================

/**
 * Parse delay string like "5m", "30s", "2h" to milliseconds
 */
function parseDelay(delayStr: string): number {
  const match = delayStr.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    console.error(`❌ Invalid delay format: ${delayStr}. Use format: Ns, Nm, or Nh (e.g., 5m, 30s, 2h)`);
    process.exit(1);
  }
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return value * 1000;
  }
}

async function handlePipelineCommand(pipelineArgs: string[]) {
  if (pipelineArgs.length === 0) {
    console.error('❌ Usage: claudine pipeline <prompt> [--delay Nm <prompt>]...');
    console.error('Example: claudine pipeline "setup db" --delay 5m "run migrations" --delay 10m "seed data"');
    process.exit(1);
  }

  // Parse pipeline steps: first prompt, then pairs of --delay + prompt
  const steps: Array<{ prompt: string; delayMs: number }> = [];
  let currentPrompt: string[] = [];
  let cumulativeDelay = 0;

  for (let i = 0; i < pipelineArgs.length; i++) {
    if (pipelineArgs[i] === '--delay') {
      // Save current prompt as a step
      if (currentPrompt.length > 0) {
        steps.push({ prompt: currentPrompt.join(' '), delayMs: cumulativeDelay });
        currentPrompt = [];
      }
      // Parse delay
      if (!pipelineArgs[i + 1]) {
        console.error('❌ --delay requires a value (e.g., 5m, 30s, 2h)');
        process.exit(1);
      }
      cumulativeDelay += parseDelay(pipelineArgs[i + 1]);
      i++; // skip delay value
    } else {
      currentPrompt.push(pipelineArgs[i]);
    }
  }

  // Add final step
  if (currentPrompt.length > 0) {
    steps.push({ prompt: currentPrompt.join(' '), delayMs: cumulativeDelay });
  }

  if (steps.length === 0) {
    console.error('❌ No pipeline steps found');
    process.exit(1);
  }

  const { scheduleService } = await withServices();
  const { ScheduleType } = await import('./core/domain.js');
  const now = Date.now();
  const createdSchedules: Array<{ id: string; prompt: string; runsAt: string }> = [];
  let previousScheduleId: string | undefined;

  console.log(`📋 Creating pipeline with ${steps.length} step(s)...\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const scheduledAt = new Date(now + step.delayMs).toISOString();

    const result = await scheduleService.createSchedule({
      prompt: step.prompt,
      scheduleType: ScheduleType.ONE_TIME,
      scheduledAt,
      afterScheduleId: previousScheduleId ? ScheduleId(previousScheduleId) : undefined,
    });

    if (!result.ok) {
      console.error(`❌ Failed to create pipeline step ${i + 1}: ${result.error.message}`);
      process.exit(1);
    }

    previousScheduleId = result.value.id;
    createdSchedules.push({
      id: result.value.id,
      prompt: step.prompt.substring(0, 50) + (step.prompt.length > 50 ? '...' : ''),
      runsAt: scheduledAt,
    });
  }

  console.log('✅ Pipeline created successfully!\n');
  console.log('📋 Pipeline steps:');
  for (let i = 0; i < createdSchedules.length; i++) {
    const s = createdSchedules[i];
    const arrow = i < createdSchedules.length - 1 ? ' →' : '';
    const afterLabel = i > 0 ? ` (after ${createdSchedules[i - 1].id})` : '';
    console.log(`  ${i + 1}. [${s.id}] "${s.prompt}" at ${s.runsAt}${afterLabel}${arrow}`);
  }

  process.exit(0);
}

// ============================================================================
// RESUME COMMAND
// ============================================================================

async function handleResumeCommand(taskId: string, additionalContext?: string) {
  try {
    const { taskManager } = await withServices();

    console.log('🔄 Resuming task:', taskId);
    if (additionalContext) {
      console.log('📝 Additional context:', additionalContext);
    }

    const result = await taskManager.resume({
      taskId: TaskId(taskId),
      additionalContext,
    });

    if (result.ok) {
      const newTask = result.value;
      console.log('✅ Task resumed successfully!');
      console.log('📋 New Task ID:', newTask.id);
      console.log('🔍 Status:', newTask.status);
      if (newTask.retryCount) console.log('🔢 Retry count:', newTask.retryCount);
      if (newTask.parentTaskId) console.log('🔗 Parent task:', newTask.parentTaskId);
      process.exit(0);
    } else {
      console.error('❌ Failed to resume task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (mainCommand === 'mcp') {
  if (subCommand === 'start') {
    // For MCP, we must NOT print to stdout - just start the server
    // MCP uses stdio for communication
    const indexPath = path.join(__dirname, 'index.js');
    import(indexPath).then((module) => {
      // Call the main function if available
      if (module.main) {
        return module.main();
      }
    }).catch((error) => {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    });
    
  } else if (subCommand === 'test') {
    console.log('🧪 Testing Claudine MCP Server...\n');
    
    // Test real server startup and shutdown
    const indexPath = path.join(__dirname, 'index.js');
    const mcp = spawn('node', [indexPath], {
      stdio: ['pipe', 'pipe', 'pipe'] // Capture output for validation
    });
    
    let output = '';
    let hasError = false;
    
    // Capture stdout/stderr
    mcp.stdout?.on('data', (data) => { output += data.toString(); });
    mcp.stderr?.on('data', (data) => { output += data.toString(); });
    
    // Handle process events
    mcp.on('error', (error) => {
      console.error('❌ Failed to start server:', error.message);
      hasError = true;
    });
    
    mcp.on('exit', (code) => {
      if (hasError) {
        process.exit(1);
      }
      if (code !== 0 && code !== null) {
        console.error('❌ Server exited with non-zero code:', code);
        console.error('Output:', output);
        process.exit(1);
      }
    });
    
    // Test server starts within reasonable time
    setTimeout(() => {
      if (output.includes('Starting Claudine MCP Server') && !hasError) {
        console.log('✅ Server started successfully!');
        console.log('✅ Bootstrap completed without errors');
        mcp.kill();
        process.exit(0);
      } else {
        console.error('❌ Server failed to start properly');
        console.error('Output:', output);
        mcp.kill();
        process.exit(1);
      }
    }, 5000);
    
  } else if (subCommand === 'config') {
    showConfig();
    
  } else {
    console.error(`❌ Unknown MCP subcommand: ${subCommand || '(none)'}`);
    console.log('Valid subcommands: start, test, config');
    process.exit(1);
  }
  
} else if (mainCommand === 'delegate') {
  // Parse arguments for delegate command
  const delegateArgs = args.slice(1);
  const options: {
    priority?: 'P0' | 'P1' | 'P2';
    workingDirectory?: string;
    dependsOn?: readonly string[];
    useWorktree?: boolean;
    worktreeCleanup?: 'auto' | 'keep' | 'delete';
    mergeStrategy?: 'pr' | 'auto' | 'manual' | 'patch';
    branchName?: string;
    baseBranch?: string;
    autoCommit?: boolean;
    pushToRemote?: boolean;
    prTitle?: string;
    prBody?: string;
    timeout?: number;
    maxOutputBuffer?: number;
  } = {
    useWorktree: true,  // Default: use worktree
    worktreeCleanup: 'auto',  // Default: smart cleanup
    mergeStrategy: 'pr',  // Default: create PR
    autoCommit: true,
    pushToRemote: true
  };
  
  let promptWords: string[] = [];
  
  for (let i = 0; i < delegateArgs.length; i++) {
    const arg = delegateArgs[i];
    
    if (arg === '--priority' || arg === '-p') {
      const next = delegateArgs[i + 1];
      if (next && ['P0', 'P1', 'P2'].includes(next)) {
        options.priority = next as 'P0' | 'P1' | 'P2';
        i++; // skip next arg
      } else {
        console.error('❌ Invalid priority. Must be P0, P1, or P2');
        process.exit(1);
      }
    } else if (arg === '--working-directory' || arg === '-w') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        // Validate the path to prevent traversal attacks
        const pathResult = validatePath(next);
        if (!pathResult.ok) {
          console.error(`❌ Invalid working directory: ${pathResult.error.message}`);
          process.exit(1);
        }
        options.workingDirectory = pathResult.value;
        i++; // skip next arg
      } else {
        console.error('❌ Working directory requires a path');
        process.exit(1);
      }
    } else if (arg === '--depends-on') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        // Parse comma-separated task IDs
        const taskIds = next.split(',').map(id => id.trim()).filter(id => id.length > 0);
        if (taskIds.length === 0) {
          console.error('❌ --depends-on requires at least one task ID');
          process.exit(1);
        }
        options.dependsOn = taskIds;
        i++; // skip next arg
      } else {
        console.error('❌ --depends-on requires comma-separated task IDs');
        console.error('Example: --depends-on task-abc123 or --depends-on task-1,task-2,task-3');
        process.exit(1);
      }
    } else if (arg === '--no-worktree') {
      options.useWorktree = false;
      options.mergeStrategy = undefined; // Merge strategies don't apply without worktree
    } else if (arg === '--keep-worktree') {
      options.worktreeCleanup = 'keep';
    } else if (arg === '--delete-worktree') {
      options.worktreeCleanup = 'delete';
    } else if (arg === '--strategy' || arg === '-s') {
      const next = delegateArgs[i + 1];
      if (next && ['pr', 'auto', 'manual', 'patch'].includes(next)) {
        options.mergeStrategy = next as 'pr' | 'auto' | 'manual' | 'patch';
        i++;
      } else {
        console.error('❌ Invalid strategy. Must be pr, auto, manual, or patch');
        process.exit(1);
      }
    } else if (arg === '--branch' || arg === '-b') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.branchName = next;
        i++;
      } else {
        console.error('❌ Branch name required');
        process.exit(1);
      }
    } else if (arg === '--base') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.baseBranch = next;
        i++;
      } else {
        console.error('❌ Base branch required');
        process.exit(1);
      }
    } else if (arg === '--pr-title') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.prTitle = next;
        i++;
      } else {
        console.error('❌ PR title required');
        process.exit(1);
      }
    } else if (arg === '--pr-body') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.prBody = next;
        i++;
      } else {
        console.error('❌ PR body required');
        process.exit(1);
      }
    } else if (arg === '--no-commit') {
      options.autoCommit = false;
    } else if (arg === '--no-push') {
      options.pushToRemote = false;
    } else if (arg === '--timeout' || arg === '-t') {
      const next = delegateArgs[i + 1];
      const timeout = parseInt(next);
      const timeoutResult = validateTimeout(timeout);
      if (!timeoutResult.ok) {
        console.error(`❌ ${timeoutResult.error.message}`);
        process.exit(1);
      }
      options.timeout = timeoutResult.value;
      i++; // skip next arg
    } else if (arg === '--max-output-buffer') {
      const next = delegateArgs[i + 1];
      const buffer = parseInt(next);
      const bufferResult = validateBufferSize(buffer);
      if (!bufferResult.ok) {
        console.error(`❌ ${bufferResult.error.message}`);
        process.exit(1);
      }
      options.maxOutputBuffer = bufferResult.value;
      i++; // skip next arg
    } else if (arg.startsWith('-')) {
      console.error(`❌ Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      promptWords.push(arg);
    }
  }
  
  const prompt = promptWords.join(' ');
  if (!prompt) {
    console.error('❌ Usage: claudine delegate "<prompt>" [options]');
    console.error('Options:');
    console.error('  -p, --priority P0|P1|P2      Task priority (P0=critical, P1=high, P2=normal)');
    console.error('  -w, --working-directory DIR   Working directory for task execution');
    console.error('');
    console.error('Worktree Control:');
    console.error('  --no-worktree                 Run directly without worktree isolation');
    console.error('  --keep-worktree               Always preserve worktree after completion');
    console.error('  --delete-worktree             Always cleanup worktree after completion');
    console.error('');
    console.error('Merge Strategy (requires worktree):');
    console.error('  -s, --strategy STRATEGY       Merge strategy: pr|auto|manual|patch (default: pr)');
    console.error('  -b, --branch NAME             Custom branch name');
    console.error('  --base BRANCH                 Base branch (default: current)');
    console.error('  --no-commit                   Don\'t auto-commit changes');
    console.error('  --no-push                     Don\'t push to remote');
    console.error('  --pr-title TITLE              PR title (for pr strategy)');
    console.error('  --pr-body BODY                PR description');
    console.error('');
    console.error('Execution:');
    console.error('  -t, --timeout MS              Task timeout in milliseconds');
    console.error('  --max-output-buffer BYTES     Maximum output buffer size');
    console.error('');
    console.error('Examples:');
    console.error('  claudine delegate "refactor auth"                     # Default: PR with worktree');
    console.error('  claudine delegate "quick fix" --no-worktree           # Direct execution');
    console.error('  claudine delegate "feature" --strategy auto           # Auto-merge');
    console.error('  claudine delegate "experiment" --keep-worktree        # Preserve worktree');
    process.exit(1);
  }
  
  await delegateTask(prompt, Object.keys(options).length > 0 ? options : undefined);
  
} else if (mainCommand === 'status') {
  // Parse status command arguments
  let taskId: string | undefined;
  let showDependencies = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--show-dependencies') {
      showDependencies = true;
    } else if (!arg.startsWith('-')) {
      taskId = arg;
    }
  }

  await getTaskStatus(taskId, showDependencies);
  
} else if (mainCommand === 'logs') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine logs <task-id> [--tail N]');
    console.error('Example: claudine logs abc123');
    console.error('         claudine logs abc123 --tail 50');
    process.exit(1);
  }
  
  // Parse optional tail parameter
  let tail: number | undefined;
  const tailIndex = args.indexOf('--tail');
  if (tailIndex !== -1 && args[tailIndex + 1]) {
    const tailValue = parseInt(args[tailIndex + 1]);
    if (isNaN(tailValue) || tailValue < 1 || tailValue > 1000) {
      console.error('❌ Invalid tail value. Must be between 1 and 1000');
      process.exit(1);
    }
    tail = tailValue;
  }
  
  await getTaskLogs(taskId, tail);
  
} else if (mainCommand === 'cancel') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine cancel <task-id> [reason]');
    console.error('Example: claudine cancel abc123');
    console.error('         claudine cancel abc123 "Taking too long"');
    process.exit(1);
  }

  // Optional reason is everything after the task ID
  const reason = args.slice(2).join(' ') || undefined;
  await cancelTask(taskId, reason);

} else if (mainCommand === 'retry-task') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine retry-task <task-id>');
    console.error('Example: claudine retry-task abc123');
    process.exit(1);
  }

  await retryTask(taskId);

} else if (mainCommand === 'worktree') {
  if (subCommand === 'list') {
    console.log('🌳 Listing worktrees...');
    console.log('⚠️  Worktree management is not yet fully implemented.');
    console.log('📝 Use environment variables for now:');
    console.log('   WORKTREE_MAX_AGE_DAYS=30');
    console.log('   WORKTREE_MAX_COUNT=50');
    console.log('   WORKTREE_REQUIRE_SAFETY_CHECK=true');
  } else if (subCommand === 'cleanup') {
    console.log('🧹 Cleaning up worktrees...');
    console.log('⚠️  Worktree management is not yet fully implemented.');
    console.log('📝 Use: git worktree prune (for now)');
  } else if (subCommand === 'status') {
    const taskId = args[2];
    if (!taskId) {
      console.error('❌ Usage: claudine worktree status <task-id>');
      process.exit(1);
    }
    console.log(`🌳 Getting worktree status for task: ${taskId}`);
    console.log('⚠️  Worktree management is not yet fully implemented.');
  } else {
    console.error('❌ Usage: claudine worktree <list|cleanup|status>');
    process.exit(1);
  }

} else if (mainCommand === 'schedule') {
  await handleScheduleCommand(subCommand, args.slice(2));

} else if (mainCommand === 'pipeline') {
  await handlePipelineCommand(args.slice(1));

} else if (mainCommand === 'resume') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine resume <task-id> [--context "additional instructions"]');
    process.exit(1);
  }

  let additionalContext: string | undefined;
  const contextIndex = args.indexOf('--context');
  if (contextIndex !== -1 && args[contextIndex + 1]) {
    additionalContext = args[contextIndex + 1];
  }

  await handleResumeCommand(taskId, additionalContext);

} else if (mainCommand === 'config') {
  if (subCommand === 'show') {
    // SECURITY: Sanitize sensitive configuration values for display
    const sanitizeValue = (value: string, type: 'memory' | 'cpu' | 'timeout' | 'normal'): string => {
      const num = parseInt(value, 10);
      if (isNaN(num)) return '***REDACTED***';

      switch (type) {
        case 'memory':
          // Show memory in ranges, not exact values (security hardening)
          if (num < 1024 * 1024 * 1024) return '<1GB';
          if (num < 4 * 1024 * 1024 * 1024) return '1-4GB';
          if (num < 8 * 1024 * 1024 * 1024) return '4-8GB';
          if (num < 16 * 1024 * 1024 * 1024) return '8-16GB';
          return '>16GB';
        case 'cpu':
          // Show CPU in ranges to prevent fingerprinting
          if (num <= 2) return '1-2 cores';
          if (num <= 4) return '3-4 cores';
          if (num <= 8) return '5-8 cores';
          return '>8 cores';
        case 'timeout':
          // Show timeouts in minutes for readability, no exact values
          const minutes = Math.round(num / 60000);
          if (minutes < 5) return '<5min';
          if (minutes < 15) return '5-15min';
          if (minutes < 60) return '15-60min';
          return '>1hour';
        default:
          return value;
      }
    };

    console.log('⚙️  Current Configuration (Security Sanitized):');
    console.log('');
    console.log('🔧 Core Settings:');
    console.log(`   Task Timeout: ${sanitizeValue(process.env.TASK_TIMEOUT || '1800000', 'timeout')}`);
    console.log(`   Max Output Buffer: ${sanitizeValue(process.env.MAX_OUTPUT_BUFFER || '10485760', 'memory')}`);
    console.log(`   CPU Cores Reserved: ${sanitizeValue(process.env.CPU_CORES_RESERVED || '2', 'cpu')}`);
    console.log(`   Memory Reserve: ${sanitizeValue(process.env.MEMORY_RESERVE || '2684354560', 'memory')}`);
    console.log(`   Log Level: ${process.env.LOG_LEVEL || 'info'}`);
    console.log('');
    console.log('🌳 Worktree Settings:');
    console.log(`   Max Age: ${process.env.WORKTREE_MAX_AGE_DAYS || '30'} days`);
    console.log(`   Max Count: ${process.env.WORKTREE_MAX_COUNT || '50'} worktrees`);
    console.log(`   Safety Check: ${process.env.WORKTREE_REQUIRE_SAFETY_CHECK || 'true'}`);
    console.log('');
    console.log('⚡ Process Management:');
    console.log(`   Kill Grace Period: ${sanitizeValue(process.env.PROCESS_KILL_GRACE_PERIOD_MS || '5000', 'timeout')}`);
    console.log(`   Resource Monitor Interval: ${sanitizeValue(process.env.RESOURCE_MONITOR_INTERVAL_MS || '5000', 'timeout')}`);
    console.log(`   Min Spawn Delay: ${sanitizeValue(process.env.WORKER_MIN_SPAWN_DELAY_MS || '10000', 'timeout')}`);
    console.log('');
    console.log('🔗 Event System:');
    console.log(`   Max Listeners Per Event: ${process.env.EVENTBUS_MAX_LISTENERS_PER_EVENT || '100'}`);
    console.log(`   Max Total Subscriptions: ${process.env.EVENTBUS_MAX_TOTAL_SUBSCRIPTIONS || '1000'}`);
    console.log(`   Request Timeout: ${sanitizeValue(process.env.EVENT_REQUEST_TIMEOUT_MS || '5000', 'timeout')}`);
    console.log(`   Cleanup Interval: ${sanitizeValue(process.env.EVENT_CLEANUP_INTERVAL_MS || '60000', 'timeout')}`);
    console.log('');
    console.log('💾 Storage Settings:');
    console.log(`   File Storage Threshold: ${sanitizeValue(process.env.FILE_STORAGE_THRESHOLD_BYTES || '102400', 'memory')}`);
    console.log('');
    console.log('🔄 Retry Behavior:');
    console.log(`   Initial Delay: ${sanitizeValue(process.env.RETRY_INITIAL_DELAY_MS || '1000', 'timeout')}`);
    console.log(`   Max Delay: ${sanitizeValue(process.env.RETRY_MAX_DELAY_MS || '30000', 'timeout')}`);
    console.log('');
    console.log('🧹 Recovery Settings:');
    console.log(`   Task Retention: ${process.env.TASK_RETENTION_DAYS || '7'} days`);
    console.log('');
    console.log('⚠️  Note: Values are sanitized for security. Use --verbose for exact values (admin only).');
    console.log('📝 To change settings, use environment variables:');
    console.log('   export TASK_TIMEOUT=1800000  # Task timeout in milliseconds');
    console.log('   export WORKTREE_MAX_AGE_DAYS=30  # Minimum worktree age for cleanup');
    console.log('   export PROCESS_KILL_GRACE_PERIOD_MS=5000  # Process termination grace period');
    console.log('   export EVENT_REQUEST_TIMEOUT_MS=5000  # Event request timeout');
    console.log('   export FILE_STORAGE_THRESHOLD_BYTES=102400  # File storage threshold');
    console.log('   export RETRY_INITIAL_DELAY_MS=1000  # Initial retry delay');
  } else if (subCommand === 'set') {
    console.log('⚙️  Configuration updates are not yet implemented.');
    console.log('📝 Use environment variables for now:');
    console.log('   export WORKTREE_MAX_AGE_DAYS=30');
    console.log('   export WORKTREE_MAX_COUNT=50');
    console.log('   export WORKTREE_REQUIRE_SAFETY_CHECK=true');
  } else {
    console.error('❌ Usage: claudine config <show|set>');
    process.exit(1);
  }

} else if (mainCommand === 'help' || !mainCommand) {
  showHelp();

} else {
  console.error(`❌ Unknown command: ${mainCommand}`);
  showHelp();
  process.exit(1);
}