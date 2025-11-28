/**
 * Worker lifecycle management event handler
 * Manages worker spawning, monitoring, and cleanup through events
 */

import { WorkerPool, ResourceMonitor, Logger } from '../../core/interfaces.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  TaskDelegatedEvent,
  TaskCancelledEvent,
  TaskStatusQueryEvent,
  TaskCancellationRequestedEvent,
  TaskQueuedEvent,
  NextTaskQueryEvent,
  createEvent
} from '../../core/events/events.js';
import { Task, TaskId, TaskStatus, Worker } from '../../core/domain.js';
import { ClaudineError, ErrorCode, taskNotFound } from '../../core/errors.js';
import { Configuration } from '../../core/configuration.js';

export class WorkerHandler extends BaseEventHandler {
  /**
   * CRITICAL: Spawn burst protection - DO NOT REMOVE without proper justification
   *
   * WHY THIS EXISTS:
   * Process creation (fork/exec) is expensive at the OS level. Spawning multiple
   * claude-code processes simultaneously causes:
   * 1. CPU spike from fork/exec system calls
   * 2. Memory spike from loading multiple Node.js runtimes
   * 3. I/O spike from loading code from disk
   *
   * The resource monitor checks happen BEFORE processes spawn, so they can't detect
   * the spike caused by the spawning itself. This creates a race condition where
   * all pending tasks pass the resource check and spawn simultaneously.
   *
   * WHAT IT DOES:
   * Enforces a minimum 50ms delay between worker spawns to prevent burst spawning.
   * This gives each process time to register its resource usage before the next
   * spawn check occurs.
   *
   * REMOVAL CRITERIA:
   * Only remove this if you have implemented one of these alternatives:
   * 1. Sequential spawn queue (only spawn one worker at a time)
   * 2. Post-spawn resource monitoring (wait for process to fully initialize)
   * 3. Dynamic spawn throttling based on failed spawn attempts
   *
   * INCIDENT REFERENCE: 2025-10-04
   * Without this delay, recovery re-queued 7 tasks → all spawned simultaneously → fork bomb
   */
  private lastSpawnTime = 0;
  private readonly minSpawnDelayMs: number;
  private readonly SPAWN_BACKOFF_MS = 1000; // Backoff when resources are constrained

  constructor(
    config: Configuration,
    private readonly workerPool: WorkerPool,
    private readonly resourceMonitor: ResourceMonitor,
    private readonly eventBus: EventBus,
    logger: Logger
  ) {
    super(logger, 'WorkerHandler');
    // Use configured delay, default to 50ms (reduced from 100ms for better responsiveness)
    this.minSpawnDelayMs = config.minSpawnDelayMs || 50;
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
  private async handleTaskQueued(event: TaskQueuedEvent): Promise<void> {
    this.logger.debug('Received TaskQueued event', {
      taskId: event.taskId
    });
    await this.handleEvent(event, async (event) => {
      this.logger.debug('Task queued, attempting to process', {
        taskId: event.taskId
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
   * ARCHITECTURE: Pure event-driven - uses TaskStatusQuery instead of direct repository access
   */
  private async handleTaskCancellation(event: TaskCancellationRequestedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const { taskId, reason } = event;

      // First validate that task can be cancelled using event-driven query
      const taskResult = await this.eventBus.request<TaskStatusQueryEvent, Task | null>(
        'TaskStatusQuery',
        { taskId }
      );

      if (!taskResult.ok) {
        this.logger.error('Failed to find task for cancellation', taskResult.error, { taskId });
        return taskResult;
      }

      if (!taskResult.value) {
        this.logger.error('Task not found for cancellation', undefined, { taskId });
        return err(taskNotFound(taskId));
      }

      const task = taskResult.value;

      // Check if task can be cancelled (must be QUEUED or RUNNING)
      if (task.status !== 'queued' && task.status !== 'running') {
        this.logger.warn('Cannot cancel task in current state', {
          taskId,
          status: task.status,
          reason
        });
        return err(new ClaudineError(
          ErrorCode.TASK_CANNOT_CANCEL,
          `Task ${taskId} cannot be cancelled in state ${task.status}`,
          { taskId, status: task.status, reason }
        ));
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
   * ARCHITECTURE: Enforces spawn delay to prevent burst fork-bomb scenarios
   * See class-level documentation for justification
   */
  private async processNextTask(): Promise<void> {
    try {
      // Enforce minimum delay between spawns to prevent overwhelming the system
      const now = Date.now();
      const timeSinceLastSpawn = now - this.lastSpawnTime;

      if (timeSinceLastSpawn < this.minSpawnDelayMs) {
        const delay = this.minSpawnDelayMs - timeSinceLastSpawn;
        this.logger.debug('Delaying spawn to prevent burst overload', {
          delay,
          timeSinceLastSpawn,
          reason: 'fork-bomb prevention'
        });

        // Schedule retry after delay
        setTimeout(() => this.processNextTask(), delay);
        return;
      }

      // Check if we can spawn a worker based on CPU/memory resources
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

      // Get next task from queue using event-driven query
      const taskResult = await this.eventBus.request<NextTaskQueryEvent, Task | null>(
        'NextTaskQuery',
        {}
      );

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

        // Put task back in queue using event
        await this.eventBus.emit('RequeueTask', { task });
        return;
      }

      // Spawn worker
      const workerResult = await this.workerPool.spawn(task);
      
      if (!workerResult.ok) {
        this.logger.error('Failed to spawn worker', workerResult.error, {
          taskId: task.id
        });

        // Put task back in queue using event
        await this.eventBus.emit('RequeueTask', { task });

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

      // Record spawn for settling worker tracking (accounts for lag in load average)
      this.resourceMonitor.recordSpawn();

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
  async onWorkerComplete(taskId: TaskId, exitCode: number): Promise<void> {
    try {
      // Update resource monitor
      this.resourceMonitor.decrementWorkerCount();

      // Calculate duration using task startedAt timestamp via event query
      let duration = 0;
      const taskResult = await this.eventBus.request<TaskStatusQueryEvent, Task | null>(
        'TaskStatusQuery',
        { taskId }
      );
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
  async onWorkerTimeout(taskId: TaskId, error: ClaudineError): Promise<void> {
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
    workers: readonly Worker[];
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