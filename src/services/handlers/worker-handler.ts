/**
 * Worker lifecycle management event handler
 * Manages worker spawning, monitoring, and cleanup through events
 */

import { WorkerPool, ResourceMonitor, Logger, TaskRepository } from '../../core/interfaces.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  TaskDelegatedEvent,
  TaskCancelledEvent,
  createEvent
} from '../../core/events/events.js';
import { TaskStatus } from '../../core/domain.js';
import { QueueHandler } from './queue-handler.js';
import { Configuration } from '../../core/configuration.js';

export class WorkerHandler extends BaseEventHandler {
  private lastSpawnTime = 0;
  private readonly minSpawnDelayMs: number;
  private readonly SPAWN_BACKOFF_MS = 1000; // Backoff when resources are constrained

  constructor(
    config: Configuration,
    private readonly workerPool: WorkerPool,
    private readonly resourceMonitor: ResourceMonitor,
    private readonly queueHandler: QueueHandler,
    private readonly taskRepository: TaskRepository,
    private readonly eventBus: EventBus,
    logger: Logger
  ) {
    super(logger, 'WorkerHandler');
    this.minSpawnDelayMs = config.minSpawnDelayMs!;
  }

  /**
   * Set up event subscriptions - purely event-driven, no polling
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    const subscriptions = [
      eventBus.subscribe('TaskQueued', this.handleTaskQueued.bind(this)),
      eventBus.subscribe('TaskCancellationRequested', this.handleTaskCancellation.bind(this))
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('WorkerHandler initialized - event-driven processing');
    return ok(undefined);
  }

  /**
   * Clean shutdown - kill all workers
   */
  async teardown(): Promise<void> {
    // Kill all workers
    await this.workerPool.killAll();
    
    this.logger.info('WorkerHandler shutdown complete');
  }

  /**
   * Handle task queued - process immediately
   */
  private async handleTaskQueued(event: any): Promise<void> {
    this.logger.debug('Received TaskQueued event', {
      taskId: event.taskId || event.task?.id
    });
    await this.handleEvent(event, async (event) => {
      this.logger.debug('Task queued, attempting to process', {
        taskId: event.taskId || event.task?.id
      });

      this.logger.debug('About to call processNextTask()');
      // Process task immediately when queued
      await this.processNextTask();
      this.logger.debug('Completed processNextTask()');

      return ok(undefined);
    });
  }

  /**
   * Handle task cancellation - validate and kill worker if running
   * ARCHITECTURE: Validation moved here from TaskManager for pure event-driven pattern
   */
  private async handleTaskCancellation(event: any): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const { taskId, reason } = event;

      // First validate that task can be cancelled
      if (this.taskRepository) {
        const taskResult = await this.taskRepository.findById(taskId);

        if (!taskResult.ok) {
          this.logger.error('Failed to find task for cancellation', taskResult.error, { taskId });
          throw taskResult.error;
        }

        if (!taskResult.value) {
          this.logger.error('Task not found for cancellation', undefined, { taskId });
          throw new Error(`Task ${taskId} not found`);
        }

        const task = taskResult.value;

        // Check if task can be cancelled (must be QUEUED or RUNNING)
        if (task.status !== 'queued' && task.status !== 'running') {
          this.logger.warn('Cannot cancel task in current state', {
            taskId,
            status: task.status,
            reason
          });
          throw new Error(`Task ${taskId} cannot be cancelled in state ${task.status}`);
        }
      }

      // Check if we have a worker for this task
      const workerResult = this.workerPool.getWorkerForTask(taskId);

      if (workerResult.ok && workerResult.value) {
        const worker = workerResult.value;
        
        this.logger.info('Killing worker for cancelled task', {
          taskId,
          workerId: worker.id
        });

        // Kill the worker
        const killResult = await this.workerPool.kill(worker.id);
        
        if (!killResult.ok) {
          this.logger.error('Failed to kill worker for cancelled task', killResult.error, {
            taskId,
            workerId: worker.id
          });
          return killResult;
        }

        // Emit worker killed event
        const result = await this.eventBus.emit('WorkerKilled', {
          workerId: worker.id,
          taskId
        });
        
        if (!result.ok) {
          this.logger.error('Failed to emit WorkerKilled event', result.error);
        }
      }

      return ok(undefined);
    });
  }

  /**
   * Process next task if resources available
   */
  private async processNextTask(): Promise<void> {
    try {
      // Enforce minimum delay between spawns to prevent overwhelming the system
      const now = Date.now();
      const timeSinceLastSpawn = now - this.lastSpawnTime;

      if (timeSinceLastSpawn < this.minSpawnDelayMs) {
        const delay = this.minSpawnDelayMs - timeSinceLastSpawn;
        this.logger.debug('Delaying spawn to prevent system overload', {
          delay,
          timeSinceLastSpawn
        });

        // Schedule retry after delay
        setTimeout(() => this.processNextTask(), delay);
        return;
      }

      // Check if we can spawn a worker
      const canSpawnResult = await this.resourceMonitor.canSpawnWorker();

      if (!canSpawnResult.ok || !canSpawnResult.value) {
        // Apply backoff when resources are constrained
        this.logger.debug('Resources constrained, applying backoff', {
          backoffMs: this.SPAWN_BACKOFF_MS
        });

        // Schedule retry with backoff
        setTimeout(() => this.processNextTask(), this.SPAWN_BACKOFF_MS);
        return; // No resources available
      }

      // Get next task from queue
      const taskResult = await this.queueHandler.getNextTask();
      
      if (!taskResult.ok || !taskResult.value) {
        return; // No tasks or error getting task
      }

      const task = taskResult.value;

      this.logger.info('Starting task processing', {
        taskId: task.id,
        priority: task.priority
      });

      // Emit task starting event
      const startingResult = await this.eventBus.emit('TaskStarting', {
        taskId: task.id
      });

      if (!startingResult.ok) {
        this.logger.error('Failed to emit TaskStarting event', startingResult.error, {
          taskId: task.id
        });
        
        // Put task back in queue
        await this.queueHandler.requeueTask(task);
        return;
      }

      // Spawn worker
      const workerResult = await this.workerPool.spawn(task);
      
      if (!workerResult.ok) {
        this.logger.error('Failed to spawn worker', workerResult.error, {
          taskId: task.id
        });

        // Put task back in queue
        await this.queueHandler.requeueTask(task);
        
        // Emit task failed event
        await this.eventBus.emit('TaskFailed', {
          taskId: task.id,
          error: workerResult.error,
          exitCode: 1
        });
        
        return;
      }

      const worker = workerResult.value;

      // Record spawn time for throttling
      this.lastSpawnTime = Date.now();

      // Update resource monitor
      this.resourceMonitor.incrementWorkerCount();

      // Emit worker spawned and task started events
      await Promise.all([
        this.eventBus.emit('WorkerSpawned', {
          worker,
          taskId: task.id
        }),
        this.eventBus.emit('TaskStarted', {
          taskId: task.id,
          workerId: worker.id
        })
      ]);

      this.logger.info('Task started with worker', {
        taskId: task.id,
        workerId: worker.id,
        pid: worker.pid
      });

    } catch (error) {
      this.logger.error('Error in task processing', error as Error);
    }
  }

  /**
   * Handle worker completion (called by WorkerPool)
   */
  async onWorkerComplete(taskId: any, exitCode: number): Promise<void> {
    try {
      // Update resource monitor
      this.resourceMonitor.decrementWorkerCount();

      // Calculate duration using task startedAt timestamp
      let duration = 0;
      const taskResult = await this.taskRepository.findById(taskId);
      if (taskResult.ok && taskResult.value?.startedAt) {
        duration = Date.now() - taskResult.value.startedAt;
      }

      if (exitCode === 0) {
        await this.eventBus.emit('TaskCompleted', {
          taskId,
          exitCode,
          duration
        });
      } else {
        await this.eventBus.emit('TaskFailed', {
          taskId,
          exitCode,
          error: new Error(`Task failed with exit code ${exitCode}`),
        });
      }

      this.logger.info('Worker completed', {
        taskId,
        exitCode,
        duration
      });

    } catch (error) {
      this.logger.error('Error handling worker completion', error as Error, {
        taskId,
        exitCode
      });
    }
  }

  /**
   * Handle worker timeout (called by WorkerPool)
   */
  async onWorkerTimeout(taskId: any, error: any): Promise<void> {
    try {
      // Update resource monitor
      this.resourceMonitor.decrementWorkerCount();

      await this.eventBus.emit('TaskTimeout', {
        taskId,
        error
      });

      this.logger.warn('Worker timed out', {
        taskId,
        error: error.message
      });

    } catch (err) {
      this.logger.error('Error handling worker timeout', err as Error, {
        taskId
      });
    }
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): { 
    workerCount: number; 
    workers: readonly any[];
    canSpawn: boolean;
  } {
    const workersResult = this.workerPool.getWorkers();
    
    return {
      workerCount: this.workerPool.getWorkerCount(),
      workers: workersResult.ok ? workersResult.value : [],
      canSpawn: false // Would need async call to determine
    };
  }
}