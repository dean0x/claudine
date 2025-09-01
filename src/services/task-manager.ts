/**
 * Main task manager orchestrator
 * Coordinates all components using functional composition
 */

import { 
  TaskManager, 
  TaskQueue, 
  WorkerPool, 
  OutputCapture, 
  Logger,
  ResourceMonitor,
  TaskRepository
} from '../core/interfaces.js';
import { 
  Task, 
  TaskId, 
  DelegateRequest, 
  TaskOutput, 
  createTask,
  updateTask,
  TaskStatus,
  canCancel
} from '../core/domain.js';
import { Result, ok, err } from '../core/result.js';
import { taskNotFound, ClaudineError, ErrorCode } from '../core/errors.js';

export class TaskManagerService implements TaskManager {
  private readonly tasks = new Map<TaskId, Task>();

  constructor(
    private readonly queue: TaskQueue,
    private readonly workers: WorkerPool,
    private readonly output: OutputCapture,
    private readonly monitor: ResourceMonitor,
    private readonly logger: Logger,
    private readonly repository?: TaskRepository
  ) {}

  async delegate(request: DelegateRequest): Promise<Result<Task>> {
    // Create task using pure function
    const task = createTask(request);
    
    // Store task in memory
    this.tasks.set(task.id, task);
    
    // Persist to database if repository available
    if (this.repository) {
      const saveResult = await this.repository.save(task);
      if (!saveResult.ok) {
        this.logger.error('Failed to persist task', saveResult.error);
        // Continue anyway - in-memory will work
      }
    }
    
    // Log
    this.logger.info('Task delegated', {
      taskId: task.id,
      priority: task.priority,
      prompt: task.prompt.substring(0, 100),
    });

    // Add to queue
    const enqueueResult = this.queue.enqueue(task);
    
    if (!enqueueResult.ok) {
      this.tasks.delete(task.id);
      return enqueueResult;
    }

    // Try to process immediately if resources available
    await this.tryProcessNext();

    return ok(task);
  }

  async getStatus(taskId?: TaskId): Promise<Result<Task | readonly Task[]>> {
    if (taskId) {
      const task = this.tasks.get(taskId);
      
      if (!task) {
        return err(taskNotFound(taskId));
      }
      
      return ok(task);
    }

    // Return all tasks
    return ok(Object.freeze(Array.from(this.tasks.values())));
  }

  getLogs(taskId: TaskId, tail?: number): Result<TaskOutput> {
    const task = this.tasks.get(taskId);
    
    if (!task) {
      return err(taskNotFound(taskId));
    }

    return this.output.getOutput(taskId, tail);
  }

  async cancel(taskId: TaskId, reason?: string): Promise<Result<void>> {
    const task = this.tasks.get(taskId);
    
    if (!task) {
      return err(taskNotFound(taskId));
    }

    if (!canCancel(task)) {
      return err(new ClaudineError(
        ErrorCode.TASK_CANNOT_CANCEL,
        `Task ${taskId} cannot be cancelled in state ${task.status}`
      ));
    }

    // If queued, just remove from queue
    if (task.status === TaskStatus.QUEUED) {
      const removeResult = this.queue.remove(taskId);
      
      if (!removeResult.ok) {
        return removeResult;
      }

      // Update task status
      const updatedTask = updateTask(task, {
        status: TaskStatus.CANCELLED,
        completedAt: Date.now(),
      });
      
      this.tasks.set(taskId, updatedTask);
      
      // Persist update
      if (this.repository) {
        await this.repository.save(updatedTask);
      }
      
      this.logger.info('Task cancelled from queue', {
        taskId,
        reason,
      });
      
      return ok(undefined);
    }

    // If running, kill the worker
    if (task.status === TaskStatus.RUNNING) {
      const workerResult = this.workers.getWorkerForTask(taskId);
      
      if (!workerResult.ok) {
        return workerResult;
      }

      const worker = workerResult.value;
      
      if (worker) {
        const killResult = await this.workers.kill(worker.id);
        
        if (!killResult.ok) {
          return killResult;
        }
      }

      // Update task status
      const updatedTask = updateTask(task, {
        status: TaskStatus.CANCELLED,
        completedAt: Date.now(),
      });
      
      this.tasks.set(taskId, updatedTask);
      
      // Persist update
      if (this.repository) {
        await this.repository.save(updatedTask);
      }
      
      this.logger.info('Running task cancelled', {
        taskId,
        reason,
        workerId: worker?.id,
      });
    }

    return ok(undefined);
  }

  listTasks(): Result<readonly Task[]> {
    return ok(Object.freeze(Array.from(this.tasks.values())));
  }

  /**
   * Try to process next task if resources available
   */
  async tryProcessNext(): Promise<void> {
    // Check if we can spawn a worker
    const canSpawnResult = await this.monitor.canSpawnWorker();
    
    if (!canSpawnResult.ok || !canSpawnResult.value) {
      return;
    }

    // Get next task from queue
    const dequeueResult = this.queue.dequeue();
    
    if (!dequeueResult.ok || !dequeueResult.value) {
      return;
    }

    const task = dequeueResult.value;

    // Update task to running
    const runningTask = updateTask(task, {
      status: TaskStatus.RUNNING,
      startedAt: Date.now(),
    });
    
    this.tasks.set(task.id, runningTask);

    // Spawn worker
    const workerResult = await this.workers.spawn(runningTask);
    
    if (!workerResult.ok) {
      // Failed to spawn, put back in queue
      this.queue.enqueue(task);
      
      // Revert task status
      this.tasks.set(task.id, task);
      
      this.logger.error('Failed to spawn worker', workerResult.error, {
        taskId: task.id,
      });
      
      return;
    }

    const worker = workerResult.value;

    // Update task with worker info
    const taskWithWorker = updateTask(runningTask, {
      workerId: worker.id,
    });
    
    this.tasks.set(task.id, taskWithWorker);

    this.logger.info('Task started', {
      taskId: task.id,
      workerId: worker.id,
      pid: worker.pid,
    });

    // Set up output capture (this would connect to the actual process)
    this.setupOutputCapture(task.id);

    // Recursively try to process more tasks
    await this.tryProcessNext();
  }

  /**
   * Set up output capture for a task
   */
  private setupOutputCapture(taskId: TaskId): void {
    // In real implementation, this would connect to the process stdout/stderr
    // For now, just log that we're setting it up
    this.logger.debug('Setting up output capture', { taskId });
  }

  /**
   * Handle task completion
   */
  async onTaskComplete(taskId: TaskId, exitCode: number): Promise<void> {
    const task = this.tasks.get(taskId);
    
    if (!task) {
      return;
    }

    const updatedTask = updateTask(task, {
      status: exitCode === 0 ? TaskStatus.COMPLETED : TaskStatus.FAILED,
      completedAt: Date.now(),
      exitCode,
    });
    
    this.tasks.set(taskId, updatedTask);

    this.logger.info('Task completed', {
      taskId,
      status: updatedTask.status,
      exitCode,
      duration: updatedTask.completedAt! - updatedTask.startedAt!,
    });

    // Persist update if repository available
    if (this.repository) {
      const saveResult = await this.repository.save(updatedTask);
      if (!saveResult.ok) {
        this.logger.error('Failed to persist completed task', saveResult.error);
      }
    }

    // Try to process next task
    await this.tryProcessNext();
  }

  async onTaskTimeout(taskId: TaskId, error: ClaudineError): Promise<void> {
    const task = this.tasks.get(taskId);
    
    if (!task) {
      return;
    }

    const updatedTask = updateTask(task, {
      status: TaskStatus.FAILED,
      completedAt: Date.now(),
    });
    
    this.tasks.set(taskId, updatedTask);

    this.logger.error(`Task ${taskId} timed out after ${error.context?.timeoutMs || 'unknown'}ms`);

    // Persist update if repository available
    if (this.repository) {
      const saveResult = await this.repository.save(updatedTask);
      if (!saveResult.ok) {
        this.logger.error('Failed to persist timed out task', saveResult.error);
      }
    }

    // Try to process next task
    await this.tryProcessNext();
  }

  /**
   * Clean up old completed tasks
   */
  cleanupOldTasks(keepCount = 10): void {
    const completed = Array.from(this.tasks.values())
      .filter(t => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.FAILED)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    if (completed.length <= keepCount) {
      return;
    }

    const toRemove = completed.slice(keepCount);
    
    for (const task of toRemove) {
      this.tasks.delete(task.id);
      this.output.clear(task.id);
    }

    this.logger.debug('Cleaned up old tasks', {
      removed: toRemove.length,
      kept: keepCount,
    });
  }
}