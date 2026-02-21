/**
 * Worktree handler for git worktree operations in pure event-driven architecture
 *
 * ARCHITECTURE: This handler completes the event-driven refactor for worktree management.
 * ALL worktree operations now go through events, maintaining consistency with the rest
 * of the system.
 *
 * Pattern: Pure Event-Driven Architecture
 * Rationale: Consistency with rest of system, testability, extensibility
 * Trade-offs: Slight overhead vs direct calls (< 1ms)
 */

import { WorktreeManager, Logger } from '../../core/interfaces.js';
import { WorktreeStatus } from '../../core/interfaces.js';
import { TaskId } from '../../core/domain.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus, InMemoryEventBus } from '../../core/events/event-bus.js';
import {
  WorktreeListQueryEvent,
  WorktreeStatusQueryEvent,
  WorktreeCleanupRequestedEvent,
} from '../../core/events/events.js';
import { ClaudineError, ErrorCode } from '../../core/errors.js';

/**
 * Result type for worktree cleanup operations
 */
export interface WorktreeCleanupResult {
  removed: number;
  skipped: number;
  errors: Array<{ taskId: string; error: string }>;
}

export class WorktreeHandler extends BaseEventHandler {
  constructor(
    private readonly worktreeManager: WorktreeManager,
    private readonly eventBus: EventBus,
    logger: Logger,
  ) {
    super(logger, 'WorktreeHandler');
  }

  /**
   * Set up event subscriptions for all worktree events
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    const subscriptions = [
      eventBus.subscribe('WorktreeListQuery', this.handleWorktreeListQuery.bind(this)),
      eventBus.subscribe('WorktreeStatusQuery', this.handleWorktreeStatusQuery.bind(this)),
      eventBus.subscribe('WorktreeCleanupRequested', this.handleWorktreeCleanupRequested.bind(this)),
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('WorktreeHandler initialized - event-driven worktree operations active');
    return ok(undefined);
  }

  /**
   * Handle worktree list queries
   * Returns filtered list of worktree statuses based on query parameters
   * ARCHITECTURE: Uses Result pattern instead of throwing
   */
  private async handleWorktreeListQuery(event: WorktreeListQueryEvent & { __correlationId?: string }): Promise<void> {
    const correlationId = event.__correlationId;

    this.logger.debug('Processing worktree list query', {
      includeStale: event.includeStale,
      olderThanDays: event.olderThanDays,
      correlationId,
    });

    // Get all worktree statuses
    const statusesResult = await this.worktreeManager.getWorktreeStatuses();

    if (!statusesResult.ok) {
      this.logger.error('Worktree list query failed', statusesResult.error, {
        correlationId,
      });

      if (correlationId && 'respondError' in this.eventBus) {
        (this.eventBus as InMemoryEventBus).respondError(correlationId, statusesResult.error);
      }
      return;
    }

    let statuses = statusesResult.value;

    // Filter based on includeStale and olderThanDays
    if (!event.includeStale) {
      statuses = statuses.filter((s) => s.exists && s.safeToRemove === false);
    }

    if (event.olderThanDays !== undefined) {
      statuses = statuses.filter((s) => s.ageInDays >= event.olderThanDays!);
    }

    // Send response back via event bus
    if (correlationId && 'respond' in this.eventBus) {
      (this.eventBus as InMemoryEventBus).respond(correlationId, statuses);
    }

    this.logger.debug('Worktree list query completed', {
      totalWorktrees: statuses.length,
      correlationId,
    });
  }

  /**
   * Handle worktree status query for specific task
   * ARCHITECTURE: Uses Result pattern instead of throwing
   */
  private async handleWorktreeStatusQuery(
    event: WorktreeStatusQueryEvent & { __correlationId?: string },
  ): Promise<void> {
    const correlationId = event.__correlationId;

    this.logger.debug('Processing worktree status query', {
      taskId: event.taskId,
      correlationId,
    });

    const statusResult = await this.worktreeManager.getWorktreeStatus(event.taskId);

    if (!statusResult.ok) {
      this.logger.error('Worktree status query failed', statusResult.error, {
        taskId: event.taskId,
        correlationId,
      });

      if (correlationId && 'respondError' in this.eventBus) {
        (this.eventBus as InMemoryEventBus).respondError(correlationId, statusResult.error);
      }
      return;
    }

    // Send response back via event bus
    if (correlationId && 'respond' in this.eventBus) {
      (this.eventBus as InMemoryEventBus).respond(correlationId, statusResult.value);
    }

    this.logger.debug('Worktree status query completed', {
      taskId: event.taskId,
      correlationId,
    });
  }

  /**
   * Handle worktree cleanup requests
   * ARCHITECTURE: Uses Result pattern instead of throwing
   *
   * Strategies:
   * - 'safe': Only remove worktrees marked as safeToRemove
   * - 'interactive': Not implemented (returns error)
   * - 'force': Remove all worktrees regardless of safety status
   */
  private async handleWorktreeCleanupRequested(
    event: WorktreeCleanupRequestedEvent & { __correlationId?: string },
  ): Promise<void> {
    const correlationId = event.__correlationId;
    const strategy = event.strategy ?? 'safe';

    this.logger.info('Processing worktree cleanup request', {
      strategy,
      olderThanDays: event.olderThanDays,
      taskIds: event.taskIds,
      correlationId,
    });

    // Interactive mode not supported in event-driven architecture
    if (strategy === 'interactive') {
      const error = new ClaudineError(
        ErrorCode.INVALID_OPERATION,
        'Interactive cleanup strategy not supported in event-driven mode. Use "safe" or "force".',
      );

      this.logger.error('Worktree cleanup failed', error, { correlationId });

      if (correlationId && 'respondError' in this.eventBus) {
        (this.eventBus as InMemoryEventBus).respondError(correlationId, error);
      }
      return;
    }

    // OPTIMIZATION: Fetch all worktrees once to avoid N queries and race conditions
    const statusesResult = await this.worktreeManager.getWorktreeStatuses();

    if (!statusesResult.ok) {
      this.logger.error('Failed to get worktree statuses for cleanup', statusesResult.error, {
        correlationId,
      });

      if (correlationId && 'respondError' in this.eventBus) {
        (this.eventBus as InMemoryEventBus).respondError(correlationId, statusesResult.error);
      }
      return;
    }

    const allWorktrees = statusesResult.value;
    let worktreesToClean: WorktreeStatus[] = allWorktrees;

    // Filter by specific task IDs if provided
    if (event.taskIds && event.taskIds.length > 0) {
      // Convert TaskId[] to Set<string> for efficient lookup
      const taskIdsSet = new Set(event.taskIds.map((id) => id as string));
      worktreesToClean = allWorktrees.filter((w) => taskIdsSet.has(w.taskId));

      // Log any requested taskIds that were not found
      for (const taskId of event.taskIds) {
        if (!worktreesToClean.some((w) => w.taskId === (taskId as string))) {
          this.logger.warn('Worktree for requested taskId not found during cleanup', {
            taskId,
            correlationId,
          });
        }
      }
    }

    // Filter by age if specified
    if (event.olderThanDays !== undefined) {
      worktreesToClean = worktreesToClean.filter((w) => w.ageInDays >= event.olderThanDays!);
    }

    // Filter by safety unless force mode
    if (strategy === 'safe') {
      worktreesToClean = worktreesToClean.filter((w) => w.safeToRemove);
    }

    // Remove worktrees
    // NOTE: "skipped" means worktrees not selected for cleanup (filtered out)
    // This is calculated BEFORE attempting removal
    const result: WorktreeCleanupResult = {
      removed: 0,
      skipped: allWorktrees.length - worktreesToClean.length,
      errors: [],
    };

    for (const worktree of worktreesToClean) {
      const removeResult = await this.worktreeManager.removeWorktree(TaskId(worktree.taskId), strategy === 'force');

      if (removeResult.ok) {
        result.removed++;
        this.logger.debug('Removed worktree', { taskId: worktree.taskId, path: worktree.path });
      } else {
        result.errors.push({
          taskId: worktree.taskId,
          error: removeResult.error.message,
        });
        this.logger.warn('Failed to remove worktree', {
          taskId: worktree.taskId,
          error: removeResult.error.message,
        });
      }
    }

    // Send response back via event bus
    if (correlationId && 'respond' in this.eventBus) {
      (this.eventBus as InMemoryEventBus).respond(correlationId, result);
    }

    this.logger.info('Worktree cleanup completed', {
      removed: result.removed,
      skipped: result.skipped,
      errors: result.errors.length,
      correlationId,
    });
  }
}
