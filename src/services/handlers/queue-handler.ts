/**
 * Task queue management event handler
 * Manages queue operations through events
 * ARCHITECTURE: Dependency-aware queueing - tasks only enqueued when dependencies met
 */

import { TaskQueue, Logger, DependencyRepository, TaskRepository } from '../../core/interfaces.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  TaskPersistedEvent,
  TaskCancelledEvent,
  TaskCancellationRequestedEvent,
  NextTaskQueryEvent,
  RequeueTaskEvent,
  TaskUnblockedEvent,
  createEvent
} from '../../core/events/events.js';
import { Task, TaskStatus } from '../../core/domain.js';

export class QueueHandler extends BaseEventHandler {
  private eventBus?: EventBus;

  constructor(
    private readonly queue: TaskQueue,
    private readonly dependencyRepo: DependencyRepository,
    private readonly taskRepo: TaskRepository,
    logger: Logger
  ) {
    super(logger, 'QueueHandler');
  }

  /**
   * Set up event subscriptions
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    this.eventBus = eventBus; // Store reference for later use

    const subscriptions = [
      eventBus.subscribe('TaskPersisted', this.handleTaskPersisted.bind(this)),
      eventBus.subscribe('TaskCancellationRequested', this.handleTaskCancellation.bind(this)),
      eventBus.subscribe('NextTaskQuery', this.handleNextTaskQuery.bind(this)),
      eventBus.subscribe('RequeueTask', this.handleRequeueTask.bind(this)),
      eventBus.subscribe('TaskUnblocked', this.handleTaskUnblocked.bind(this))
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('QueueHandler initialized - dependency-aware queueing active');
    return ok(undefined);
  }

  /**
   * Handle task persisted - add task to queue only if not blocked by dependencies
   * ARCHITECTURE: Dependency-aware queueing - blocked tasks wait for TaskUnblocked event
   */
  private async handleTaskPersisted(event: TaskPersistedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      // Check if task is blocked by dependencies
      const isBlockedResult = await this.dependencyRepo.isBlocked(event.task.id);
      if (!isBlockedResult.ok) {
        this.logger.error('Failed to check if task is blocked', isBlockedResult.error, {
          taskId: event.task.id
        });
        // Fail-safe: enqueue anyway to avoid stuck tasks
      } else if (isBlockedResult.value) {
        // Task is blocked - do NOT enqueue yet
        this.logger.info('Task blocked by dependencies - waiting for TaskUnblocked event', {
          taskId: event.task.id
        });
        return ok(undefined);
      }

      // Task is not blocked - safe to enqueue
      const result = this.queue.enqueue(event.task);

      if (!result.ok) {
        this.logger.error('Failed to enqueue task', result.error, {
          taskId: event.task.id
        });
        return result;
      }

      this.logger.debug('Task enqueued', {
        taskId: event.task.id,
        priority: event.task.priority,
        queueSize: this.queue.size()
      });

      // Emit event that task is now queued - critical for worker spawning
      if (this.eventBus) {
        await this.emitEvent(this.eventBus, 'TaskQueued', {
          taskId: event.task.id,
          task: event.task
        }, { context: { taskId: event.task.id } });
        // Don't fail the enqueue operation - the task is in the queue
      } else {
        this.logger.error('No eventBus available to emit TaskQueued event', undefined, {
          taskId: event.task.id
        });
      }

      return ok(undefined);
    });
  }

  /**
   * Handle task cancellation request - remove from queue if queued
   */
  private async handleTaskCancellation(event: TaskCancellationRequestedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const { taskId } = event;
      
      // Check if task is in queue
      if (this.queue.contains(taskId)) {
        const result = this.queue.remove(taskId);
        
        if (!result.ok) {
          this.logger.error('Failed to remove task from queue', result.error, {
            taskId
          });
          return result;
        }

        this.logger.debug('Task removed from queue', {
          taskId,
          queueSize: this.queue.size()
        });

        // Task was in queue and removed - it's now cancelled
        // Emit cancellation event (no need to await)
        
        return ok(undefined);
      }

      // Task not in queue - let other handlers deal with it
      this.logger.debug('Task not in queue for cancellation', { taskId });
      return ok(undefined);
    });
  }

  /**
   * Handle next task query - event-driven dequeue operation
   * ARCHITECTURE: Pure event-driven pattern - WorkerHandler uses events, not direct calls
   */
  private async handleNextTaskQuery(event: NextTaskQueryEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const result = this.queue.dequeue();

      if (!result.ok) {
        // Respond with error
        const correlationId = (event as any).__correlationId;
        if (correlationId && this.eventBus && 'respondError' in this.eventBus) {
          (this.eventBus as any).respondError(correlationId, result.error);
        }
        return result;
      }

      if (!result.value) {
        // Respond with null (no tasks)
        const correlationId = (event as any).__correlationId;
        if (correlationId && this.eventBus && 'respond' in this.eventBus) {
          (this.eventBus as any).respond(correlationId, null);
        }
        return ok(undefined);
      }

      const task = result.value;

      this.logger.debug('Task dequeued via event', {
        taskId: task.id,
        priority: task.priority,
        queueSize: this.queue.size()
      });

      // Respond with task
      const correlationId = (event as any).__correlationId;
      if (correlationId && this.eventBus && 'respond' in this.eventBus) {
        (this.eventBus as any).respond(correlationId, task);
      }

      return ok(undefined);
    });
  }

  /**
   * Handle requeue task event - event-driven requeue operation
   * ARCHITECTURE: Pure event-driven pattern - WorkerHandler uses events, not direct calls
   */
  private async handleRequeueTask(event: RequeueTaskEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const { task } = event;

      const result = this.queue.enqueue(task);

      if (!result.ok) {
        this.logger.error('Failed to requeue task via event', result.error, {
          taskId: task.id
        });
        return result;
      }

      this.logger.debug('Task requeued via event', {
        taskId: task.id,
        queueSize: this.queue.size()
      });

      // CRITICAL: Emit TaskQueued event to trigger worker spawning for requeued task
      if (this.eventBus) {
        await this.emitEvent(this.eventBus, 'TaskQueued', {
          taskId: task.id,
          task: task
        }, { context: { taskId: task.id, operation: 'requeue' } });
        // Don't fail the requeue operation - the task is in the queue
      }

      return ok(undefined);
    });
  }

  /**
   * DEPRECATED: Use NextTaskQuery event instead
   * @deprecated This method will be removed - use event-driven pattern
   */
  async getNextTask(): Promise<Result<any>> {
    this.logger.warn('getNextTask() called directly - should use NextTaskQuery event');
    const result = this.queue.dequeue();

    if (!result.ok) {
      return result;
    }

    if (!result.value) {
      return ok(null);
    }

    this.logger.debug('Task dequeued', {
      taskId: result.value.id,
      priority: result.value.priority,
      queueSize: this.queue.size()
    });

    return result;
  }

  /**
   * DEPRECATED: Use RequeueTask event instead
   * @deprecated This method will be removed - use event-driven pattern
   */
  async requeueTask(task: Task): Promise<Result<void>> {
    this.logger.warn('requeueTask() called directly - should use RequeueTask event');
    const result = this.queue.enqueue(task);

    if (!result.ok) {
      this.logger.error('Failed to requeue task', result.error, {
        taskId: task.id
      });
      return result;
    }

    this.logger.debug('Task requeued', {
      taskId: task.id,
      queueSize: this.queue.size()
    });

    // CRITICAL: Emit TaskQueued event to trigger worker spawning for requeued task
    if (this.eventBus) {
      await this.emitEvent(this.eventBus, 'TaskQueued', {
        taskId: task.id,
        task: task
      }, { context: { taskId: task.id, operation: 'legacy-requeue' } });
      // Don't fail the requeue operation - the task is in the queue
    }

    return ok(undefined);
  }

  /**
   * Handle task unblocked - enqueue task when all dependencies are resolved
   * ARCHITECTURE: Dependency-aware queueing - tasks automatically enqueued when ready
   */
  private async handleTaskUnblocked(event: TaskUnblockedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      this.logger.info('Task unblocked - enqueuing for execution', {
        taskId: event.taskId
      });

      // Fetch latest task state to prevent race conditions
      // Event data may be stale if task was cancelled/failed between emission and handling
      const taskResult = await this.taskRepo.findById(event.taskId);
      if (!taskResult.ok) {
        this.logger.error('Failed to fetch unblocked task for re-validation', taskResult.error, {
          taskId: event.taskId
        });
        return err(taskResult.error);
      }
      if (!taskResult.value) {
        this.logger.error('Task not found after unblocking', new Error('Task not found'), {
          taskId: event.taskId
        });
        return err(new Error('Task not found'));
      }
      const task = taskResult.value;

      // Verify task is still in valid state to be enqueued (not cancelled/failed in the meantime)
      if (task.status !== TaskStatus.QUEUED) {
        this.logger.warn('Unblocked task is no longer in QUEUED state, will not be enqueued', {
          taskId: event.taskId,
          status: task.status
        });
        return ok(undefined);
      }

      // Enqueue the unblocked task
      const result = this.queue.enqueue(task);

      if (!result.ok) {
        this.logger.error('Failed to enqueue unblocked task', result.error, {
          taskId: task.id
        });
        return result;
      }

      this.logger.info('Unblocked task enqueued for execution', {
        taskId: task.id,
        priority: task.priority,
        queueSize: this.queue.size()
      });

      // Emit TaskQueued event to trigger worker spawning
      if (this.eventBus) {
        await this.emitEvent(this.eventBus, 'TaskQueued', {
          taskId: task.id,
          task: task
        }, { context: { taskId: task.id, operation: 'unblocked' } });
      }

      return ok(undefined);
    });
  }

  /**
   * Get queue size efficiently without copying task array
   * PERFORMANCE: Only returns count, not full task list
   */
  getQueueSize(): number {
    return this.queue.size();
  }
}