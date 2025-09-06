/**
 * Event-driven worker pool implementation
 * Eliminates race conditions through event-based coordination
 */

import { ChildProcess } from 'child_process';
import { WorkerPool, ProcessSpawner, ResourceMonitor, Logger, OutputCapture, EventBus } from '../core/interfaces.js';
import { Worker, WorkerId, Task, TaskId } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode, taskTimeout } from '../core/errors.js';
import { ProcessConnector } from '../services/process-connector.js';

interface WorkerState extends Worker {
  process: ChildProcess;
  task: Task;
  timeoutTimer?: NodeJS.Timeout;
}

export class EventDrivenWorkerPool implements WorkerPool {
  private readonly workers = new Map<WorkerId, WorkerState>();
  private readonly taskToWorker = new Map<TaskId, WorkerId>();
  private readonly processConnector: ProcessConnector;

  constructor(
    private readonly spawner: ProcessSpawner,
    private readonly monitor: ResourceMonitor,
    private readonly logger: Logger,
    private readonly eventBus: EventBus,
    outputCapture: OutputCapture
  ) {
    this.processConnector = new ProcessConnector(outputCapture, logger);
  }

  async spawn(task: Task): Promise<Result<Worker>> {
    this.logger.debug('Spawning worker for task', {
      taskId: task.id,
      prompt: task.prompt.substring(0, 100)
    });

    // Check if we can spawn based on resources
    const canSpawnResult = await this.monitor.canSpawnWorker();
    
    if (!canSpawnResult.ok) {
      return canSpawnResult;
    }

    if (!canSpawnResult.value) {
      return err(new ClaudineError(
        ErrorCode.INSUFFICIENT_RESOURCES,
        'Insufficient resources to spawn worker'
      ));
    }

    // Spawn the process
    const spawnResult = this.spawner.spawn(
      task.prompt,
      task.workingDirectory || process.cwd()
    );

    if (!spawnResult.ok) {
      return err(new ClaudineError(
        ErrorCode.WORKER_SPAWN_FAILED,
        `Failed to spawn worker: ${spawnResult.error.message}`
      ));
    }

    const { process: childProcess, pid } = spawnResult.value;
    const workerId = WorkerId(`worker-${pid}`);

    // Create worker state
    const worker: WorkerState = {
      id: workerId,
      taskId: task.id,
      pid,
      startedAt: Date.now(),
      cpuUsage: 0,
      memoryUsage: 0,
      process: childProcess,
      task,
    };

    // Store worker
    this.workers.set(workerId, worker);
    this.taskToWorker.set(task.id, workerId);

    // Set up timeout if task has one
    this.setupTimeoutForWorker(worker);

    // Connect process output to OutputCapture
    this.processConnector.connect(
      childProcess,
      task.id,
      (exitCode) => {
        // Handle worker completion through events
        console.error(`[WorkerPool] Received exit code: ${exitCode}, type=${typeof exitCode}`);
        this.handleWorkerCompletion(task.id, exitCode ?? 0);
      }
    );

    this.logger.info('Worker spawned successfully', {
      taskId: task.id,
      workerId: worker.id,
      pid: worker.pid
    });

    return ok(worker);
  }

  async kill(workerId: WorkerId): Promise<Result<void>> {
    const worker = this.workers.get(workerId);
    
    if (!worker) {
      return err(new ClaudineError(
        ErrorCode.WORKER_NOT_FOUND,
        `Worker ${workerId} not found`
      ));
    }

    this.logger.info('Killing worker', {
      workerId,
      taskId: worker.taskId,
      pid: worker.pid
    });

    try {
      // Clear timeout to prevent race condition
      this.clearTimeoutForWorker(worker);

      // Kill the process
      if (worker.process && !worker.process.killed) {
        worker.process.kill('SIGTERM');
        
        // Force kill after 5 seconds if still alive
        setTimeout(() => {
          if (!worker.process.killed) {
            worker.process.kill('SIGKILL');
          }
        }, 5000);
      }

      // Clean up worker state
      this.workers.delete(workerId);
      this.taskToWorker.delete(worker.taskId);

      // Decrement worker count
      this.monitor.decrementWorkerCount();

      return ok(undefined);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.WORKER_KILL_FAILED,
        `Failed to kill worker: ${error}`
      ));
    }
  }

  async killAll(): Promise<Result<void>> {
    const workerIds = Array.from(this.workers.keys());
    
    this.logger.info('Killing all workers', {
      workerCount: workerIds.length
    });

    const results = await Promise.allSettled(
      workerIds.map(workerId => this.kill(workerId))
    );

    const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
    
    if (failures.length > 0) {
      this.logger.error('Some workers failed to kill', undefined, {
        failures: failures.length,
        total: workerIds.length
      });
    }

    return ok(undefined);
  }

  getWorker(workerId: WorkerId): Result<Worker | null> {
    const worker = this.workers.get(workerId);
    return ok(worker || null);
  }

  getWorkers(): Result<readonly Worker[]> {
    return ok(Object.freeze(Array.from(this.workers.values())));
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  getWorkerForTask(taskId: TaskId): Result<Worker | null> {
    const workerId = this.taskToWorker.get(taskId);
    
    if (!workerId) {
      return ok(null);
    }

    const worker = this.workers.get(workerId);
    return ok(worker || null);
  }

  /**
   * Set up timeout for a worker - no race conditions
   */
  private setupTimeoutForWorker(worker: WorkerState): void {
    const timeoutMs = worker.task.timeout;
    
    console.error(`[WorkerPool] Setting up timeout for task ${worker.taskId}: ${timeoutMs}ms`);
    
    // CRITICAL FIX: setTimeout(fn, undefined) executes immediately!
    if (!timeoutMs || timeoutMs <= 0) {
      console.error(`[WorkerPool] No timeout configured for task ${worker.taskId}`);
      return; // No timeout configured
    }

    // Create timeout timer  
    worker.timeoutTimer = setTimeout(() => {
      console.error(`[WorkerPool] TIMEOUT TRIGGERED for task ${worker.taskId} after ${timeoutMs}ms`);
      this.handleWorkerTimeout(worker.taskId, timeoutMs);
    }, timeoutMs);

    this.logger.debug('Worker timeout set', {
      taskId: worker.taskId,
      workerId: worker.id,
      timeoutMs
    });
  }

  /**
   * Clear timeout for worker - prevents race conditions
   */
  private clearTimeoutForWorker(worker: WorkerState): void {
    if (worker.timeoutTimer) {
      clearTimeout(worker.timeoutTimer);
      worker.timeoutTimer = undefined;
      
      this.logger.debug('Worker timeout cleared', {
        taskId: worker.taskId,
        workerId: worker.id
      });
    }
  }

  /**
   * Handle worker completion - event-driven, no race conditions
   */
  private async handleWorkerCompletion(taskId: TaskId, exitCode: number): Promise<void> {
    const workerId = this.taskToWorker.get(taskId);
    
    if (!workerId) {
      this.logger.warn('Worker completion for unknown task', { taskId, exitCode });
      return;
    }

    const worker = this.workers.get(workerId);
    
    if (!worker) {
      this.logger.warn('Worker completion for unknown worker', { taskId, workerId, exitCode });
      return;
    }

    // Clear timeout to prevent race condition
    this.clearTimeoutForWorker(worker);

    // Calculate duration
    const duration = Date.now() - worker.startedAt;

    // Clean up worker state
    this.workers.delete(workerId);
    this.taskToWorker.delete(taskId);
    this.monitor.decrementWorkerCount();

    // Emit appropriate event
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
        error: new ClaudineError(
          ErrorCode.TASK_EXECUTION_FAILED,
          `Task failed with exit code ${exitCode}`
        )
      });
    }

    this.logger.info('Worker completion handled', {
      taskId,
      workerId,
      exitCode,
      duration
    });
  }

  /**
   * Handle worker timeout - event-driven
   */
  private async handleWorkerTimeout(taskId: TaskId, timeoutMs: number): Promise<void> {
    
    const workerId = this.taskToWorker.get(taskId);
    
    if (!workerId) {
      this.logger.warn('Worker timeout for unknown task', { taskId, timeoutMs });
      return;
    }

    const worker = this.workers.get(workerId);
    
    if (!worker) {
      this.logger.warn('Worker timeout for unknown worker', { taskId, workerId, timeoutMs });
      return;
    }

    this.logger.warn('Worker timed out, killing process', {
      taskId,
      workerId,
      timeoutMs,
      pid: worker.pid
    });

    // Kill the worker (this will clean up state)
    await this.kill(workerId);

    // Emit timeout event
    await this.eventBus.emit('TaskTimeout', {
      taskId,
      error: taskTimeout(taskId, timeoutMs)
    });
  }

  /**
   * Handle worker process errors
   */
  private async handleWorkerError(taskId: TaskId, error: Error): Promise<void> {
    this.logger.error('Worker process error', error, { taskId });

    // Emit task failed event
    await this.eventBus.emit('TaskFailed', {
      taskId,
      exitCode: 1,
      error: new ClaudineError(
        ErrorCode.TASK_EXECUTION_FAILED,
        `Worker process error: ${error.message}`
      )
    });
  }
}