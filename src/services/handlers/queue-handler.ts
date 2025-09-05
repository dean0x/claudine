/**
 * Task queue management event handler
 * Manages queue operations through events
 */

import { TaskQueue, Logger } from '../../core/interfaces.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import { 
  TaskDelegatedEvent,
  TaskCancelledEvent,
  createEvent
} from '../../core/events/events.js';
import { TaskStatus } from '../../core/domain.js';

export class QueueHandler extends BaseEventHandler {
  private eventBus?: EventBus;

  constructor(
    private readonly queue: TaskQueue,
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
      eventBus.subscribe('TaskDelegated', this.handleTaskDelegated.bind(this)),
      eventBus.subscribe('TaskCancellationRequested', this.handleTaskCancellation.bind(this))
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('QueueHandler initialized');
    return ok(undefined);
  }

  /**
   * Handle task delegation - add task to queue
   */
  private async handleTaskDelegated(event: TaskDelegatedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
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
      console.error(`[QueueHandler] About to emit TaskQueued event for task ${event.task.id}`);
      if (this.eventBus) {
        const emitResult = await this.eventBus.emit('TaskQueued', { 
          taskId: event.task.id,
          task: event.task 
        });
        
        if (!emitResult.ok) {
          this.logger.error('Failed to emit TaskQueued event', emitResult.error, {
            taskId: event.task.id
          });
          console.error(`[QueueHandler] FAILED to emit TaskQueued event: ${emitResult.error.message}`);
          // Don't fail the enqueue operation - the task is in the queue
        } else {
          console.error(`[QueueHandler] Successfully emitted TaskQueued event for task ${event.task.id}`);
        }
      } else {
        console.error(`[QueueHandler] ERROR: No eventBus available to emit TaskQueued event!`);
      }
      
      return ok(undefined);
    });
  }

  /**
   * Handle task cancellation request - remove from queue if queued
   */
  private async handleTaskCancellation(event: any): Promise<void> {
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
   * Get next task from queue (called by worker handler)
   */
  async getNextTask(): Promise<Result<any>> {
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
   * Put task back in queue (on failure)
   */
  async requeueTask(task: any): Promise<Result<void>> {
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
      const emitResult = await this.eventBus.emit('TaskQueued', { 
        taskId: task.id,
        task: task 
      });
      
      if (!emitResult.ok) {
        this.logger.error('Failed to emit TaskQueued event for requeued task', emitResult.error, {
          taskId: task.id
        });
        // Don't fail the requeue operation - the task is in the queue
      }
    }

    return ok(undefined);
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): { size: number; tasks: readonly any[] } {
    const allResult = this.queue.getAll();
    
    return {
      size: this.queue.size(),
      tasks: allResult.ok ? allResult.value : []
    };
  }
}