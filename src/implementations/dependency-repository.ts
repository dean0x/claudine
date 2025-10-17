/**
 * SQLite-based dependency repository implementation
 * ARCHITECTURE: Pure Result pattern for all operations
 * Pattern: Repository pattern with prepared statements for performance
 * Rationale: Efficient dependency DAG management with cycle detection support
 */

import SQLite from 'better-sqlite3';
import { DependencyRepository, TaskDependency } from '../core/interfaces.js';
import { TaskId } from '../core/domain.js';
import { Result, ok, err, tryCatch, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import { Database } from './database.js';
import { DependencyGraph } from '../core/dependency-graph.js';

export class SQLiteDependencyRepository implements DependencyRepository {
  private readonly db: SQLite.Database;
  private readonly addDependencyStmt: SQLite.Statement;
  private readonly getDependenciesStmt: SQLite.Statement;
  private readonly getDependentsStmt: SQLite.Statement;
  private readonly resolveDependencyStmt: SQLite.Statement;
  private readonly getUnresolvedDependenciesStmt: SQLite.Statement;
  private readonly isBlockedStmt: SQLite.Statement;
  private readonly findAllStmt: SQLite.Statement;
  private readonly deleteDependenciesStmt: SQLite.Statement;
  private readonly checkDependencyExistsStmt: SQLite.Statement;
  private readonly getDependencyByIdStmt: SQLite.Statement;
  private readonly checkTaskExistsStmt: SQLite.Statement;

  // PERFORMANCE: Cache dependency graph to prevent N+1 query problem
  // Invalidated on addDependency to ensure correctness
  private cachedGraph: DependencyGraph | null = null;

  constructor(database: Database) {
    this.db = database.getDatabase();

    // Prepare statements for better performance
    this.addDependencyStmt = this.db.prepare(`
      INSERT INTO task_dependencies (
        task_id, depends_on_task_id, created_at, resolution
      ) VALUES (?, ?, ?, 'pending')
    `);

    this.getDependenciesStmt = this.db.prepare(`
      SELECT * FROM task_dependencies WHERE task_id = ?
    `);

    this.getDependentsStmt = this.db.prepare(`
      SELECT * FROM task_dependencies WHERE depends_on_task_id = ?
    `);

    this.resolveDependencyStmt = this.db.prepare(`
      UPDATE task_dependencies
      SET resolution = ?, resolved_at = ?
      WHERE task_id = ? AND depends_on_task_id = ?
    `);

    this.getUnresolvedDependenciesStmt = this.db.prepare(`
      SELECT * FROM task_dependencies
      WHERE task_id = ? AND resolution = 'pending'
    `);

    this.isBlockedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM task_dependencies
      WHERE task_id = ? AND resolution = 'pending'
    `);

    this.findAllStmt = this.db.prepare(`
      SELECT * FROM task_dependencies ORDER BY created_at DESC
    `);

    this.deleteDependenciesStmt = this.db.prepare(`
      DELETE FROM task_dependencies
      WHERE task_id = ? OR depends_on_task_id = ?
    `);

    this.checkDependencyExistsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM task_dependencies
      WHERE task_id = ? AND depends_on_task_id = ?
    `);

    this.getDependencyByIdStmt = this.db.prepare(`
      SELECT * FROM task_dependencies WHERE id = ?
    `);

    this.checkTaskExistsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM tasks WHERE id = ?
    `);
  }

  async addDependency(taskId: TaskId, dependsOnTaskId: TaskId): Promise<Result<TaskDependency>> {
    // SECURITY: TOCTOU Fix - Use synchronous .transaction() for true atomicity
    // Per Wikipedia TOCTOU principles: check and use must be atomic
    // better-sqlite3's .transaction() ensures no JavaScript event loop interleaving
    // Rationale: Async functions with BEGIN/COMMIT allow race conditions
    const addDependencyTransaction = this.db.transaction((taskId: TaskId, dependsOnTaskId: TaskId) => {
      // ALL operations below are synchronous - no await, no yielding to event loop
      // This guarantees atomicity: no other transaction can interleave

      // VALIDATION: Check both tasks exist (foreign key validation)
      const taskExistsResult = this.checkTaskExistsStmt.get(taskId) as { count: number };
      if (taskExistsResult.count === 0) {
        throw new ClaudineError(
          ErrorCode.TASK_NOT_FOUND,
          `Task not found: ${taskId}`
        );
      }

      const dependsOnTaskExistsResult = this.checkTaskExistsStmt.get(dependsOnTaskId) as { count: number };
      if (dependsOnTaskExistsResult.count === 0) {
        throw new ClaudineError(
          ErrorCode.TASK_NOT_FOUND,
          `Task not found: ${dependsOnTaskId}`
        );
      }

      // Check if dependency already exists
      const existsResult = this.checkDependencyExistsStmt.get(taskId, dependsOnTaskId) as { count: number };
      if (existsResult.count > 0) {
        throw new ClaudineError(
          ErrorCode.INVALID_OPERATION,
          `Dependency already exists: ${taskId} depends on ${dependsOnTaskId}`
        );
      }

      // Perform cycle detection using cached or newly built graph
      // PERFORMANCE: Reuse cached graph if available, avoiding N+1 query problem
      let graph: DependencyGraph;
      if (this.cachedGraph) {
        graph = this.cachedGraph;
      } else {
        // Build graph from all dependencies (synchronous)
        const allDepsRows = this.findAllStmt.all() as Record<string, any>[];
        const allDeps = allDepsRows.map(row => this.rowToDependency(row));
        graph = new DependencyGraph(allDeps);
        this.cachedGraph = graph;
      }

      // Check for cycles (synchronous DFS algorithm)
      const cycleCheck = graph.wouldCreateCycle(taskId, dependsOnTaskId);

      if (!cycleCheck.ok) {
        throw cycleCheck.error;
      }

      if (cycleCheck.value) {
        throw new ClaudineError(
          ErrorCode.INVALID_OPERATION,
          `Cannot add dependency: would create cycle (${taskId} -> ${dependsOnTaskId})`
        );
      }

      // Insert dependency (synchronous)
      const createdAt = Date.now();
      const result = this.addDependencyStmt.run(taskId, dependsOnTaskId, createdAt);

      // Fetch the created dependency (synchronous)
      const row = this.getDependencyByIdStmt.get(result.lastInsertRowid) as Record<string, any>;

      // PERFORMANCE: Invalidate cache after successful insertion
      // This ensures next cycle detection builds fresh graph with new dependency
      this.cachedGraph = null;

      return this.rowToDependency(row);
    });

    // Execute the transaction and wrap result
    return tryCatch(
      () => addDependencyTransaction(taskId, dependsOnTaskId),
      (error) => {
        // Handle UNIQUE constraint violation
        if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
          return new ClaudineError(
            ErrorCode.INVALID_OPERATION,
            `Dependency already exists: ${taskId} depends on ${dependsOnTaskId}`,
            { taskId, dependsOnTaskId }
          );
        }

        return new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to add dependency: ${error}`,
          { taskId, dependsOnTaskId }
        );
      }
    );
  }

  async getDependencies(taskId: TaskId): Promise<Result<readonly TaskDependency[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.getDependenciesStmt.all(taskId) as Record<string, any>[];
        return rows.map(row => this.rowToDependency(row));
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to get dependencies: ${error}`,
        { taskId }
      )
    );
  }

  async getDependents(taskId: TaskId): Promise<Result<readonly TaskDependency[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.getDependentsStmt.all(taskId) as Record<string, any>[];
        return rows.map(row => this.rowToDependency(row));
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to get dependents: ${error}`,
        { taskId }
      )
    );
  }

  async resolveDependency(
    taskId: TaskId,
    dependsOnTaskId: TaskId,
    resolution: 'completed' | 'failed' | 'cancelled'
  ): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        const resolvedAt = Date.now();
        const result = this.resolveDependencyStmt.run(resolution, resolvedAt, taskId, dependsOnTaskId);

        if (result.changes === 0) {
          throw new ClaudineError(
            ErrorCode.TASK_NOT_FOUND,
            `Dependency not found: ${taskId} depends on ${dependsOnTaskId}`
          );
        }
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to resolve dependency: ${error}`,
        { taskId, dependsOnTaskId, resolution }
      )
    );
  }

  async getUnresolvedDependencies(taskId: TaskId): Promise<Result<readonly TaskDependency[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.getUnresolvedDependenciesStmt.all(taskId) as Record<string, any>[];
        return rows.map(row => this.rowToDependency(row));
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to get unresolved dependencies: ${error}`,
        { taskId }
      )
    );
  }

  async isBlocked(taskId: TaskId): Promise<Result<boolean>> {
    return tryCatchAsync(
      async () => {
        const result = this.isBlockedStmt.get(taskId) as { count: number };
        return result.count > 0;
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to check if task is blocked: ${error}`,
        { taskId }
      )
    );
  }

  async findAll(): Promise<Result<readonly TaskDependency[]>> {
    return tryCatchAsync(
      async () => {
        const rows = this.findAllStmt.all() as Record<string, any>[];
        return rows.map(row => this.rowToDependency(row));
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to find all dependencies: ${error}`
      )
    );
  }

  async deleteDependencies(taskId: TaskId): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        this.deleteDependenciesStmt.run(taskId, taskId);
        // Invalidate cache after deletion
        this.cachedGraph = null;
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to delete dependencies: ${error}`,
        { taskId }
      )
    );
  }

  private rowToDependency(row: any): TaskDependency {
    return {
      id: row.id,
      taskId: row.task_id as TaskId,
      dependsOnTaskId: row.depends_on_task_id as TaskId,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || null,
      resolution: row.resolution as 'pending' | 'completed' | 'failed' | 'cancelled'
    };
  }
}
