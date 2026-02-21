/**
 * SQLite-based checkpoint repository implementation
 * ARCHITECTURE: Pure Result pattern for all operations, pure data access layer
 * Pattern: Repository pattern with prepared statements for performance
 * Rationale: Stores task state snapshots for "smart retry" enrichment
 */

import SQLite from 'better-sqlite3';
import { z } from 'zod';
import { CheckpointRepository } from '../core/interfaces.js';
import { TaskCheckpoint, TaskId } from '../core/domain.js';
import { Result, ok, tryCatchAsync } from '../core/result.js';
import { operationErrorHandler } from '../core/errors.js';
import { Database } from './database.js';

/**
 * Zod schema for validating checkpoint rows from database
 * Pattern: Parse, don't validate - ensures type safety at system boundary
 */
const CheckpointRowSchema = z.object({
  id: z.number(),
  task_id: z.string().min(1),
  checkpoint_type: z.enum(['completed', 'failed', 'cancelled']),
  output_summary: z.string().nullable(),
  error_summary: z.string().nullable(),
  git_branch: z.string().nullable(),
  git_commit_sha: z.string().nullable(),
  git_dirty_files: z.string().nullable(), // JSON array string
  context_note: z.string().nullable(),
  created_at: z.number(),
});

/**
 * Database row type for task_checkpoints table
 * TYPE-SAFETY: Explicit typing instead of Record<string, any>
 */
interface CheckpointRow {
  readonly id: number;
  readonly task_id: string;
  readonly checkpoint_type: string;
  readonly output_summary: string | null;
  readonly error_summary: string | null;
  readonly git_branch: string | null;
  readonly git_commit_sha: string | null;
  readonly git_dirty_files: string | null;
  readonly context_note: string | null;
  readonly created_at: number;
}

export class SQLiteCheckpointRepository implements CheckpointRepository {
  /** Default pagination limit for findAll() */
  private static readonly DEFAULT_LIMIT = 100;

  private readonly db: SQLite.Database;
  private readonly saveStmt: SQLite.Statement;
  private readonly getByIdStmt: SQLite.Statement;
  private readonly findLatestStmt: SQLite.Statement;
  private readonly findAllStmt: SQLite.Statement;
  private readonly deleteByTaskStmt: SQLite.Statement;

  constructor(database: Database) {
    this.db = database.getDatabase();

    this.saveStmt = this.db.prepare(`
      INSERT INTO task_checkpoints (
        task_id, checkpoint_type, output_summary, error_summary,
        git_branch, git_commit_sha, git_dirty_files, context_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getByIdStmt = this.db.prepare(`
      SELECT * FROM task_checkpoints WHERE id = ?
    `);

    this.findLatestStmt = this.db.prepare(`
      SELECT * FROM task_checkpoints
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    this.findAllStmt = this.db.prepare(`
      SELECT * FROM task_checkpoints
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    this.deleteByTaskStmt = this.db.prepare(`
      DELETE FROM task_checkpoints WHERE task_id = ?
    `);
  }

  /**
   * Save a new checkpoint
   *
   * @param checkpoint - Checkpoint data without ID (auto-generated)
   * @returns Result containing the created checkpoint with ID
   */
  async save(checkpoint: Omit<TaskCheckpoint, 'id'>): Promise<Result<TaskCheckpoint>> {
    return tryCatchAsync(
      async () => {
        const result = this.saveStmt.run(
          checkpoint.taskId,
          checkpoint.checkpointType,
          checkpoint.outputSummary ?? null,
          checkpoint.errorSummary ?? null,
          checkpoint.gitBranch ?? null,
          checkpoint.gitCommitSha ?? null,
          checkpoint.gitDirtyFiles ? JSON.stringify(checkpoint.gitDirtyFiles) : null,
          checkpoint.contextNote ?? null,
          checkpoint.createdAt,
        );

        const row = this.getByIdStmt.get(result.lastInsertRowid) as CheckpointRow;
        return this.rowToCheckpoint(row);
      },
      operationErrorHandler('save checkpoint', { taskId: checkpoint.taskId }),
    );
  }

  /**
   * Find the latest checkpoint for a task
   *
   * @param taskId - The task ID to find the latest checkpoint for
   * @returns Result containing the latest checkpoint or null if none exists
   */
  async findLatest(taskId: TaskId): Promise<Result<TaskCheckpoint | null>> {
    return tryCatchAsync(
      async () => {
        const row = this.findLatestStmt.get(taskId) as CheckpointRow | undefined;

        if (!row) {
          return null;
        }

        return this.rowToCheckpoint(row);
      },
      operationErrorHandler('find latest checkpoint', { taskId }),
    );
  }

  /**
   * Find all checkpoints for a task with optional limit
   *
   * @param taskId - The task ID to find checkpoints for
   * @param limit - Maximum results to return (default: 100)
   * @returns Result containing array of checkpoints ordered by created_at DESC
   */
  async findAll(taskId: TaskId, limit?: number): Promise<Result<readonly TaskCheckpoint[]>> {
    return tryCatchAsync(
      async () => {
        const effectiveLimit = limit ?? SQLiteCheckpointRepository.DEFAULT_LIMIT;
        const rows = this.findAllStmt.all(taskId, effectiveLimit) as CheckpointRow[];
        return rows.map((row) => this.rowToCheckpoint(row));
      },
      operationErrorHandler('find all checkpoints', { taskId }),
    );
  }

  /**
   * Delete all checkpoints for a task
   *
   * @param taskId - The task ID to delete checkpoints for
   * @returns Result indicating success or error
   */
  async deleteByTask(taskId: TaskId): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        this.deleteByTaskStmt.run(taskId);
      },
      operationErrorHandler('delete checkpoints by task', { taskId }),
    );
  }

  /**
   * Convert database row to TaskCheckpoint domain object
   * Pattern: Validate at boundary - ensures data integrity from database
   */
  private rowToCheckpoint(row: CheckpointRow): TaskCheckpoint {
    const data = CheckpointRowSchema.parse(row);

    // Parse git_dirty_files JSON at system boundary
    let gitDirtyFiles: readonly string[] | undefined;
    if (data.git_dirty_files) {
      try {
        const parsed = JSON.parse(data.git_dirty_files);
        if (Array.isArray(parsed)) {
          gitDirtyFiles = parsed as string[];
        }
      } catch {
        // Invalid JSON - treat as no dirty files (data corruption)
        gitDirtyFiles = undefined;
      }
    }

    return {
      id: data.id,
      taskId: TaskId(data.task_id),
      checkpointType: data.checkpoint_type,
      outputSummary: data.output_summary ?? undefined,
      errorSummary: data.error_summary ?? undefined,
      gitBranch: data.git_branch ?? undefined,
      gitCommitSha: data.git_commit_sha ?? undefined,
      gitDirtyFiles,
      contextNote: data.context_note ?? undefined,
      createdAt: data.created_at,
    };
  }
}
