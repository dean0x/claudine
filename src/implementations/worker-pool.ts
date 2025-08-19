/**
 * Worker pool implementation with autoscaling
 * Manages multiple Claude Code instances
 */

import { ChildProcess } from 'child_process';
import { WorkerPool, ProcessSpawner, ResourceMonitor, Logger, OutputCapture } from '../core/interfaces.js';
import { Worker, WorkerId, Task, TaskId } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import { ProcessConnector } from '../services/process-connector.js';

interface WorkerState extends Worker {
  process: ChildProcess;
  task: Task;
}

export class AutoscalingWorkerPool implements WorkerPool {
  private readonly workers = new Map<WorkerId, WorkerState>();
  private readonly taskToWorker = new Map<TaskId, WorkerId>();
  private readonly processConnector: ProcessConnector;
  private onTaskComplete?: (taskId: TaskId, exitCode: number) => void;

  constructor(
    private readonly spawner: ProcessSpawner,
    private readonly monitor: ResourceMonitor,
    private readonly logger: Logger,
    outputCapture: OutputCapture
  ) {
    this.processConnector = new ProcessConnector(outputCapture, logger);
  }

  setTaskCompleteHandler(handler: (taskId: TaskId, exitCode: number) => void): void {
    this.onTaskComplete = handler;
  }

  async spawn(task: Task): Promise<Result<Worker>> {
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

    // Connect process output to OutputCapture
    this.processConnector.connect(
      childProcess,
      task.id,
      (exitCode) => {
        // Handle task completion
        this.onWorkerComplete(task.id, exitCode || 0);
        if (this.onTaskComplete) {
          this.onTaskComplete(task.id, exitCode || 0);
        }
      }
    );

    // Log
    this.logger.info('Worker spawned', {
      workerId,
      taskId: task.id,
      pid,
    });

    // Return public worker info (without process)
    const { process: _, ...publicWorker } = worker;
    return ok(publicWorker);
  }

  async kill(workerId: WorkerId): Promise<Result<void>> {
    const worker = this.workers.get(workerId);
    
    if (!worker) {
      return err(new ClaudineError(
        ErrorCode.WORKER_NOT_FOUND,
        `Worker ${workerId} not found`
      ));
    }

    // Kill the process
    const killResult = this.spawner.kill(worker.pid);
    
    if (!killResult.ok) {
      this.logger.error('Failed to kill worker', killResult.error, {
        workerId,
        pid: worker.pid,
      });
    }

    // Clean up
    this.workers.delete(workerId);
    this.taskToWorker.delete(worker.taskId);

    this.logger.info('Worker killed', {
      workerId,
      taskId: worker.taskId,
      pid: worker.pid,
    });

    return ok(undefined);
  }

  async killAll(): Promise<Result<void>> {
    const killPromises: Promise<Result<void>>[] = [];

    for (const workerId of this.workers.keys()) {
      killPromises.push(this.kill(workerId));
    }

    await Promise.all(killPromises);
    
    this.workers.clear();
    this.taskToWorker.clear();

    this.logger.info('All workers killed');
    return ok(undefined);
  }

  getWorker(workerId: WorkerId): Result<Worker | null> {
    const worker = this.workers.get(workerId);
    
    if (!worker) {
      return ok(null);
    }

    // Return public worker info (without process)
    const { process: _, task: __, ...publicWorker } = worker;
    return ok(publicWorker);
  }

  getWorkers(): Result<readonly Worker[]> {
    const workers: Worker[] = [];

    for (const worker of this.workers.values()) {
      const { process: _, task: __, ...publicWorker } = worker;
      workers.push(publicWorker);
    }

    return ok(Object.freeze(workers));
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  getWorkerForTask(taskId: TaskId): Result<Worker | null> {
    const workerId = this.taskToWorker.get(taskId);
    
    if (!workerId) {
      return ok(null);
    }

    return this.getWorker(workerId);
  }

  // Internal helper to get process for output capture
  getProcess(taskId: TaskId): ChildProcess | null {
    const workerId = this.taskToWorker.get(taskId);
    if (!workerId) return null;

    const worker = this.workers.get(workerId);
    return worker?.process || null;
  }

  // Called when a worker completes
  private onWorkerComplete(taskId: TaskId, exitCode: number): void {
    const workerId = this.taskToWorker.get(taskId);
    if (!workerId) return;

    const worker = this.workers.get(workerId);
    if (!worker) return;

    this.logger.info('Worker completed', {
      workerId,
      taskId,
      duration: Date.now() - worker.startedAt,
    });

    this.workers.delete(workerId);
    this.taskToWorker.delete(taskId);
  }
}

/**
 * Test implementation
 */
export class TestWorkerPool implements WorkerPool {
  private readonly workers = new Map<WorkerId, Worker>();
  private readonly taskToWorker = new Map<TaskId, WorkerId>();
  private nextWorkerId = 1;

  async spawn(task: Task): Promise<Result<Worker>> {
    const workerId = WorkerId(`test-worker-${this.nextWorkerId++}`);
    
    const worker: Worker = {
      id: workerId,
      taskId: task.id,
      pid: 1000 + this.nextWorkerId,
      startedAt: Date.now(),
      cpuUsage: 10,
      memoryUsage: 100_000_000,
    };

    this.workers.set(workerId, worker);
    this.taskToWorker.set(task.id, workerId);

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

    this.workers.delete(workerId);
    this.taskToWorker.delete(worker.taskId);
    return ok(undefined);
  }

  async killAll(): Promise<Result<void>> {
    this.workers.clear();
    this.taskToWorker.clear();
    return ok(undefined);
  }

  getWorker(workerId: WorkerId): Result<Worker | null> {
    return ok(this.workers.get(workerId) || null);
  }

  getWorkers(): Result<readonly Worker[]> {
    return ok(Object.freeze(Array.from(this.workers.values())));
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  getWorkerForTask(taskId: TaskId): Result<Worker | null> {
    const workerId = this.taskToWorker.get(taskId);
    return ok(workerId ? this.workers.get(workerId) || null : null);
  }
}