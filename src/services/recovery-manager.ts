/**
 * Recovery manager for startup task restoration
 * Handles loading tasks from database and re-queuing on startup
 */

import { TaskRepository, TaskQueue, Logger } from '../core/interfaces.js';
import { TaskStatus, isTerminalState } from '../core/domain.js';
import { Result, ok } from '../core/result.js';

export class RecoveryManager {
  constructor(
    private readonly repository: TaskRepository,
    private readonly queue: TaskQueue,
    private readonly logger: Logger
  ) {}

  /**
   * Recover tasks on startup
   * - Re-queue QUEUED tasks
   * - Mark RUNNING tasks as FAILED (crashed)
   */
  async recover(): Promise<Result<void>> {
    this.logger.info('Starting recovery process');

    // Get all non-terminal tasks
    const tasksResult = await this.repository.findAll();
    
    if (!tasksResult.ok) {
      this.logger.error('Failed to load tasks for recovery', tasksResult.error);
      return tasksResult;
    }

    const tasks = tasksResult.value;
    let queuedCount = 0;
    let failedCount = 0;

    for (const task of tasks) {
      // Skip terminal states
      if (isTerminalState(task.status)) {
        continue;
      }

      if (task.status === TaskStatus.QUEUED) {
        // Re-queue the task
        const enqueueResult = this.queue.enqueue(task);
        
        if (enqueueResult.ok) {
          queuedCount++;
          this.logger.debug('Re-queued task', { taskId: task.id });
        } else {
          this.logger.error('Failed to re-queue task', enqueueResult.error, { taskId: task.id });
        }
      } else if (task.status === TaskStatus.RUNNING) {
        // Mark as failed (crashed during execution)
        const updateResult = await this.repository.update(task.id, {
          status: TaskStatus.FAILED,
          completedAt: Date.now(),
          exitCode: -1 // Indicates crash
        });

        if (updateResult.ok) {
          failedCount++;
          this.logger.info('Marked crashed task as failed', { taskId: task.id });
        } else {
          this.logger.error('Failed to update crashed task', updateResult.error, { taskId: task.id });
        }
      }
    }

    this.logger.info('Recovery complete', {
      totalTasks: tasks.length,
      requeued: queuedCount,
      markedFailed: failedCount
    });

    return ok(undefined);
  }
}