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

    // First, cleanup old completed tasks (older than 7 days)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cleanupResult = await this.repository.cleanupOldTasks(sevenDaysMs);
    
    if (cleanupResult.ok && cleanupResult.value > 0) {
      this.logger.info('Cleaned up old completed tasks', { count: cleanupResult.value });
    }

    // Get only QUEUED and RUNNING tasks (non-terminal states that need recovery)
    const queuedResult = await this.repository.findByStatus(TaskStatus.QUEUED);
    const runningResult = await this.repository.findByStatus(TaskStatus.RUNNING);
    
    if (!queuedResult.ok) {
      this.logger.error('Failed to load queued tasks for recovery', queuedResult.error);
      return queuedResult;
    }
    
    if (!runningResult.ok) {
      this.logger.error('Failed to load running tasks for recovery', runningResult.error);
      return runningResult;
    }

    let queuedCount = 0;
    let failedCount = 0;

    // Re-queue QUEUED tasks (check for duplicates first)
    for (const task of queuedResult.value) {
      // Safety check: don't re-queue if already in queue
      if (this.queue.contains(task.id)) {
        this.logger.warn('Task already in queue, skipping re-queue', { taskId: task.id });
        continue;
      }

      const enqueueResult = this.queue.enqueue(task);
      
      if (enqueueResult.ok) {
        queuedCount++;
        this.logger.debug('Re-queued task', { taskId: task.id });
      } else {
        this.logger.error('Failed to re-queue task', enqueueResult.error, { taskId: task.id });
      }
    }

    // Mark RUNNING tasks as FAILED (crashed during execution)  
    for (const task of runningResult.value) {
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

    this.logger.info('Recovery complete', {
      queuedTasks: queuedResult.value.length,
      runningTasks: runningResult.value.length,
      requeued: queuedCount,
      markedFailed: failedCount
    });

    return ok(undefined);
  }
}