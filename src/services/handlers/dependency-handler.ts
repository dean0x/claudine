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
import {
  TaskDelegatedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskCancelledEvent,
  TaskTimeoutEvent
} from '../../core/events/events.js';
import { DependencyGraph } from '../../core/dependency-graph.js';
import { ClaudineError, ErrorCode } from '../../core/errors.js';

export class DependencyHandler extends BaseEventHandler {
  private eventBus?: EventBus;
  private graphCache: DependencyGraph | null = null;

  constructor(
    private readonly dependencyRepo: DependencyRepository,
    private readonly taskRepo: TaskRepository,
    logger: Logger
  ) {
    super(logger, 'DependencyHandler');
  }

  /**
   * Set up event subscriptions for dependency management
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    this.eventBus = eventBus;

    const subscriptions = [
      // Listen for new tasks to add dependencies
      eventBus.subscribe('TaskDelegated', this.handleTaskDelegated.bind(this)),
      // Listen for task completions to resolve dependencies
      eventBus.subscribe('TaskCompleted', this.handleTaskCompleted.bind(this)),
      eventBus.subscribe('TaskFailed', this.handleTaskFailed.bind(this)),
      eventBus.subscribe('TaskCancelled', this.handleTaskCancelled.bind(this)),
      eventBus.subscribe('TaskTimeout', this.handleTaskTimeout.bind(this)),
      // Listen for dependency additions to invalidate cache
      eventBus.subscribe('TaskDependencyAdded', this.handleDependencyAdded.bind(this))
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('DependencyHandler initialized - DAG validation and dependency tracking active');
    return ok(undefined);
  }

  /**
   * Get dependency graph (cached or fresh)
   * PERFORMANCE: Cache graph at handler level to avoid N+1 findAll() calls
   */
  private async getGraph(): Promise<Result<DependencyGraph>> {
    // Return cached graph if available
    if (this.graphCache) {
      this.logger.debug('Using cached dependency graph');
      return ok(this.graphCache);
    }

    // Build fresh graph from repository
    this.logger.debug('Building fresh dependency graph');
    const allDepsResult = await this.dependencyRepo.findAll();
    if (!allDepsResult.ok) {
      return allDepsResult;
    }

    // Cache the graph
    this.graphCache = new DependencyGraph(allDepsResult.value);
    return ok(this.graphCache);
  }

  /**
   * Handle dependency added event - invalidate cache
   */
  private async handleDependencyAdded(): Promise<void> {
    this.graphCache = null;
    this.logger.debug('Dependency graph cache invalidated');
  }

  /**
   * Handle new task delegation - add dependencies with cycle detection
   * ARCHITECTURE: DAG validation BEFORE persisting to prevent cycles
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

      // Get dependency graph (cached or fresh)
      const graphResult = await this.getGraph();
      if (!graphResult.ok) {
        return graphResult;
      }
      const graph = graphResult.value;

      // Validate each proposed dependency for cycles
      for (const dependsOnTaskId of task.dependsOn) {
        // Check if dependency would create cycle
        const cycleCheck = graph.wouldCreateCycle(task.id, dependsOnTaskId);
        if (!cycleCheck.ok) {
          return cycleCheck;
        }

        if (cycleCheck.value) {
          const error = new ClaudineError(
            ErrorCode.INVALID_OPERATION,
            `Cannot add dependency: would create cycle (${task.id} -> ${dependsOnTaskId})`
          );

          this.logger.error('Cycle detected in dependency graph', error, {
            taskId: task.id,
            dependsOnTaskId
          });

          // Emit failure event
          if (this.eventBus) {
            await this.eventBus.emit('TaskDependencyFailed', {
              taskId: task.id,
              failedDependencyId: dependsOnTaskId,
              error
            });
          }

          return err(error);
        }

        // No cycle - safe to add dependency
        const addResult = await this.dependencyRepo.addDependency(task.id, dependsOnTaskId);
        if (!addResult.ok) {
          this.logger.error('Failed to add dependency', addResult.error, {
            taskId: task.id,
            dependsOnTaskId
          });
          return addResult;
        }

        this.logger.debug('Dependency added', {
          taskId: task.id,
          dependsOnTaskId,
          dependencyId: addResult.value.id
        });

        // Emit success event
        if (this.eventBus) {
          await this.eventBus.emit('TaskDependencyAdded', {
            taskId: task.id,
            dependsOnTaskId
          });
        }
      }

      this.logger.info('All dependencies added successfully', {
        taskId: task.id,
        count: task.dependsOn.length
      });

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
   * Resolve dependencies and check if dependent tasks are now unblocked
   * @param completedTaskId Task that just completed/failed/cancelled
   * @param resolution Resolution state
   */
  private async resolveDependencies(
    completedTaskId: string,
    resolution: 'completed' | 'failed' | 'cancelled'
  ): Promise<Result<void>> {
    // Get all tasks that depend on this completed task
    const dependentsResult = await this.dependencyRepo.getDependents(completedTaskId as any);
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

    // Resolve each dependency
    for (const dep of dependents) {
      const resolveResult = await this.dependencyRepo.resolveDependency(
        dep.taskId,
        dep.dependsOnTaskId,
        resolution
      );

      if (!resolveResult.ok) {
        this.logger.error('Failed to resolve dependency', resolveResult.error, {
          taskId: dep.taskId,
          dependsOnTaskId: dep.dependsOnTaskId
        });
        continue;
      }

      this.logger.debug('Dependency resolved', {
        taskId: dep.taskId,
        dependsOnTaskId: dep.dependsOnTaskId,
        resolution
      });

      // Emit resolution event
      if (this.eventBus) {
        await this.eventBus.emit('TaskDependencyResolved', {
          taskId: dep.taskId,
          dependsOnTaskId: dep.dependsOnTaskId,
          resolution
        });
      }

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

        if (this.eventBus) {
          await this.eventBus.emit('TaskUnblocked', {
            taskId: dep.taskId,
            task: taskResult.value
          });
        }
      }
    }

    return ok(undefined);
  }
}
