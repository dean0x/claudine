/**
 * SQLite-based task repository implementation
 * Handles persistence of tasks to database
 */

import SQLite from 'better-sqlite3';
import { z } from 'zod';
import { TaskRepository } from '../core/interfaces.js';
import { Task, TaskId, TaskStatus, Priority, WorkerId } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode, operationErrorHandler } from '../core/errors.js';
import { Database } from './database.js';

/**
 * Zod schema for validating database rows
 * Pattern: Parse, don't validate - ensures type safety at system boundary
 */
const TaskRowSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  priority: z.enum(['P0', 'P1', 'P2']),
  working_directory: z.string().nullable(),
  use_worktree: z.number(),
  worktree_cleanup: z.string().nullable(),
  merge_strategy: z.string().nullable(),
  branch_name: z.string().nullable(),
  base_branch: z.string().nullable(),
  auto_commit: z.number().nullable(),
  push_to_remote: z.number().nullable(),
  pr_title: z.string().nullable(),
  pr_body: z.string().nullable(),
  timeout: z.number().nullable(),
  max_output_buffer: z.number().nullable(),
  parent_task_id: z.string().nullable(),
  retry_count: z.number().nullable(),
  retry_of: z.string().nullable(),
  created_at: z.number(),
  started_at: z.number().nullable(),
  completed_at: z.number().nullable(),
  worker_id: z.string().nullable(),
  exit_code: z.number().nullable(),
  dependencies: z.string().nullable(),
});

/**
 * Database row type for tasks table
 * TYPE-SAFETY: Explicit typing instead of Record<string, any>
 */
interface TaskRow {
  readonly id: string;
  readonly prompt: string;
  readonly status: string;
  readonly priority: string;
  readonly working_directory: string | null;
  readonly use_worktree: number;
  readonly worktree_cleanup: string | null;
  readonly merge_strategy: string | null;
  readonly branch_name: string | null;
  readonly base_branch: string | null;
  readonly auto_commit: number | null;
  readonly push_to_remote: number | null;
  readonly pr_title: string | null;
  readonly pr_body: string | null;
  readonly timeout: number | null;
  readonly max_output_buffer: number | null;
  readonly parent_task_id: string | null;
  readonly retry_count: number | null;
  readonly retry_of: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly completed_at: number | null;
  readonly worker_id: string | null;
  readonly exit_code: number | null;
  readonly dependencies: string | null;
}

export class SQLiteTaskRepository implements TaskRepository {
  private readonly db: SQLite.Database;
  private readonly saveStmt: SQLite.Statement;
  private readonly findByIdStmt: SQLite.Statement;
  private readonly findAllStmt: SQLite.Statement;
  private readonly findByStatusStmt: SQLite.Statement;
  private readonly deleteStmt: SQLite.Statement;
  private readonly cleanupOldTasksStmt: SQLite.Statement;

  constructor(database: Database) {
    this.db = database.getDatabase();
    
    // Prepare statements for better performance
    this.saveStmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, prompt, status, priority, working_directory, use_worktree,
        worktree_cleanup, merge_strategy, branch_name, base_branch,
        auto_commit, push_to_remote, pr_title, pr_body,
        timeout, max_output_buffer,
        created_at, started_at, completed_at, worker_id, exit_code, dependencies,
        parent_task_id, retry_count, retry_of
      ) VALUES (
        @id, @prompt, @status, @priority, @workingDirectory, @useWorktree,
        @worktreeCleanup, @mergeStrategy, @branchName, @baseBranch,
        @autoCommit, @pushToRemote, @prTitle, @prBody,
        @timeout, @maxOutputBuffer,
        @createdAt, @startedAt, @completedAt, @workerId, @exitCode, @dependencies,
        @parentTaskId, @retryCount, @retryOf
      )
    `);

    this.findByIdStmt = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `);

    this.findAllStmt = this.db.prepare(`
      SELECT * FROM tasks ORDER BY created_at DESC
    `);

    this.findByStatusStmt = this.db.prepare(`
      SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM tasks WHERE id = ?
    `);

    this.cleanupOldTasksStmt = this.db.prepare(`
      DELETE FROM tasks 
      WHERE status IN ('completed', 'failed', 'cancelled') 
      AND completed_at < ?
    `);
  }

  async save(task: Task): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        // Convert task to database format
        const dbTask = {
          id: task.id,
          prompt: task.prompt,
          status: task.status,
          priority: task.priority,
          workingDirectory: task.workingDirectory || null,
          useWorktree: task.useWorktree ? 1 : 0,
          worktreeCleanup: task.worktreeCleanup || 'auto',
          mergeStrategy: task.mergeStrategy || 'pr',
          branchName: task.branchName || null,
          baseBranch: task.baseBranch || null,
          autoCommit: task.autoCommit ? 1 : 0,
          pushToRemote: task.pushToRemote ? 1 : 0,
          prTitle: task.prTitle || null,
          prBody: task.prBody || null,
          timeout: task.timeout || null,
          maxOutputBuffer: task.maxOutputBuffer || null,
          createdAt: task.createdAt,
          startedAt: task.startedAt || null,
          completedAt: task.completedAt || null,
          workerId: task.workerId || null,
          exitCode: task.exitCode ?? null,
          dependencies: null, // Dependencies stored in task_dependencies table
          parentTaskId: task.parentTaskId || null,
          retryCount: task.retryCount || null,
          retryOf: task.retryOf || null
        };

        this.saveStmt.run(dbTask);
      },
      operationErrorHandler('save task', { taskId: task.id })
    );
  }

  async update(taskId: TaskId, update: Partial<Task>): Promise<Result<void>> {
    // First get the existing task
    const existingResult = await this.findById(taskId);
    
    if (!existingResult.ok) {
      return existingResult;
    }

    if (!existingResult.value) {
      return err(new ClaudineError(
        ErrorCode.TASK_NOT_FOUND,
        `Task ${taskId} not found`
      ));
    }

    // Merge updates with existing task
    const updatedTask = { ...existingResult.value, ...update };
    
    // Save the updated task
    return this.save(updatedTask);
  }

  async findById(taskId: TaskId): Promise<Result<Task | null>> {
    return tryCatchAsync(
      async () => {
        const row = this.findByIdStmt.get(taskId) as TaskRow | undefined;
        
        if (!row) {
          return null;
        }

        return this.rowToTask(row);
      },
      operationErrorHandler('find task', { taskId })
    );
  }

  async findAll(): Promise<Result<readonly Task[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.findAllStmt.all() as TaskRow[];
        return rows.map(row => this.rowToTask(row));
      },
      operationErrorHandler('find all tasks')
    );
  }

  async findByStatus(status: string): Promise<Result<readonly Task[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.findByStatusStmt.all(status) as TaskRow[];
        return rows.map(row => this.rowToTask(row));
      },
      operationErrorHandler('find tasks by status', { status })
    );
  }

  async delete(taskId: TaskId): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        this.deleteStmt.run(taskId);
      },
      operationErrorHandler('delete task', { taskId })
    );
  }

  async cleanupOldTasks(olderThanMs: number): Promise<Result<number>> {
    return tryCatchAsync(
      async () => {
        const cutoffTime = Date.now() - olderThanMs;
        const result = this.cleanupOldTasksStmt.run(cutoffTime);
        return result.changes || 0;
      },
      operationErrorHandler('cleanup old tasks')
    );
  }

  async transaction<T>(fn: (repo: TaskRepository) => Promise<Result<T>>): Promise<Result<T>> {
    try {
      const transactionFn = this.db.transaction(async () => {
        // Create a transaction-wrapped repository
        const txRepo = new TransactionTaskRepository(this);
        return await fn(txRepo);
      });
      
      // Execute the transaction and return the result
      return await transactionFn();
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Transaction failed: ${error}`
      ));
    }
  }

  /**
   * Convert database row to Task domain object
   * Pattern: Validate at boundary - ensures data integrity from database
   * @throws Error if row data is invalid (indicates database corruption)
   */
  private rowToTask(row: TaskRow): Task {
    // Validate row data at system boundary
    // This catches database corruption or schema mismatches early
    const validated = TaskRowSchema.safeParse(row);
    if (!validated.success) {
      // This should never happen with proper migrations, but provides defense-in-depth
      throw new Error(
        `Invalid task row data for id=${row.id}: ${validated.error.message}`
      );
    }

    const data = validated.data;
    return {
      id: data.id as TaskId,
      prompt: data.prompt,
      status: data.status as TaskStatus,
      priority: data.priority as Priority,
      workingDirectory: data.working_directory || undefined,
      useWorktree: data.use_worktree === 1,
      worktreeCleanup: (data.worktree_cleanup || 'auto') as 'auto' | 'keep' | 'delete',
      mergeStrategy: (data.merge_strategy || 'pr') as 'auto' | 'pr' | 'manual' | 'patch',
      branchName: data.branch_name || undefined,
      baseBranch: data.base_branch || undefined,
      autoCommit: data.auto_commit === null || data.auto_commit === 1,
      pushToRemote: data.push_to_remote === null || data.push_to_remote === 1,
      prTitle: data.pr_title || undefined,
      prBody: data.pr_body || undefined,
      timeout: data.timeout || undefined,
      maxOutputBuffer: data.max_output_buffer || undefined,
      parentTaskId: data.parent_task_id ? data.parent_task_id as TaskId : undefined,
      retryCount: data.retry_count || undefined,
      retryOf: data.retry_of ? data.retry_of as TaskId : undefined,
      createdAt: data.created_at,
      startedAt: data.started_at || undefined,
      completedAt: data.completed_at || undefined,
      workerId: data.worker_id ? data.worker_id as WorkerId : undefined,
      exitCode: data.exit_code ?? undefined
    };
  }
}

/**
 * Transaction-wrapped repository that delegates to the main repository
 * All operations run within the same SQLite transaction
 */
class TransactionTaskRepository implements TaskRepository {
  constructor(private readonly mainRepo: SQLiteTaskRepository) {}

  async save(task: Task): Promise<Result<void>> {
    return this.mainRepo.save(task);
  }

  async update(taskId: TaskId, update: Partial<Task>): Promise<Result<void>> {
    return this.mainRepo.update(taskId, update);
  }

  async findById(taskId: TaskId): Promise<Result<Task | null>> {
    return this.mainRepo.findById(taskId);
  }

  async findAll(): Promise<Result<readonly Task[]>> {
    return this.mainRepo.findAll();
  }

  async findByStatus(status: string): Promise<Result<readonly Task[]>> {
    return this.mainRepo.findByStatus(status);
  }

  async delete(taskId: TaskId): Promise<Result<void>> {
    return this.mainRepo.delete(taskId);
  }

  async cleanupOldTasks(olderThanMs: number): Promise<Result<number>> {
    return this.mainRepo.cleanupOldTasks(olderThanMs);
  }

  async transaction<T>(fn: (repo: TaskRepository) => Promise<Result<T>>): Promise<Result<T>> {
    // Nested transactions not supported - just execute the function
    return fn(this);
  }
}