/**
 * Event-driven task manager orchestrator
 *
 * ARCHITECTURE: Pure event-driven pattern - ALL operations go through EventBus
 * Pattern: Event-Driven Architecture with Request-Response for queries
 * Rationale: Single source of truth, consistency, testability, extensibility
 * Trade-offs: ~1ms overhead for queries vs direct repository access
 *
 * Rules:
 * - NO direct repository access (all data operations via events)
 * - Commands use fire-and-forget emit()
 * - Queries use request-response request()
 * - All state changes MUST go through events
 */

import {
  TaskManager,
  TaskRepository,
  Logger,
  OutputCapture
} from '../core/interfaces.js';
import { EventBus } from '../core/events/event-bus.js';
import { TaskStatusQueryEvent, TaskLogsQueryEvent } from '../core/events/events.js';
import {
  Task,
  TaskId,
  DelegateRequest,
  TaskOutput,
  createTask,
  canCancel,
  isTerminalState
} from '../core/domain.js';
import { Result, ok, err } from '../core/result.js';
import { taskNotFound, ClaudineError, ErrorCode } from '../core/errors.js';
import { Configuration } from '../core/configuration.js';

export class TaskManagerService implements TaskManager {
  constructor(
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    private readonly config: Configuration
  ) {
    // ARCHITECTURE: Pure event-driven - ALL operations go through EventBus
    this.logger.debug('TaskManager initialized with pure event-driven architecture');
  }

  /**
   * Delegate a task - purely event-driven, no direct state management
   */

  async delegate(request: DelegateRequest): Promise<Result<Task>> {
    // Apply configuration defaults to request
    const requestWithDefaults: DelegateRequest = {
      ...request,
      timeout: request.timeout ?? this.config.timeout,
      maxOutputBuffer: request.maxOutputBuffer ?? this.config.maxOutputBuffer,
      // Apply worktree default from configuration (default: false)
      useWorktree: request.useWorktree ?? this.config.useWorktreesByDefault,
    };

    // Create task using pure function with defaults applied
    const task = createTask(requestWithDefaults);
    
    this.logger.info('Delegating task', {
      taskId: task.id,
      priority: task.priority,
      prompt: task.prompt.substring(0, 100),
    });

    // Emit event - all state management happens in event handlers
    const result = await this.eventBus.emit('TaskDelegated', { task });
    
    if (!result.ok) {
      this.logger.error('Task delegation failed', result.error, {
        taskId: task.id
      });
      return err(result.error);
    }

    return ok(task);
  }

  async getStatus(taskId?: TaskId): Promise<Result<Task | readonly Task[]>> {
    // ARCHITECTURE: Pure event-driven query - no direct repository access
    // FIXED: QueryHandler returns Task | null for single task, readonly Task[] for all tasks
    const result = await this.eventBus.request<TaskStatusQueryEvent, Task | null | readonly Task[]>(
      'TaskStatusQuery',
      { taskId }
    );

    if (!result.ok) {
      this.logger.error('Task status query failed', result.error, { taskId });
      return result;
    }

    // Handle null case when specific task not found
    if (result.value === null) {
      return err(taskNotFound(taskId!));
    }

    return ok(result.value);
  }

  async getLogs(taskId: TaskId, tail?: number): Promise<Result<TaskOutput>> {
    // ARCHITECTURE: Pure event-driven query for logs
    const result = await this.eventBus.request<TaskLogsQueryEvent, TaskOutput>(
      'TaskLogsQuery',
      { taskId, tail }
    );

    if (!result.ok) {
      this.logger.error('Task logs query failed', result.error, { taskId });
      return result;
    }

    return ok(result.value);
  }

  async cancel(taskId: TaskId, reason?: string): Promise<Result<void>> {
    // ARCHITECTURE: Validation now happens in event handler, not here
    // This maintains pure event-driven pattern
    this.logger.info('Cancelling task', { taskId, reason });

    // Emit cancellation event - handler will validate and process
    const result = await this.eventBus.emit('TaskCancellationRequested', { taskId, reason });

    if (!result.ok) {
      this.logger.error('Task cancellation failed', result.error, { taskId });
      return err(result.error);
    }

    return ok(undefined);
  }

  /**
   * Retry a failed or completed task by creating a new task with the same configuration
   *
   * Creates a completely new task to avoid side effects from partially executed
   * Claude Code operations (file changes, commits, etc.). The new task maintains
   * a link to the original via retry tracking fields.
   *
   * RETRY CHAIN BEHAVIOR:
   * - Each retry creates a NEW task with a unique ID
   * - parentTaskId: Points to the root task of the retry chain
   * - retryOf: Points to the immediate parent being retried
   * - retryCount: Increments with each retry in the chain
   *
   * Example retry chain:
   * 1. Original task: task-A (parentTaskId: null, retryCount: 0, retryOf: null)
   * 2. First retry: task-B (parentTaskId: task-A, retryCount: 1, retryOf: task-A)
   * 3. Second retry: task-C (parentTaskId: task-A, retryCount: 2, retryOf: task-B)
   *
   * This allows tracking the full retry history while maintaining a reference
   * to the original task request.
   *
   * @param taskId - ID of the task to retry (must be in terminal state)
   * @returns New task with retry tracking, or error if task cannot be retried
   *
   * @example
   * // CLI usage: claudine retry-task abc-123
   * // Creates new task def-456 with:
   * // - parentTaskId: abc-123 (or original if abc-123 is already a retry)
   * // - retryCount: 1 (or incremented from abc-123's count)
   * // - retryOf: abc-123 (direct parent)
   */
  async retry(taskId: TaskId): Promise<Result<Task>> {
    // ARCHITECTURE: Use event-driven query to get task
    // FIXED: QueryHandler now returns Task | null for not-found tasks
    const taskResult = await this.eventBus.request<TaskStatusQueryEvent, Task | null>('TaskStatusQuery', { taskId });

    if (!taskResult.ok) {
      return err(taskResult.error);
    }

    // FIXED: Check for null task (not found)
    if (taskResult.value === null) {
      return err(taskNotFound(taskId));
    }

    const originalTask = taskResult.value; // Now safely Task, not null

    // Only retry tasks that are in terminal states
    if (!isTerminalState(originalTask.status)) {
      return err(new ClaudineError(
        ErrorCode.INVALID_OPERATION,
        `Task ${taskId} cannot be retried in state ${originalTask.status}`
      ));
    }

    this.logger.info('Retrying task', {
      taskId,
      status: originalTask.status,
      prompt: originalTask.prompt.substring(0, 100),
    });

    // Find the root parent task ID (for tracking all retries in a chain)
    const parentTaskId = originalTask.parentTaskId || taskId;
    const retryCount = (originalTask.retryCount || 0) + 1;

    // Create the retry request with all the original task's configuration
    const retryRequest: DelegateRequest = {
      prompt: originalTask.prompt,
      priority: originalTask.priority,
      workingDirectory: originalTask.workingDirectory,
      useWorktree: originalTask.useWorktree,
      worktreeCleanup: originalTask.worktreeCleanup,
      mergeStrategy: originalTask.mergeStrategy,
      branchName: originalTask.branchName,
      baseBranch: originalTask.baseBranch,
      autoCommit: originalTask.autoCommit,
      pushToRemote: originalTask.pushToRemote,
      prTitle: originalTask.prTitle,
      prBody: originalTask.prBody,
      timeout: originalTask.timeout,
      maxOutputBuffer: originalTask.maxOutputBuffer,
      // Add retry tracking
      parentTaskId: TaskId(parentTaskId),
      retryCount,
      retryOf: taskId,
    };

    // Create the new retry task
    const newTask = createTask(retryRequest);

    this.logger.info('Creating retry task', {
      originalTaskId: taskId,
      newTaskId: newTask.id,
      retryCount,
      parentTaskId,
    });

    // Emit TaskDelegated event for the new retry task
    const result = await this.eventBus.emit('TaskDelegated', { task: newTask });

    if (!result.ok) {
      this.logger.error('Failed to delegate retry task', result.error, {
        originalTaskId: taskId,
        newTaskId: newTask.id,
      });
      return err(result.error);
    }

    return ok(newTask);
  }

  // ARCHITECTURE: Worktree management methods not yet implemented
  // TODO: These will be event-driven once WorktreeHandler is implemented
  // For now, delegate to WorktreeManager directly (not event-driven yet)

  async listWorktrees(includeStale = false, olderThanDays?: number): Promise<Result<readonly any[]>> {
    return err(new ClaudineError(
      ErrorCode.INVALID_OPERATION,
      'Worktree management not yet implemented in event-driven architecture. Use GitWorktreeManager directly if needed.'
    ));
  }

  async getWorktreeStatus(taskId: TaskId): Promise<Result<any>> {
    return err(new ClaudineError(
      ErrorCode.INVALID_OPERATION,
      'Worktree management not yet implemented in event-driven architecture. Use GitWorktreeManager directly if needed.'
    ));
  }

  async cleanupWorktrees(
    strategy = 'safe' as const,
    olderThanDays = 7,
    taskIds?: TaskId[]
  ): Promise<Result<any>> {
    return err(new ClaudineError(
      ErrorCode.INVALID_OPERATION,
      'Worktree management not yet implemented in event-driven architecture. Use GitWorktreeManager directly if needed.'
    ));
  }

}