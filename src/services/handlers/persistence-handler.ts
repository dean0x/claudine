/**
 * Database persistence event handler
 * Manages all task persistence operations through events
 */

import { TaskRepository, Logger } from '../../core/interfaces.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import { 
  TaskDelegatedEvent, 
  TaskStartedEvent, 
  TaskCompletedEvent, 
  TaskFailedEvent, 
  TaskCancelledEvent,
  TaskTimeoutEvent,
  createEvent
} from '../../core/events/events.js';
import { TaskStatus, updateTask } from '../../core/domain.js';

export class PersistenceHandler extends BaseEventHandler {
  private eventBus?: EventBus;

  constructor(
    private readonly repository: TaskRepository,
    logger: Logger
  ) {
    super(logger, 'PersistenceHandler');
  }

  /**
   * Set up event subscriptions
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    this.eventBus = eventBus; // Store reference for later use

    // Subscribe to all task lifecycle events that need persistence
    const subscriptions = [
      eventBus.subscribe('TaskDelegated', this.handleTaskDelegated.bind(this)),
      eventBus.subscribe('TaskStarted', this.handleTaskStarted.bind(this)),
      eventBus.subscribe('TaskCompleted', this.handleTaskCompleted.bind(this)),
      eventBus.subscribe('TaskFailed', this.handleTaskFailed.bind(this)),
      eventBus.subscribe('TaskCancelled', this.handleTaskCancelled.bind(this)),
      eventBus.subscribe('TaskTimeout', this.handleTaskTimeout.bind(this))
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('PersistenceHandler initialized');
    return ok(undefined);
  }

  /**
   * Handle task delegation - persist new task to database
   */
  private async handleTaskDelegated(event: TaskDelegatedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const result = await this.repository.save(event.task);
      
      if (!result.ok) {
        this.logger.error('Failed to persist delegated task', result.error, {
          taskId: event.task.id
        });
        return result;
      }

      this.logger.debug('Task persisted to database', {
        taskId: event.task.id
      });

      // Emit TaskPersisted event with full task for queue handler
      if (this.eventBus) {
        await this.eventBus.emit('TaskPersisted', {
          taskId: event.task.id,
          task: event.task
        });
      }

      return ok(undefined);
    });
  }

  /**
   * Handle task started - update task with running status and worker info
   */
  private async handleTaskStarted(event: TaskStartedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      // Get current task from database
      const taskResult = await this.repository.findById(event.taskId);
      
      if (!taskResult.ok || !taskResult.value) {
        return err(new Error(`Task ${event.taskId} not found for start update`));
      }

      // Update task with running status
      const updatedTask = updateTask(taskResult.value, {
        status: TaskStatus.RUNNING,
        startedAt: Date.now(),
        workerId: event.workerId
      });

      const result = await this.repository.save(updatedTask);
      
      if (!result.ok) {
        this.logger.error('Failed to persist task start', result.error, {
          taskId: event.taskId
        });
        return result;
      }

      this.logger.debug('Task start persisted', {
        taskId: event.taskId,
        workerId: event.workerId
      });

      return ok(undefined);
    });
  }

  /**
   * Handle task completion - update task with completed status and exit code
   */
  private async handleTaskCompleted(event: TaskCompletedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      // Get current task from database
      const taskResult = await this.repository.findById(event.taskId);
      
      if (!taskResult.ok || !taskResult.value) {
        return err(new Error(`Task ${event.taskId} not found for completion update`));
      }

      // Update task with completion status
      const updatedTask = updateTask(taskResult.value, {
        status: TaskStatus.COMPLETED,
        completedAt: Date.now(),
        exitCode: event.exitCode,
        duration: event.duration
      });

      const result = await this.repository.save(updatedTask);
      
      if (!result.ok) {
        this.logger.error('Failed to persist task completion', result.error, {
          taskId: event.taskId
        });
        return result;
      }

      this.logger.debug('Task completion persisted', {
        taskId: event.taskId,
        exitCode: event.exitCode,
        duration: event.duration
      });

      return ok(undefined);
    });
  }

  /**
   * Handle task failure - update task with failed status
   */
  private async handleTaskFailed(event: TaskFailedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      // Get current task from database
      const taskResult = await this.repository.findById(event.taskId);
      
      if (!taskResult.ok || !taskResult.value) {
        return err(new Error(`Task ${event.taskId} not found for failure update`));
      }

      // Update task with failure status
      const updatedTask = updateTask(taskResult.value, {
        status: TaskStatus.FAILED,
        completedAt: Date.now(),
        exitCode: event.exitCode,
        error: event.error?.toJSON ? event.error.toJSON() : event.error
      });

      const result = await this.repository.save(updatedTask);
      
      if (!result.ok) {
        this.logger.error('Failed to persist task failure', result.error, {
          taskId: event.taskId
        });
        return result;
      }

      this.logger.debug('Task failure persisted', {
        taskId: event.taskId,
        error: event.error.message
      });

      return ok(undefined);
    });
  }

  /**
   * Handle task cancellation - update task with cancelled status
   */
  private async handleTaskCancelled(event: TaskCancelledEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      // Get current task from database
      const taskResult = await this.repository.findById(event.taskId);
      
      if (!taskResult.ok || !taskResult.value) {
        return err(new Error(`Task ${event.taskId} not found for cancellation update`));
      }

      // Update task with cancelled status
      const updatedTask = updateTask(taskResult.value, {
        status: TaskStatus.CANCELLED,
        completedAt: Date.now()
      });

      const result = await this.repository.save(updatedTask);
      
      if (!result.ok) {
        this.logger.error('Failed to persist task cancellation', result.error, {
          taskId: event.taskId
        });
        return result;
      }

      this.logger.debug('Task cancellation persisted', {
        taskId: event.taskId,
        reason: event.reason
      });

      return ok(undefined);
    });
  }

  /**
   * Handle task timeout - update task with failed status
   */
  private async handleTaskTimeout(event: TaskTimeoutEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      // Get current task from database
      const taskResult = await this.repository.findById(event.taskId);
      
      if (!taskResult.ok || !taskResult.value) {
        return err(new Error(`Task ${event.taskId} not found for timeout update`));
      }

      // Update task with timeout failure status
      const updatedTask = updateTask(taskResult.value, {
        status: TaskStatus.FAILED,
        completedAt: Date.now(),
        error: event.error?.toJSON ? event.error.toJSON() : event.error
      });

      const result = await this.repository.save(updatedTask);
      
      if (!result.ok) {
        this.logger.error('Failed to persist task timeout', result.error, {
          taskId: event.taskId
        });
        return result;
      }

      this.logger.debug('Task timeout persisted', {
        taskId: event.taskId,
        error: event.error.message
      });

      return ok(undefined);
    });
  }
}