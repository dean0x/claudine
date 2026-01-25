/**
 * MCP Protocol Adapter
 * Bridges the MCP protocol with our new architecture
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { TaskManager, Logger, ScheduleRepository } from '../core/interfaces.js';
import {
  DelegateRequest,
  Priority,
  TaskId,
  Schedule,
  ScheduleId,
  ScheduleStatus,
  ScheduleType,
  MissedRunPolicy,
  createSchedule,
} from '../core/domain.js';
import { match } from '../core/result.js';
import { validatePath } from '../utils/validation.js';
import { validateCronExpression, isValidTimezone, getNextRunTime } from '../utils/cron.js';
import { EventBus } from '../core/events/event-bus.js';
import pkg from '../../package.json' with { type: 'json' };

// Zod schemas for MCP protocol validation
const DelegateTaskSchema = z.object({
  prompt: z.string().min(1).max(4000),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  workingDirectory: z.string().optional(),
  useWorktree: z.boolean().optional().default(false), // Default: false - worktrees are opt-in (safer default)
  worktreeCleanup: z.enum(['auto', 'keep', 'delete']).optional().default('auto'),
  mergeStrategy: z.enum(['pr', 'auto', 'manual', 'patch']).optional().default('pr'),
  branchName: z.string().optional(),
  baseBranch: z.string().optional(),
  autoCommit: z.boolean().optional().default(true),
  pushToRemote: z.boolean().optional().default(true),
  prTitle: z.string().optional(),
  prBody: z.string().optional(),
  timeout: z.number().min(1000).max(86400000).optional(), // 1 second to 24 hours
  maxOutputBuffer: z.number().min(1024).max(1073741824).optional(), // 1KB to 1GB
  dependsOn: z.array(z.string()).optional(), // Task IDs this task depends on
});

const TaskStatusSchema = z.object({
  taskId: z.string().optional(),
});

const TaskLogsSchema = z.object({
  taskId: z.string(),
  tail: z.number().optional().default(100),
});

const CancelTaskSchema = z.object({
  taskId: z.string(),
  reason: z.string().optional(),
});

const RetryTaskSchema = z.object({
  taskId: z.string(),
});

// Schedule-related Zod schemas (v0.4.0 Task Scheduling)
const ScheduleTaskSchema = z.object({
  prompt: z.string().min(1).max(4000).describe('Task prompt to execute'),
  scheduleType: z.enum(['cron', 'one_time']).describe('Schedule type'),
  cronExpression: z.string().optional().describe('Cron expression (5-field) for recurring schedules'),
  scheduledAt: z.string().optional().describe('ISO 8601 datetime for one-time schedules'),
  timezone: z.string().optional().default('UTC').describe('IANA timezone'),
  missedRunPolicy: z.enum(['skip', 'catchup', 'fail']).optional().default('skip'),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  workingDirectory: z.string().optional(),
  maxRuns: z.number().min(1).optional().describe('Maximum number of runs for cron schedules'),
  expiresAt: z.string().optional().describe('ISO 8601 datetime when schedule expires'),
});

const ListSchedulesSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'cancelled', 'expired']).optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

const CancelScheduleSchema = z.object({
  scheduleId: z.string().describe('Schedule ID to cancel'),
  reason: z.string().optional().describe('Reason for cancellation'),
});

const GetScheduleSchema = z.object({
  scheduleId: z.string().describe('Schedule ID'),
  includeHistory: z.boolean().optional().default(false),
  historyLimit: z.number().min(1).max(100).optional().default(10),
});

const PauseScheduleSchema = z.object({
  scheduleId: z.string().describe('Schedule ID to pause'),
});

const ResumeScheduleSchema = z.object({
  scheduleId: z.string().describe('Schedule ID to resume'),
});

export class MCPAdapter {
  private server: Server;

  constructor(
    private readonly taskManager: TaskManager,
    private readonly logger: Logger,
    private readonly scheduleRepository?: ScheduleRepository,
    private readonly eventBus?: EventBus
  ) {
    this.server = new Server(
      {
        name: 'claudine',
        version: pkg.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Get the MCP server instance for starting
   */
  getServer(): Server {
    return this.server;
  }

  private setupHandlers(): void {
    // Handle tool calls
    this.server.setRequestHandler(
      z.object({
        method: z.literal('tools/call'),
        params: z.object({
          name: z.string(),
          arguments: z.any(),
        }),
      }),
      async (request) => {
        const { name, arguments: args } = request.params;

        // SECURITY: DoS protection handled at resource level:
        // - Queue size limit (RESOURCE_EXHAUSTED error when queue full)
        // - Resource monitoring (workers only spawn when system has capacity)
        // - Spawn throttling (prevents fork bombs)
        this.logger.debug('MCP tool call received', { tool: name });

        switch (name) {
          case 'DelegateTask':
            return await this.handleDelegateTask(args);
          case 'TaskStatus':
            return await this.handleTaskStatus(args);
          case 'TaskLogs':
            return await this.handleTaskLogs(args);
          case 'CancelTask':
            return await this.handleCancelTask(args);
          case 'RetryTask':
            return await this.handleRetryTask(args);
          // Schedule tools (v0.4.0 Task Scheduling)
          case 'ScheduleTask':
            return await this.handleScheduleTask(args);
          case 'ListSchedules':
            return await this.handleListSchedules(args);
          case 'GetSchedule':
            return await this.handleGetSchedule(args);
          case 'CancelSchedule':
            return await this.handleCancelSchedule(args);
          case 'PauseSchedule':
            return await this.handlePauseSchedule(args);
          case 'ResumeSchedule':
            return await this.handleResumeSchedule(args);
          default:
            // ARCHITECTURE: Return error response instead of throwing
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Unknown tool: ${name}`,
                  code: 'INVALID_TOOL'
                }, null, 2)
              }],
              isError: true
            };
        }
      }
    );

    // List available tools
    this.server.setRequestHandler(
      z.object({
        method: z.literal('tools/list'),
      }),
      async () => {
        return {
          tools: [
            {
              name: 'DelegateTask',
              description: 'Delegate a task to a background Claude Code instance',
              inputSchema: {
                type: 'object',
                properties: {
                  prompt: {
                    type: 'string',
                    description: 'The task for Claude Code to execute',
                    minLength: 1,
                    maxLength: 4000,
                  },
                  priority: {
                    type: 'string',
                    enum: ['P0', 'P1', 'P2'],
                    description: 'Task priority (P0=critical, P1=high, P2=normal)',
                    default: 'P2',
                  },
                  workingDirectory: {
                    type: 'string',
                    description: 'Optional working directory for task execution (absolute path)',
                  },
                  useWorktree: {
                    type: 'boolean',
                    description: 'Create a git worktree for isolated execution',
                    default: true,
                  },
                  worktreeCleanup: {
                    type: 'string',
                    enum: ['auto', 'keep', 'delete'],
                    description: 'Cleanup behavior: auto (based on strategy), keep, or delete',
                    default: 'auto',
                  },
                  mergeStrategy: {
                    type: 'string',
                    enum: ['pr', 'auto', 'manual', 'patch'],
                    description: 'How to handle changes after task completion',
                    default: 'pr',
                  },
                  branchName: {
                    type: 'string',
                    description: 'Custom branch name (default: claudine/task-{id})',
                  },
                  baseBranch: {
                    type: 'string',
                    description: 'Base branch for worktree (default: current branch)',
                  },
                  autoCommit: {
                    type: 'boolean',
                    description: 'Auto-commit changes in worktree',
                    default: true,
                  },
                  pushToRemote: {
                    type: 'boolean',
                    description: 'Push branch to remote (for PR/manual strategies)',
                    default: true,
                  },
                  prTitle: {
                    type: 'string',
                    description: 'Custom PR title (for PR strategy)',
                  },
                  prBody: {
                    type: 'string',
                    description: 'Custom PR description (for PR strategy)',
                  },
                  timeout: {
                    type: 'number',
                    description: 'Task timeout in milliseconds (overrides global default)',
                    minimum: 1000,
                    maximum: 86400000, // 24 hours
                  },
                  maxOutputBuffer: {
                    type: 'number',
                    description: 'Maximum output buffer size in bytes (overrides global default)',
                    minimum: 1024,
                    maximum: 1073741824, // 1GB
                  },
                  dependsOn: {
                    type: 'array',
                    description: 'Array of task IDs this task depends on (must complete before this task can run)',
                    items: {
                      type: 'string',
                      pattern: '^task-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
                    },
                  },
                },
                required: ['prompt'],
              },
            },
            {
              name: 'TaskStatus',
              description: 'Get status of delegated tasks',
              inputSchema: {
                type: 'object',
                properties: {
                  taskId: {
                    type: 'string',
                    description: 'Task ID to check (omit for all tasks)',
                    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
                  },
                },
              },
            },
            {
              name: 'TaskLogs',
              description: 'Retrieve execution logs from a delegated task',
              inputSchema: {
                type: 'object',
                properties: {
                  taskId: {
                    type: 'string',
                    description: 'Task ID to get logs for',
                    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
                  },
                  tail: {
                    type: 'number',
                    description: 'Number of recent lines to return',
                    default: 100,
                    minimum: 1,
                    maximum: 1000,
                  },
                },
                required: ['taskId'],
              },
            },
            {
              name: 'CancelTask',
              description: 'Cancel a running delegated task',
              inputSchema: {
                type: 'object',
                properties: {
                  taskId: {
                    type: 'string',
                    description: 'Task ID to cancel',
                    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
                  },
                  reason: {
                    type: 'string',
                    description: 'Optional reason for cancellation',
                    maxLength: 200,
                  },
                },
                required: ['taskId'],
              },
            },
            {
              name: 'RetryTask',
              description: 'Retry a failed or completed task',
              inputSchema: {
                type: 'object',
                properties: {
                  taskId: {
                    type: 'string',
                    description: 'Task ID to retry',
                    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
                  },
                },
                required: ['taskId'],
              },
            },
            // Schedule tools (v0.4.0 Task Scheduling)
            {
              name: 'ScheduleTask',
              description: 'Schedule a task for future or recurring execution using cron expressions or one-time timestamps',
              inputSchema: {
                type: 'object',
                properties: {
                  prompt: {
                    type: 'string',
                    description: 'Task prompt to execute',
                  },
                  scheduleType: {
                    type: 'string',
                    enum: ['cron', 'one_time'],
                    description: 'cron for recurring, one_time for single execution',
                  },
                  cronExpression: {
                    type: 'string',
                    description: 'Cron expression (5-field: minute hour day month weekday)',
                  },
                  scheduledAt: {
                    type: 'string',
                    description: 'ISO 8601 datetime for one-time schedules',
                  },
                  timezone: {
                    type: 'string',
                    description: 'IANA timezone (default: UTC)',
                  },
                  missedRunPolicy: {
                    type: 'string',
                    enum: ['skip', 'catchup', 'fail'],
                    description: 'How to handle missed runs',
                  },
                  priority: {
                    type: 'string',
                    enum: ['P0', 'P1', 'P2'],
                  },
                  workingDirectory: {
                    type: 'string',
                  },
                  maxRuns: {
                    type: 'number',
                    description: 'Maximum runs for cron schedules',
                  },
                  expiresAt: {
                    type: 'string',
                    description: 'ISO 8601 expiration datetime',
                  },
                },
                required: ['prompt', 'scheduleType'],
              },
            },
            {
              name: 'ListSchedules',
              description: 'List all schedules with optional status filter',
              inputSchema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    enum: ['active', 'paused', 'completed', 'cancelled', 'expired'],
                  },
                  limit: {
                    type: 'number',
                    description: 'Max results (default 50)',
                  },
                  offset: {
                    type: 'number',
                    description: 'Pagination offset',
                  },
                },
              },
            },
            {
              name: 'GetSchedule',
              description: 'Get details of a specific schedule including execution history',
              inputSchema: {
                type: 'object',
                properties: {
                  scheduleId: {
                    type: 'string',
                    description: 'Schedule ID',
                  },
                  includeHistory: {
                    type: 'boolean',
                    description: 'Include execution history',
                  },
                  historyLimit: {
                    type: 'number',
                    description: 'Max history entries',
                  },
                },
                required: ['scheduleId'],
              },
            },
            {
              name: 'CancelSchedule',
              description: 'Cancel an active schedule',
              inputSchema: {
                type: 'object',
                properties: {
                  scheduleId: {
                    type: 'string',
                  },
                  reason: {
                    type: 'string',
                  },
                },
                required: ['scheduleId'],
              },
            },
            {
              name: 'PauseSchedule',
              description: 'Pause a schedule (can be resumed later)',
              inputSchema: {
                type: 'object',
                properties: {
                  scheduleId: {
                    type: 'string',
                  },
                },
                required: ['scheduleId'],
              },
            },
            {
              name: 'ResumeSchedule',
              description: 'Resume a paused schedule',
              inputSchema: {
                type: 'object',
                properties: {
                  scheduleId: {
                    type: 'string',
                  },
                },
                required: ['scheduleId'],
              },
            },
          ],
        };
      }
    );
  }

  private async handleDelegateTask(args: unknown): Promise<any> {
    // Validate input at boundary
    const parseResult = DelegateTaskSchema.safeParse(args);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation error: ${parseResult.error.message}`,
          },
        ],
        isError: true,
      };
    }

    const data = parseResult.data;

    // SECURITY: Validate workingDirectory to prevent path traversal attacks
    let validatedWorkingDirectory: string | undefined;
    if (data.workingDirectory) {
      const pathValidation = validatePath(data.workingDirectory);
      if (!pathValidation.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid working directory: ${pathValidation.error.message}`,
            },
          ],
          isError: true,
        };
      }
      validatedWorkingDirectory = pathValidation.value;
    }

    // Create request with all new fields and validated paths
    const request: DelegateRequest = {
      prompt: data.prompt,
      priority: data.priority as Priority,
      workingDirectory: validatedWorkingDirectory,
      useWorktree: data.useWorktree,
      worktreeCleanup: data.worktreeCleanup,
      mergeStrategy: data.mergeStrategy,
      branchName: data.branchName,
      baseBranch: data.baseBranch,
      autoCommit: data.autoCommit,
      pushToRemote: data.pushToRemote,
      prTitle: data.prTitle,
      prBody: data.prBody,
      timeout: data.timeout,
      maxOutputBuffer: data.maxOutputBuffer,
      dependsOn: data.dependsOn ? data.dependsOn.map(TaskId) : undefined,
    };

    // Delegate task using our new architecture
    const result = await this.taskManager.delegate(request);

    // Convert Result to MCP response
    return match(result, {
      ok: (task) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId: task.id,
              message: 'Task delegated successfully',
            }),
          },
        ],
      }),
      err: (error) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
        isError: true,
      }),
    });
  }

  private async handleTaskStatus(args: unknown): Promise<any> {
    const parseResult = TaskStatusSchema.safeParse(args);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation error: ${parseResult.error.message}`,
          },
        ],
        isError: true,
      };
    }

    const { taskId } = parseResult.data;

    const result = await this.taskManager.getStatus(
      taskId ? TaskId(taskId) : undefined
    );

    return match(result, {
      ok: (data) => {
        if (Array.isArray(data)) {
          // Multiple tasks
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  tasks: data,
                }),
              },
            ],
          };
        } else {
          // Single task - TypeScript needs help with type narrowing
          const task = data as Exclude<typeof data, readonly any[]>;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  taskId: task.id,
                  status: task.status,
                  prompt: task.prompt.substring(0, 100) + '...',
                  startTime: task.startedAt,
                  endTime: task.completedAt,
                  duration: task.completedAt && task.startedAt
                    ? task.completedAt - task.startedAt
                    : undefined,
                  exitCode: task.exitCode,
                  workingDirectory: task.workingDirectory,
                }),
              },
            ],
          };
        }
      },
      err: (error) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
        isError: true,
      }),
    });
  }

  private async handleTaskLogs(args: unknown): Promise<any> {
    const parseResult = TaskLogsSchema.safeParse(args);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation error: ${parseResult.error.message}`,
          },
        ],
        isError: true,
      };
    }

    const { taskId, tail } = parseResult.data;

    const result = await this.taskManager.getLogs(TaskId(taskId), tail);

    return match(result, {
      ok: (output) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId: output.taskId,
              output: output.stdout.join(''),
              errors: output.stderr.join(''),
              lineCount: {
                output: output.stdout.length,
                errors: output.stderr.length,
              },
            }),
          },
        ],
      }),
      err: (error) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
        isError: true,
      }),
    });
  }

  private async handleCancelTask(args: unknown): Promise<any> {
    const parseResult = CancelTaskSchema.safeParse(args);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation error: ${parseResult.error.message}`,
          },
        ],
        isError: true,
      };
    }

    const { taskId, reason } = parseResult.data;

    const result = await this.taskManager.cancel(TaskId(taskId), reason);

    return match(result, {
      ok: () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Task ${taskId} cancelled`,
            }),
          },
        ],
      }),
      err: (error) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
        isError: true,
      }),
    });
  }

  private async handleRetryTask(args: unknown): Promise<any> {
    const parseResult = RetryTaskSchema.safeParse(args);

    if (!parseResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation error: ${parseResult.error.message}`,
          },
        ],
        isError: true,
      };
    }

    const { taskId } = parseResult.data;

    const result = await this.taskManager.retry(TaskId(taskId));

    return match(result, {
      ok: (newTask) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Task ${taskId} retried successfully`,
              newTaskId: newTask.id,
              retryCount: newTask.retryCount || 1,
              parentTaskId: newTask.parentTaskId,
            }),
          },
        ],
      }),
      err: (error) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
        isError: true,
      }),
    });
  }

  // ============================================================================
  // SCHEDULE HANDLERS (v0.4.0 Task Scheduling)
  // ============================================================================

  /**
   * Handle ScheduleTask tool call
   * Creates a new schedule for recurring or one-time task execution
   */
  private async handleScheduleTask(args: unknown): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    // Validate input at boundary
    const parseResult = ScheduleTaskSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [{ type: 'text', text: `Validation error: ${parseResult.error.message}` }],
        isError: true,
      };
    }
    const data = parseResult.data;

    // Validate schedule type requirements
    if (data.scheduleType === 'cron' && !data.cronExpression) {
      return {
        content: [{ type: 'text', text: 'cronExpression is required for cron schedules' }],
        isError: true,
      };
    }
    if (data.scheduleType === 'one_time' && !data.scheduledAt) {
      return {
        content: [{ type: 'text', text: 'scheduledAt is required for one-time schedules' }],
        isError: true,
      };
    }

    // Validate cron expression
    if (data.cronExpression) {
      const cronResult = validateCronExpression(data.cronExpression);
      if (!cronResult.ok) {
        return {
          content: [{ type: 'text', text: cronResult.error.message }],
          isError: true,
        };
      }
    }

    // Validate timezone
    const tz = data.timezone ?? 'UTC';
    if (!isValidTimezone(tz)) {
      return {
        content: [{ type: 'text', text: `Invalid timezone: ${data.timezone}` }],
        isError: true,
      };
    }

    // Parse scheduledAt if provided
    let scheduledAtMs: number | undefined;
    if (data.scheduledAt) {
      scheduledAtMs = Date.parse(data.scheduledAt);
      if (isNaN(scheduledAtMs)) {
        return {
          content: [{ type: 'text', text: `Invalid scheduledAt datetime: ${data.scheduledAt}` }],
          isError: true,
        };
      }
      if (scheduledAtMs <= Date.now()) {
        return {
          content: [{ type: 'text', text: 'scheduledAt must be in the future' }],
          isError: true,
        };
      }
    }

    // Parse expiresAt if provided
    let expiresAtMs: number | undefined;
    if (data.expiresAt) {
      expiresAtMs = Date.parse(data.expiresAt);
      if (isNaN(expiresAtMs)) {
        return {
          content: [{ type: 'text', text: `Invalid expiresAt datetime: ${data.expiresAt}` }],
          isError: true,
        };
      }
    }

    // Calculate nextRunAt
    let nextRunAt: number;
    if (data.scheduleType === 'cron' && data.cronExpression) {
      const nextResult = getNextRunTime(data.cronExpression, tz);
      if (!nextResult.ok) {
        return {
          content: [{ type: 'text', text: nextResult.error.message }],
          isError: true,
        };
      }
      nextRunAt = nextResult.value;
    } else {
      nextRunAt = scheduledAtMs!;
    }

    // Create schedule
    const schedule = createSchedule({
      taskTemplate: {
        prompt: data.prompt,
        priority: data.priority as Priority | undefined,
        workingDirectory: data.workingDirectory,
      },
      scheduleType: data.scheduleType === 'cron' ? ScheduleType.CRON : ScheduleType.ONE_TIME,
      cronExpression: data.cronExpression,
      scheduledAt: scheduledAtMs,
      timezone: tz,
      missedRunPolicy: data.missedRunPolicy === 'catchup' ? MissedRunPolicy.CATCHUP
        : data.missedRunPolicy === 'fail' ? MissedRunPolicy.FAIL
        : MissedRunPolicy.SKIP,
      maxRuns: data.maxRuns,
      expiresAt: expiresAtMs,
    });

    // Check dependencies are available
    if (!this.scheduleRepository || !this.eventBus) {
      return {
        content: [{ type: 'text', text: 'Schedule repository not available' }],
        isError: true,
      };
    }

    // Save schedule
    const saveResult = await this.scheduleRepository.save(schedule);
    if (!saveResult.ok) {
      return {
        content: [{ type: 'text', text: `Failed to save schedule: ${saveResult.error.message}` }],
        isError: true,
      };
    }

    // Emit event
    await this.eventBus.emit('ScheduleCreated', { schedule });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          scheduleId: schedule.id,
          scheduleType: schedule.scheduleType,
          nextRunAt: new Date(nextRunAt).toISOString(),
          timezone: schedule.timezone,
          status: schedule.status,
        }, null, 2),
      }],
    };
  }

  /**
   * Handle ListSchedules tool call
   * Lists schedules with optional status filter and pagination
   */
  private async handleListSchedules(args: unknown): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const parseResult = ListSchedulesSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [{ type: 'text', text: `Validation error: ${parseResult.error.message}` }],
        isError: true,
      };
    }

    if (!this.scheduleRepository) {
      return {
        content: [{ type: 'text', text: 'Schedule repository not available' }],
        isError: true,
      };
    }

    const { status, limit, offset } = parseResult.data;

    let schedules: readonly Schedule[];
    if (status) {
      const statusResult = await this.scheduleRepository.findByStatus(status as ScheduleStatus);
      if (!statusResult.ok) {
        return {
          content: [{ type: 'text', text: `Failed to list schedules: ${statusResult.error.message}` }],
          isError: true,
        };
      }
      // Apply pagination manually for findByStatus
      schedules = statusResult.value.slice(offset, offset + limit);
    } else {
      const result = await this.scheduleRepository.findAll(limit, offset);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Failed to list schedules: ${result.error.message}` }],
          isError: true,
        };
      }
      schedules = result.value;
    }

    const simplifiedSchedules = schedules.map(s => ({
      id: s.id,
      status: s.status,
      scheduleType: s.scheduleType,
      cronExpression: s.cronExpression,
      nextRunAt: s.nextRunAt ? new Date(s.nextRunAt).toISOString() : null,
      runCount: s.runCount,
      maxRuns: s.maxRuns,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          schedules: simplifiedSchedules,
          count: simplifiedSchedules.length,
        }, null, 2),
      }],
    };
  }

  /**
   * Handle GetSchedule tool call
   * Gets details of a specific schedule with optional execution history
   */
  private async handleGetSchedule(args: unknown): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const parseResult = GetScheduleSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [{ type: 'text', text: `Validation error: ${parseResult.error.message}` }],
        isError: true,
      };
    }

    if (!this.scheduleRepository) {
      return {
        content: [{ type: 'text', text: 'Schedule repository not available' }],
        isError: true,
      };
    }

    const { scheduleId, includeHistory, historyLimit } = parseResult.data;

    const scheduleResult = await this.scheduleRepository.findById(ScheduleId(scheduleId));
    if (!scheduleResult.ok) {
      return {
        content: [{ type: 'text', text: `Failed to get schedule: ${scheduleResult.error.message}` }],
        isError: true,
      };
    }

    if (!scheduleResult.value) {
      return {
        content: [{ type: 'text', text: `Schedule ${scheduleId} not found` }],
        isError: true,
      };
    }

    const schedule = scheduleResult.value;
    const response: Record<string, unknown> = {
      success: true,
      schedule: {
        id: schedule.id,
        status: schedule.status,
        scheduleType: schedule.scheduleType,
        cronExpression: schedule.cronExpression,
        scheduledAt: schedule.scheduledAt ? new Date(schedule.scheduledAt).toISOString() : null,
        timezone: schedule.timezone,
        missedRunPolicy: schedule.missedRunPolicy,
        maxRuns: schedule.maxRuns,
        runCount: schedule.runCount,
        lastRunAt: schedule.lastRunAt ? new Date(schedule.lastRunAt).toISOString() : null,
        nextRunAt: schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : null,
        expiresAt: schedule.expiresAt ? new Date(schedule.expiresAt).toISOString() : null,
        createdAt: new Date(schedule.createdAt).toISOString(),
        updatedAt: new Date(schedule.updatedAt).toISOString(),
        taskTemplate: {
          prompt: schedule.taskTemplate.prompt.substring(0, 100) + (schedule.taskTemplate.prompt.length > 100 ? '...' : ''),
          priority: schedule.taskTemplate.priority,
          workingDirectory: schedule.taskTemplate.workingDirectory,
        },
      },
    };

    // Include execution history if requested
    if (includeHistory) {
      const historyResult = await this.scheduleRepository.getExecutionHistory(
        ScheduleId(scheduleId),
        historyLimit
      );
      if (historyResult.ok) {
        response.history = historyResult.value.map(h => ({
          scheduledFor: new Date(h.scheduledFor).toISOString(),
          executedAt: h.executedAt ? new Date(h.executedAt).toISOString() : null,
          status: h.status,
          taskId: h.taskId,
          errorMessage: h.errorMessage,
        }));
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2),
      }],
    };
  }

  /**
   * Handle CancelSchedule tool call
   * Cancels an active schedule
   */
  private async handleCancelSchedule(args: unknown): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const parseResult = CancelScheduleSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [{ type: 'text', text: `Validation error: ${parseResult.error.message}` }],
        isError: true,
      };
    }

    if (!this.scheduleRepository || !this.eventBus) {
      return {
        content: [{ type: 'text', text: 'Schedule repository not available' }],
        isError: true,
      };
    }

    const { scheduleId, reason } = parseResult.data;

    // Verify schedule exists
    const scheduleResult = await this.scheduleRepository.findById(ScheduleId(scheduleId));
    if (!scheduleResult.ok) {
      return {
        content: [{ type: 'text', text: `Failed to get schedule: ${scheduleResult.error.message}` }],
        isError: true,
      };
    }

    if (!scheduleResult.value) {
      return {
        content: [{ type: 'text', text: `Schedule ${scheduleId} not found` }],
        isError: true,
      };
    }

    // Emit cancel event
    await this.eventBus.emit('ScheduleCancelled', {
      scheduleId: ScheduleId(scheduleId),
      reason,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Schedule ${scheduleId} cancelled`,
          reason,
        }, null, 2),
      }],
    };
  }

  /**
   * Handle PauseSchedule tool call
   * Pauses an active schedule (can be resumed later)
   */
  private async handlePauseSchedule(args: unknown): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const parseResult = PauseScheduleSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [{ type: 'text', text: `Validation error: ${parseResult.error.message}` }],
        isError: true,
      };
    }

    if (!this.scheduleRepository || !this.eventBus) {
      return {
        content: [{ type: 'text', text: 'Schedule repository not available' }],
        isError: true,
      };
    }

    const { scheduleId } = parseResult.data;

    // Verify schedule exists and is active
    const scheduleResult = await this.scheduleRepository.findById(ScheduleId(scheduleId));
    if (!scheduleResult.ok) {
      return {
        content: [{ type: 'text', text: `Failed to get schedule: ${scheduleResult.error.message}` }],
        isError: true,
      };
    }

    if (!scheduleResult.value) {
      return {
        content: [{ type: 'text', text: `Schedule ${scheduleId} not found` }],
        isError: true,
      };
    }

    if (scheduleResult.value.status !== ScheduleStatus.ACTIVE) {
      return {
        content: [{ type: 'text', text: `Schedule ${scheduleId} is not active (status: ${scheduleResult.value.status})` }],
        isError: true,
      };
    }

    // Emit pause event
    await this.eventBus.emit('SchedulePaused', {
      scheduleId: ScheduleId(scheduleId),
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Schedule ${scheduleId} paused`,
        }, null, 2),
      }],
    };
  }

  /**
   * Handle ResumeSchedule tool call
   * Resumes a paused schedule
   */
  private async handleResumeSchedule(args: unknown): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    const parseResult = ResumeScheduleSchema.safeParse(args);
    if (!parseResult.success) {
      return {
        content: [{ type: 'text', text: `Validation error: ${parseResult.error.message}` }],
        isError: true,
      };
    }

    if (!this.scheduleRepository || !this.eventBus) {
      return {
        content: [{ type: 'text', text: 'Schedule repository not available' }],
        isError: true,
      };
    }

    const { scheduleId } = parseResult.data;

    // Verify schedule exists and is paused
    const scheduleResult = await this.scheduleRepository.findById(ScheduleId(scheduleId));
    if (!scheduleResult.ok) {
      return {
        content: [{ type: 'text', text: `Failed to get schedule: ${scheduleResult.error.message}` }],
        isError: true,
      };
    }

    if (!scheduleResult.value) {
      return {
        content: [{ type: 'text', text: `Schedule ${scheduleId} not found` }],
        isError: true,
      };
    }

    if (scheduleResult.value.status !== ScheduleStatus.PAUSED) {
      return {
        content: [{ type: 'text', text: `Schedule ${scheduleId} is not paused (status: ${scheduleResult.value.status})` }],
        isError: true,
      };
    }

    // Emit resume event
    await this.eventBus.emit('ScheduleResumed', {
      scheduleId: ScheduleId(scheduleId),
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Schedule ${scheduleId} resumed`,
        }, null, 2),
      }],
    };
  }
}