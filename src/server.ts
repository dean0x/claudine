import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { spawn, ChildProcess, execSync } from 'child_process';
import { Task, ErrorCode, ClaudineError } from './types.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export class ClaudineServer {
  private server: Server;
  private currentTask: Task | null = null;
  private taskHistory: Task[] = [];
  private readonly MAX_HISTORY = 10;
  private readonly MAX_OUTPUT_BUFFER = 10 * 1024 * 1024; // 10MB
  private currentOutputSize = 0;

  constructor() {
    this.server = new Server(
      {
        name: 'claudine',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // Handle tool calls
    this.server.setRequestHandler(
      z.object({
        method: z.literal('tools/call'),
        params: z.object({
          name: z.string(),
          arguments: z.any()
        })
      }),
      async (request) => {
        const { name, arguments: args } = request.params;
        
        if (name === 'DelegateTask') {
          return await this.handleDelegateTask(args);
        } else if (name === 'TaskStatus') {
          return await this.handleTaskStatus(args);
        } else if (name === 'TaskLogs') {
          return await this.handleTaskLogs(args);
        } else if (name === 'CancelTask') {
          return await this.handleCancelTask(args);
        }
        
        throw new Error(`Unknown tool: ${name}`);
      }
    );

    // List available tools
    this.server.setRequestHandler(
      z.object({
        method: z.literal('tools/list')
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
                workingDirectory: {
                  type: 'string',
                  description: 'Optional working directory for task execution (absolute path)',
                },
                useWorktree: {
                  type: 'boolean',
                  description: 'Create a git worktree for isolated execution (requires git repo)',
                  default: false,
                },
              },
              required: ['prompt'],
            },
          },
          {
            name: 'TaskStatus',
            description: 'Get status of a delegated task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'Task ID to check (omit for current task)',
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

  private async handleDelegateTask(args: any) {
    const schema = z.object({
      prompt: z.string().min(1).max(4000),
      workingDirectory: z.string().optional(),
      useWorktree: z.boolean().optional().default(false),
    });

    try {
      const { prompt, workingDirectory, useWorktree } = schema.parse(args);

      // Check if task already running (MVP: only one at a time)
      if (this.currentTask && this.currentTask.status === 'running') {
        throw new ClaudineError(
          ErrorCode.TASK_ALREADY_RUNNING,
          'A task is already running. Please cancel it first or wait for completion.',
          this.currentTask.id
        );
      }

      const taskId = crypto.randomUUID();
      
      // Determine working directory
      let taskCwd = process.cwd();
      let worktreePath: string | undefined;
      
      if (useWorktree) {
        // Create a git worktree for this task
        try {
          worktreePath = await this.createWorktree(taskId);
          taskCwd = worktreePath;
        } catch (error) {
          // If worktree fails, fall back to regular directory
          console.error('Failed to create worktree:', error);
          if (workingDirectory) {
            taskCwd = workingDirectory;
          }
        }
      } else if (workingDirectory) {
        // Validate and use provided working directory
        if (!path.isAbsolute(workingDirectory)) {
          throw new ClaudineError(
            ErrorCode.INVALID_PROMPT,
            'Working directory must be an absolute path'
          );
        }
        if (!fs.existsSync(workingDirectory)) {
          // Create directory if it doesn't exist
          fs.mkdirSync(workingDirectory, { recursive: true });
        }
        taskCwd = workingDirectory;
      }
      
      const task: Task = {
        id: taskId,
        prompt,
        status: 'running',
        output: [],
        errors: [],
        startTime: Date.now(),
        workingDirectory: taskCwd,
        worktreePath,
      };

      // Spawn Claude Code process with custom working directory
      const child = this.spawnClaudeProcess(prompt, taskCwd);
      task.process = child;

      // Capture output
      child.stdout?.on('data', (data: Buffer) => {
        this.captureOutput(task, data.toString(), 'stdout');
      });

      child.stderr?.on('data', (data: Buffer) => {
        this.captureOutput(task, data.toString(), 'stderr');
      });

      // Handle process exit
      child.on('exit', (code) => {
        task.status = code === 0 ? 'completed' : 'failed';
        task.exitCode = code ?? undefined;
        task.endTime = Date.now();
        this.addToHistory(task);
      });

      child.on('error', (error) => {
        task.status = 'failed';
        task.errors.push(`Process error: ${error.message}`);
        task.endTime = Date.now();
        this.addToHistory(task);
      });

      this.currentTask = task;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId,
              message: 'Task delegated successfully',
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private async handleTaskStatus(args: any) {
    const schema = z.object({
      taskId: z.string().uuid().optional(),
    });

    try {
      const { taskId } = schema.parse(args);
      
      const task = taskId 
        ? this.findTask(taskId)
        : this.currentTask;

      if (!task) {
        throw new ClaudineError(
          ErrorCode.TASK_NOT_FOUND,
          taskId ? `Task ${taskId} not found` : 'No current task'
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId: task.id,
              status: task.status,
              prompt: task.prompt.substring(0, 100) + (task.prompt.length > 100 ? '...' : ''),
              startTime: task.startTime,
              endTime: task.endTime,
              duration: task.endTime ? task.endTime - (task.startTime || 0) : undefined,
              exitCode: task.exitCode,
              workingDirectory: task.workingDirectory,
              worktreePath: task.worktreePath,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private async handleTaskLogs(args: any) {
    const schema = z.object({
      taskId: z.string().uuid(),
      tail: z.number().min(1).max(1000).default(100),
    });

    try {
      const { taskId, tail } = schema.parse(args);
      const task = this.findTask(taskId);

      if (!task) {
        throw new ClaudineError(
          ErrorCode.TASK_NOT_FOUND,
          `Task ${taskId} not found`
        );
      }

      const output = task.output.slice(-tail).join('');
      const errors = task.errors.slice(-tail).join('');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId: task.id,
              output,
              errors,
              lineCount: {
                output: task.output.length,
                errors: task.errors.length,
              },
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private async handleCancelTask(args: any) {
    const schema = z.object({
      taskId: z.string().uuid(),
      reason: z.string().max(200).optional(),
    });

    try {
      const { taskId, reason } = schema.parse(args);
      const task = this.findTask(taskId);

      if (!task) {
        throw new ClaudineError(
          ErrorCode.TASK_NOT_FOUND,
          `Task ${taskId} not found`
        );
      }

      if (task.status !== 'running') {
        throw new ClaudineError(
          ErrorCode.INTERNAL_ERROR,
          `Task ${taskId} is not running (status: ${task.status})`
        );
      }

      // Send SIGTERM to process
      if (task.process && !task.process.killed) {
        task.process.kill('SIGTERM');
        
        // Set timeout for SIGKILL if needed
        setTimeout(() => {
          if (task.process && !task.process.killed) {
            task.process.kill('SIGKILL');
          }
        }, 5000);
      }

      task.status = 'cancelled';
      task.cancelReason = reason;
      task.endTime = Date.now();
      this.addToHistory(task);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId,
              message: 'Task cancelled successfully',
              reason,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private spawnClaudeProcess(prompt: string, cwd: string = process.cwd()): ChildProcess {
    // In mock mode, use echo for testing
    const isMockMode = process.env.MOCK_MODE === 'true';
    
    let command: string;
    let args: string[];
    
    if (isMockMode) {
      // Use echo for testing without Claude CLI
      const delay = process.env.MOCK_DELAY || '2';
      command = 'sh';
      args = ['-c', `echo "Mock task execution for: ${prompt.substring(0, 50)}..." && sleep ${delay} && echo "Task completed successfully"`];
    } else {
      command = 'claude';
      args = ['--dangerously-skip-permissions', prompt];
    }

    try {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          CLAUDE_CODE_TASK_ID: this.currentTask?.id,
          CLAUDE_CODE_TIMEOUT: '1800000', // 30 minutes
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: false,
      });

      // Handle spawn errors immediately
      child.on('error', (error: any) => {
        if (error.code === 'ENOENT') {
          console.error('Claude Code CLI not found. Please ensure "claude" is installed and in PATH.');
        }
      });

      return child;
    } catch (error) {
      throw new ClaudineError(
        ErrorCode.CLAUDE_NOT_FOUND,
        'Failed to spawn Claude Code process. Is Claude CLI installed?'
      );
    }
  }

  private captureOutput(task: Task, data: string, stream: 'stdout' | 'stderr') {
    const size = Buffer.byteLength(data);
    
    if (this.currentOutputSize + size > this.MAX_OUTPUT_BUFFER) {
      // Truncate old output if needed
      const truncateMessage = '[Output truncated due to size limit]\n';
      if (stream === 'stdout') {
        task.output = [truncateMessage, ...task.output.slice(-100)];
      } else {
        task.errors = [truncateMessage, ...task.errors.slice(-100)];
      }
      this.currentOutputSize = this.calculateOutputSize(task);
    }
    
    if (stream === 'stdout') {
      task.output.push(data);
    } else {
      task.errors.push(data);
    }
    this.currentOutputSize += size;
  }

  private calculateOutputSize(task: Task): number {
    let size = 0;
    for (const line of task.output) {
      size += Buffer.byteLength(line);
    }
    for (const line of task.errors) {
      size += Buffer.byteLength(line);
    }
    return size;
  }

  private findTask(taskId: string): Task | null {
    if (this.currentTask?.id === taskId) {
      return this.currentTask;
    }
    return this.taskHistory.find(t => t.id === taskId) || null;
  }

  private addToHistory(task: Task) {
    // Clean up process reference
    delete task.process;
    
    // Clean up worktree if it was created
    if (task.worktreePath) {
      this.cleanupWorktree(task.worktreePath);
    }
    
    this.taskHistory.push(task);
    if (this.taskHistory.length > this.MAX_HISTORY) {
      const oldTask = this.taskHistory.shift();
      // Clean up old task's worktree if it exists
      if (oldTask?.worktreePath) {
        this.cleanupWorktree(oldTask.worktreePath);
      }
    }
    
    if (this.currentTask?.id === task.id) {
      this.currentTask = null;
      this.currentOutputSize = 0;
    }
  }

  private errorResponse(error: any) {
    const isClaudineError = error instanceof ClaudineError;
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            errorCode: isClaudineError ? error.code : ErrorCode.INTERNAL_ERROR,
            taskId: isClaudineError ? error.taskId : undefined,
          }),
        },
      ],
    };
  }

  private async createWorktree(taskId: string): Promise<string> {
    // Check if we're in a git repository
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    } catch {
      throw new Error('Not in a git repository. Cannot create worktree.');
    }

    // Create worktrees directory if it doesn't exist
    const worktreesDir = path.join(process.cwd(), '.claudine-worktrees');
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Create worktree for this task
    const worktreePath = path.join(worktreesDir, taskId);
    const currentBranch = execSync('git branch --show-current').toString().trim() || 'HEAD';
    
    try {
      execSync(`git worktree add "${worktreePath}" "${currentBranch}"`, { stdio: 'ignore' });
      return worktreePath;
    } catch (error) {
      throw new Error(`Failed to create git worktree: ${error}`);
    }
  }

  private cleanupWorktree(worktreePath: string) {
    if (worktreePath && fs.existsSync(worktreePath)) {
      try {
        // Remove the worktree
        execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'ignore' });
      } catch (error) {
        console.error('Failed to cleanup worktree:', error);
      }
    }
  }

  async connect(transport: any) {
    await this.server.connect(transport);
  }
}