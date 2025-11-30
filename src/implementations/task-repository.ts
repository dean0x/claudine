/**
 * SQLite-based task repository implementation
 * Handles persistence of tasks to database
 */

import SQLite from 'better-sqlite3';
import { TaskRepository } from '../core/interfaces.js';
import { Task, TaskId, TaskStatus, Priority, WorkerId } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode, operationErrorHandler } from '../core/errors.js';
import { Database } from './database.js';

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
        const row = this.findByIdStmt.get(taskId) as Record<string, any> | undefined;
        
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
        const rows = this.findAllStmt.all() as Record<string, any>[];
        return rows.map(row => this.rowToTask(row));
      },
      operationErrorHandler('find all tasks')
    );
  }

  async findByStatus(status: string): Promise<Result<readonly Task[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.findByStatusStmt.all(status) as Record<string, any>[];
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

  private rowToTask(row: any): Task {
    return {
      id: row.id as TaskId,
      prompt: row.prompt,
      status: row.status as TaskStatus,
      priority: row.priority as Priority,
      workingDirectory: row.working_directory || undefined,
      useWorktree: row.use_worktree === 1,
      worktreeCleanup: row.worktree_cleanup || 'auto',
      mergeStrategy: row.merge_strategy || 'pr',
      branchName: row.branch_name || undefined,
      baseBranch: row.base_branch || undefined,
      autoCommit: row.auto_commit === null || row.auto_commit === 1,
      pushToRemote: row.push_to_remote === null || row.push_to_remote === 1,
      prTitle: row.pr_title || undefined,
      prBody: row.pr_body || undefined,
      timeout: row.timeout || undefined,
      maxOutputBuffer: row.max_output_buffer || undefined,
      parentTaskId: row.parent_task_id ? row.parent_task_id as TaskId : undefined,
      retryCount: row.retry_count || undefined,
      retryOf: row.retry_of ? row.retry_of as TaskId : undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      workerId: row.worker_id ? row.worker_id as WorkerId : undefined,
      exitCode: row.exit_code ?? undefined
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