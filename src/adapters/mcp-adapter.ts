/**
 * MCP Protocol Adapter
 * Bridges the MCP protocol with our new architecture
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { TaskManager, Logger } from '../core/interfaces.js';
import { DelegateRequest, Priority, TaskId } from '../core/domain.js';
import { match } from '../core/result.js';

// Zod schemas for MCP protocol validation
const DelegateTaskSchema = z.object({
  prompt: z.string().min(1).max(4000),
  priority: z.enum(['P0', 'P1', 'P2']).optional(),
  workingDirectory: z.string().optional(),
  useWorktree: z.boolean().optional().default(false),
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

export class MCPAdapter {
  private server: Server;

  constructor(
    private readonly taskManager: TaskManager,
    private readonly logger: Logger
  ) {
    this.server = new Server(
      {
        name: 'claudine',
        version: '0.2.0', // Bumped for new architecture
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
          default:
            throw new Error(`Unknown tool: ${name}`);
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
                    default: false,
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

    const { prompt, priority, workingDirectory, useWorktree } = parseResult.data;

    // Create request
    const request: DelegateRequest = {
      prompt,
      priority: priority as Priority,
      workingDirectory,
      useWorktree,
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

    const result = this.taskManager.getLogs(TaskId(taskId), tail);

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
}