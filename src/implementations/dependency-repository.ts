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

  /**
   * Add a dependency relationship between two tasks with cycle detection
   *
   * Uses synchronous better-sqlite3 transaction to prevent TOCTOU race conditions.
   * Performs cycle detection using DFS algorithm before persisting.
   *
   * @param taskId - The task that depends on another task
   * @param dependsOnTaskId - The task to depend on
   * @returns Result containing created TaskDependency or error if:
   *   - Cycle would be created (ErrorCode.INVALID_OPERATION)
   *   - Dependency already exists (ErrorCode.INVALID_OPERATION)
   *   - Either task doesn't exist (ErrorCode.TASK_NOT_FOUND)
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.addDependency(taskB.id, taskA.id);
   * if (!result.ok) {
   *   console.error('Failed to add dependency:', result.error.message);
   * }
   * ```
   */
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

  /**
   * Get all dependencies for a task (tasks that this task depends on)
   *
   * Returns only direct dependencies, not transitive closure.
   * Use DependencyGraph.getAllDependencies() for transitive dependencies.
   *
   * @param taskId - The task to get dependencies for
   * @returns Result containing array of TaskDependency objects or error
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.getDependencies(taskA.id);
   * if (result.ok) {
   *   console.log(`Task A depends on ${result.value.length} tasks`);
   * }
   * ```
   */
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

  /**
   * Get all dependents for a task (tasks that depend on this task)
   *
   * Returns only direct dependents, not transitive closure.
   * Use DependencyGraph.getAllDependents() for transitive dependents.
   *
   * @param taskId - The task to get dependents for
   * @returns Result containing array of TaskDependency objects or error
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.getDependents(taskA.id);
   * if (result.ok) {
   *   console.log(`${result.value.length} tasks depend on Task A`);
   * }
   * ```
   */
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

  /**
   * Mark a dependency as resolved with the given resolution state
   *
   * Called when a dependency completes, fails, or is cancelled.
   * Updates the resolution and resolved_at timestamp.
   *
   * @param taskId - The task that has the dependency
   * @param dependsOnTaskId - The dependency task that was resolved
   * @param resolution - The resolution state: 'completed', 'failed', or 'cancelled'
   * @returns Result indicating success or error if dependency not found
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.resolveDependency(
   *   taskB.id,
   *   taskA.id,
   *   'completed'
   * );
   * if (result.ok) {
   *   console.log('Dependency marked as completed');
   * }
   * ```
   */
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

  /**
   * Get all unresolved (pending) dependencies for a task
   *
   * Returns only dependencies with resolution='pending'.
   * Used to check if a task is still blocked waiting for dependencies.
   *
   * @param taskId - The task to get unresolved dependencies for
   * @returns Result containing array of pending TaskDependency objects or error
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.getUnresolvedDependencies(taskB.id);
   * if (result.ok && result.value.length === 0) {
   *   console.log('Task B has no pending dependencies - ready to run');
   * }
   * ```
   */
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

  /**
   * Check if a task is blocked by unresolved dependencies
   *
   * Returns true if the task has any dependencies with resolution='pending'.
   * Used by QueueHandler to determine if task can be enqueued.
   *
   * @param taskId - The task to check for blocking dependencies
   * @returns Result containing true if task is blocked, false if ready to run
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.isBlocked(taskB.id);
   * if (result.ok && !result.value) {
   *   // Task is not blocked - can be enqueued
   *   await queue.enqueue(taskB);
   * }
   * ```
   */
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

  /**
   * Get all dependencies in the system
   *
   * Returns all TaskDependency records ordered by created_at DESC.
   * Used for building complete dependency graph and admin queries.
   *
   * Note: This is a full table scan - use sparingly in production.
   * Consider caching the result for graph construction.
   *
   * @returns Result containing array of all TaskDependency objects or error
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.findAll();
   * if (result.ok) {
   *   const graph = new DependencyGraph(result.value);
   *   console.log(`System has ${result.value.length} total dependencies`);
   * }
   * ```
   */
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

  /**
   * Delete all dependencies related to a task
   *
   * Removes all dependency records where the task is either:
   * - The dependent task (task_id = taskId), or
   * - The dependency target (depends_on_task_id = taskId)
   *
   * Called when a task is cancelled or deleted to clean up orphaned dependencies.
   * Invalidates dependency graph cache after deletion.
   *
   * @param taskId - The task to delete all dependencies for
   * @returns Result indicating success or error
   *
   * @example
   * ```typescript
   * const result = await dependencyRepo.deleteDependencies(taskA.id);
   * if (result.ok) {
   *   console.log('All dependencies for Task A removed');
   * }
   * ```
   */
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
