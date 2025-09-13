/**
 * SQLite-based task repository implementation
 * Handles persistence of tasks to database
 */

import SQLite from 'better-sqlite3';
import { TaskRepository } from '../core/interfaces.js';
import { Task, TaskId, TaskStatus, Priority, WorkerId } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
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
        created_at, started_at, completed_at, worker_id, exit_code, dependencies
      ) VALUES (
        @id, @prompt, @status, @priority, @workingDirectory, @useWorktree,
        @createdAt, @startedAt, @completedAt, @workerId, @exitCode, @dependencies
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
          cleanupWorktree: task.worktreeCleanup === 'delete' ? 1 : 0, // Legacy mapping
          createdAt: task.createdAt,
          startedAt: task.startedAt || null,
          completedAt: task.completedAt || null,
          workerId: task.workerId || null,
          exitCode: task.exitCode ?? null,
          dependencies: null // Phase 4: Task dependencies not yet implemented
        };

        this.saveStmt.run(dbTask);
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to save task: ${error}`,
        { taskId: task.id }
      )
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
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to find task: ${error}`,
        { taskId }
      )
    );
  }

  async findAll(): Promise<Result<readonly Task[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.findAllStmt.all() as Record<string, any>[];
        return rows.map(row => this.rowToTask(row));
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to find all tasks: ${error}`
      )
    );
  }

  async findByStatus(status: string): Promise<Result<readonly Task[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.findByStatusStmt.all(status) as Record<string, any>[];
        return rows.map(row => this.rowToTask(row));
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to find tasks by status: ${error}`,
        { status }
      )
    );
  }

  async delete(taskId: TaskId): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        this.deleteStmt.run(taskId);
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to delete task: ${error}`,
        { taskId }
      )
    );
  }

  async cleanupOldTasks(olderThanMs: number): Promise<Result<number>> {
    return tryCatchAsync(
      async () => {
        const cutoffTime = Date.now() - olderThanMs;
        const result = this.cleanupOldTasksStmt.run(cutoffTime);
        return result.changes || 0;
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to cleanup old tasks: ${error}`
      )
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
      worktreeCleanup: row.cleanup_worktree ? 'delete' : 'auto', // Legacy mapping
      mergeStrategy: 'pr' as const, // Default for legacy tasks
      autoCommit: true,
      pushToRemote: true,
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