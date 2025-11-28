/**
 * Dependency handler for task dependency management
 * ARCHITECTURE: Event-driven DAG validation and dependency resolution
 * Pattern: Pure event-driven with cycle detection before mutation
 * Rationale: Ensures dependency integrity, prevents deadlocks, enables parallel task execution
 */

import { DependencyRepository, Logger, TaskRepository } from '../../core/interfaces.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import { TaskId } from '../../core/domain.js';
import {
  TaskDelegatedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskCancelledEvent,
  TaskTimeoutEvent,
  TaskDeletedEvent
} from '../../core/events/events.js';
import { DependencyGraph } from '../../core/dependency-graph.js';
import { ClaudineError, ErrorCode } from '../../core/errors.js';

// SECURITY: Maximum allowed depth for dependency chains (DoS prevention)
const MAX_DEPENDENCY_CHAIN_DEPTH = 100;

export class DependencyHandler extends BaseEventHandler {
  private eventBus: EventBus;
  private graph: DependencyGraph;

  /**
   * Private constructor - use DependencyHandler.create() instead
   * ARCHITECTURE: Factory pattern ensures handler is fully initialized before use
   */
  private constructor(
    private readonly dependencyRepo: DependencyRepository,
    private readonly taskRepo: TaskRepository,
    logger: Logger,
    eventBus: EventBus,
    graph: DependencyGraph
  ) {
    super(logger, 'DependencyHandler');
    this.eventBus = eventBus;
    this.graph = graph;
  }

  /**
   * Factory method to create a fully initialized DependencyHandler
   * ARCHITECTURE: Guarantees handler is ready to use - no uninitialized state possible
   * PERFORMANCE: Graph initialized once from database (O(N) one-time cost)
   *
   * @param dependencyRepo - Repository for dependency persistence
   * @param taskRepo - Repository for task lookups (needed for TaskUnblocked events)
   * @param logger - Logger instance
   * @param eventBus - Event bus for subscriptions
   * @returns Result containing initialized handler or error
   */
  static async create(
    dependencyRepo: DependencyRepository,
    taskRepo: TaskRepository,
    logger: Logger,
    eventBus: EventBus
  ): Promise<Result<DependencyHandler>> {
    const handlerLogger = logger.child ? logger.child({ module: 'DependencyHandler' }) : logger;

    // PERFORMANCE: Initialize graph eagerly (one-time O(N) cost)
    // Subsequent operations use incremental O(1) updates instead of rebuilding
    handlerLogger.debug('Initializing dependency graph from database');
    const allDepsResult = await dependencyRepo.findAll();
    if (!allDepsResult.ok) {
      handlerLogger.error('Failed to initialize dependency graph', allDepsResult.error);
      return err(allDepsResult.error);
    }

    const graph = new DependencyGraph(allDepsResult.value);
    handlerLogger.info('Dependency graph initialized', {
      nodeCount: graph.size(),
      dependencyCount: allDepsResult.value.length
    });

    // Create handler with initialized graph
    const handler = new DependencyHandler(
      dependencyRepo,
      taskRepo,
      handlerLogger,
      eventBus,
      graph
    );

    // Subscribe to events
    const subscribeResult = handler.subscribeToEvents();
    if (!subscribeResult.ok) {
      return subscribeResult;
    }

    handlerLogger.info('DependencyHandler initialized with incremental graph updates', {
      pattern: 'event-driven incremental updates',
      maxDepth: MAX_DEPENDENCY_CHAIN_DEPTH
    });

    return ok(handler);
  }

  /**
   * Subscribe to all relevant events
   * ARCHITECTURE: Called by factory after graph initialization
   */
  private subscribeToEvents(): Result<void> {
    const subscriptions = [
      // Listen for new tasks to add dependencies
      this.eventBus.subscribe('TaskDelegated', this.handleTaskDelegated.bind(this)),
      // Listen for task completions to resolve dependencies
      this.eventBus.subscribe('TaskCompleted', this.handleTaskCompleted.bind(this)),
      this.eventBus.subscribe('TaskFailed', this.handleTaskFailed.bind(this)),
      this.eventBus.subscribe('TaskCancelled', this.handleTaskCancelled.bind(this)),
      this.eventBus.subscribe('TaskTimeout', this.handleTaskTimeout.bind(this)),
      // Listen for task deletions to maintain graph consistency
      this.eventBus.subscribe('TaskDeleted', this.handleTaskDeleted.bind(this))
      // NOTE: No longer subscribe to TaskDependencyAdded - we update graph directly
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    return ok(undefined);
  }

  /**
   * Handle new task delegation - add dependencies atomically with cycle detection
   * ARCHITECTURE: DAG validation BEFORE persisting (handler owns validation logic)
   * ATOMICITY: All dependencies succeed or all fail together (no partial state)
   * PERFORMANCE: Cycle detection uses in-memory graph (O(V+E) not O(N) database query)
   */
  private async handleTaskDelegated(event: TaskDelegatedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const task = event.task;

      // Skip if no dependencies
      if (!task.dependsOn || task.dependsOn.length === 0) {
        this.logger.debug('Task has no dependencies, skipping', { taskId: task.id });
        return ok(undefined);
      }

      this.logger.info('Processing dependencies for new task', {
        taskId: task.id,
        dependencyCount: task.dependsOn.length,
        dependencies: task.dependsOn
      });

      // ARCHITECTURE: Handler performs cycle detection BEFORE repository call
      // This is business logic (DAG validation), not data access
      // PERFORMANCE: Validate all dependencies in parallel (Issue #14)
      // Each check is read-only (uses temp graph), so concurrent execution is safe
      const validationResults = await Promise.all(
        task.dependsOn.map(async (depId) => {
          // Cycle detection
          const cycleCheck = this.graph.wouldCreateCycle(task.id, depId);
          if (!cycleCheck.ok) {
            return { depId, error: cycleCheck.error, type: 'system' as const };
          }
          if (cycleCheck.value) {
            return {
              depId,
              error: new ClaudineError(
                ErrorCode.INVALID_OPERATION,
                `Cannot add dependency: would create cycle (${task.id} -> ${depId})`,
                { taskId: task.id, dependsOnTaskId: depId }
              ),
              type: 'cycle' as const
            };
          }

          // Depth check
          const depDepth = this.graph.getMaxDepth(depId);
          const resultingDepth = 1 + depDepth;
          if (resultingDepth > MAX_DEPENDENCY_CHAIN_DEPTH) {
            return {
              depId,
              error: new ClaudineError(
                ErrorCode.INVALID_OPERATION,
                `Cannot add dependency: would create chain depth of ${resultingDepth} (max ${MAX_DEPENDENCY_CHAIN_DEPTH})`,
                { taskId: task.id, dependsOnTaskId: depId, depth: resultingDepth }
              ),
              type: 'depth' as const
            };
          }

          return { depId, error: null, type: 'ok' as const };
        })
      );

      // Check for any validation failures
      const failure = validationResults.find(r => r.error !== null);
      if (failure && failure.error) {
        const context = { taskId: task.id, dependsOnTaskId: failure.depId };

        if (failure.type === 'system') {
          this.logger.error('Validation failed', failure.error, context);
        } else if (failure.type === 'cycle') {
          this.logger.warn('Cycle detected, rejecting dependency', context);
        } else {
          this.logger.warn('Depth limit exceeded, rejecting dependency', context);
        }

        // Emit batch failure event (indicates entire batch was rejected)
        await this.eventBus.emit('TaskDependencyFailed', {
          taskId: task.id,
          failedDependencyId: failure.depId,
          requestedDependencies: task.dependsOn,
          error: failure.error
        });

        return err(failure.error);
      }

      // All cycle and depth checks passed - persist to database
      // Repository is now pure data layer (no business logic)
      const addResult = await this.dependencyRepo.addDependencies(task.id, task.dependsOn);

      if (!addResult.ok) {
        this.logger.error('Failed to add dependencies', addResult.error, {
          taskId: task.id,
          dependencies: task.dependsOn
        });

        // Emit failure event for the batch
        await this.eventBus.emit('TaskDependencyFailed', {
          taskId: task.id,
          failedDependencyId: task.dependsOn[0], // First dependency for compatibility
          error: addResult.error
        });

        return addResult;
      }

      // All dependencies added successfully
      this.logger.info('All dependencies added atomically', {
        taskId: task.id,
        count: addResult.value.length,
        dependencyIds: addResult.value.map(d => d.id)
      });

      // CRITICAL: Update handler's graph AFTER successful database operation
      // This maintains graph-database synchronization via event-driven architecture
      //
      // ERROR RECOVERY: If addEdge() fails after DB write, graph-database desync occurs.
      // Recovery path: Handler re-initializes graph from database on next restart (setup() calls findAll()).
      // This is acceptable because addEdge() should never fail for valid data - database already
      // validated that task IDs exist and no cycles would be created.
      for (const dependency of addResult.value) {
        const edgeResult = this.graph.addEdge(dependency.taskId, dependency.dependsOnTaskId);
        if (!edgeResult.ok) {
          // This should never happen for valid data, but log if it does
          this.logger.error('Unexpected error updating graph after DB write', edgeResult.error, {
            taskId: dependency.taskId,
            dependsOnTaskId: dependency.dependsOnTaskId
          });
          // Continue - graph will be reconciled on restart
        }
        this.logger.debug('Graph updated with new dependency', {
          taskId: dependency.taskId,
          dependsOnTaskId: dependency.dependsOnTaskId
        });
      }

      // Emit success event for each dependency (for compatibility with existing listeners)
      for (const dependency of addResult.value) {
        await this.eventBus.emit('TaskDependencyAdded', {
          taskId: dependency.taskId,
          dependsOnTaskId: dependency.dependsOnTaskId
        });
      }

      return ok(undefined);
    });
  }

  /**
   * Handle task completion - resolve dependencies and unblock dependent tasks
   */
  private async handleTaskCompleted(event: TaskCompletedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      await this.resolveDependencies(event.taskId, 'completed');
      return ok(undefined);
    });
  }

  /**
   * Handle task failure - resolve dependencies as failed
   */
  private async handleTaskFailed(event: TaskFailedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      await this.resolveDependencies(event.taskId, 'failed');
      return ok(undefined);
    });
  }

  /**
   * Handle task cancellation - resolve dependencies as cancelled
   */
  private async handleTaskCancelled(event: TaskCancelledEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      await this.resolveDependencies(event.taskId, 'cancelled');
      return ok(undefined);
    });
  }

  /**
   * Handle task timeout - resolve dependencies as failed
   */
  private async handleTaskTimeout(event: TaskTimeoutEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      await this.resolveDependencies(event.taskId, 'failed');
      return ok(undefined);
    });
  }

  /**
   * Handle task deletion - remove task from in-memory graph to maintain consistency
   * ARCHITECTURE: Maintains graph-database synchronization when tasks are deleted
   */
  private async handleTaskDeleted(event: TaskDeletedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const removeResult = this.graph.removeTask(event.taskId);
      if (!removeResult.ok) {
        this.logger.error('Failed to remove task from graph', removeResult.error, {
          taskId: event.taskId
        });
        return removeResult;
      }
      this.logger.debug('Graph updated: task removed', { taskId: event.taskId });
      return ok(undefined);
    });
  }

  /**
   * Resolve dependencies and check if dependent tasks are now unblocked
   * PERFORMANCE: Uses batch resolution (single UPDATE) instead of N+1 queries
   * @param completedTaskId Task that just completed/failed/cancelled
   * @param resolution Resolution state
   */
  private async resolveDependencies(
    completedTaskId: TaskId,
    resolution: 'completed' | 'failed' | 'cancelled'
  ): Promise<Result<void>> {
    // PERFORMANCE: Get dependents BEFORE batch resolution to emit events and check unblocked state
    // This is necessary because we need the list of affected tasks for:
    // 1. Emitting TaskDependencyResolved events (one per dependency)
    // 2. Checking which tasks became unblocked (requires isBlocked check per task)
    const dependentsResult = await this.dependencyRepo.getDependents(completedTaskId);
    if (!dependentsResult.ok) {
      this.logger.error('Failed to get dependents', dependentsResult.error, {
        taskId: completedTaskId
      });
      return dependentsResult;
    }

    const dependents = dependentsResult.value;

    if (dependents.length === 0) {
      this.logger.debug('No dependent tasks to resolve', { taskId: completedTaskId });
      return ok(undefined);
    }

    this.logger.info('Resolving dependencies for completed task', {
      taskId: completedTaskId,
      resolution,
      dependentCount: dependents.length
    });

    // PERFORMANCE: Batch resolve ALL dependencies in single UPDATE query (7-10× faster)
    // Replaces N individual UPDATE queries with one query that updates all pending dependents
    const batchResolveResult = await this.dependencyRepo.resolveDependenciesBatch(
      completedTaskId,
      resolution
    );

    if (!batchResolveResult.ok) {
      this.logger.error('Failed to batch resolve dependencies', batchResolveResult.error, {
        taskId: completedTaskId,
        resolution
      });
      return batchResolveResult;
    }

    this.logger.info('Batch resolved dependencies', {
      taskId: completedTaskId,
      resolution,
      resolvedCount: batchResolveResult.value
    });

    // Emit resolution events and check for unblocked tasks
    // NOTE: We still iterate over dependents for event emission and unblock checks
    // This is unavoidable because each dependent may have different blocking state
    for (const dep of dependents) {
      // Only process dependencies that were pending before the batch update
      // The batch UPDATE only affects pending dependencies, so skip already-resolved ones
      if (dep.resolution !== 'pending') {
        continue;
      }

      this.logger.debug('Dependency resolved', {
        taskId: dep.taskId,
        dependsOnTaskId: dep.dependsOnTaskId,
        resolution
      });

      // Emit resolution event
      await this.eventBus.emit('TaskDependencyResolved', {
        taskId: dep.taskId,
        dependsOnTaskId: dep.dependsOnTaskId,
        resolution
      });

      // Check if this task is now unblocked
      const isBlockedResult = await this.dependencyRepo.isBlocked(dep.taskId);
      if (!isBlockedResult.ok) {
        this.logger.error('Failed to check if task is blocked', isBlockedResult.error, {
          taskId: dep.taskId
        });
        continue;
      }

      if (!isBlockedResult.value) {
        // Task is unblocked - fetch task and emit event
        this.logger.info('Task unblocked', { taskId: dep.taskId });

        // ARCHITECTURE: Fetch task to include in event, preventing layer violation
        const taskResult = await this.taskRepo.findById(dep.taskId);
        if (!taskResult.ok || !taskResult.value) {
          const errorMessage = taskResult.ok ? 'Task not found' : taskResult.error.message;
          this.logger.error('Failed to fetch unblocked task', new Error(errorMessage), {
            taskId: dep.taskId
          });
          continue;
        }

        await this.eventBus.emit('TaskUnblocked', {
          taskId: dep.taskId,
          task: taskResult.value
        });
      }
    }

    return ok(undefined);
  }
}
