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
  EventBus,
  OutputCapture
} from '../core/interfaces.js';
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
    private readonly repository: TaskRepository | undefined, // DEPRECATED: Will be removed in v3.0
    private readonly logger: Logger,
    private readonly config: Configuration,
    private readonly outputCapture?: OutputCapture // DEPRECATED: Will be removed in v3.0
  ) {
    // ARCHITECTURE: Repository is passed for backwards compatibility only
    // All new code MUST use event-driven patterns via eventBus
    if (repository) {
      this.logger.warn('TaskManager initialized with direct repository - migration to pure events pending');
    }
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
    const result = await this.eventBus.request<TaskStatusQueryEvent, Task | readonly Task[]>(
      'TaskStatusQuery',
      { taskId }
    );

    if (!result.ok) {
      this.logger.error('Task status query failed', result.error, { taskId });
      return result;
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
    const taskResult = await this.eventBus.request<TaskStatusQueryEvent, Task>('TaskStatusQuery', { taskId });

    if (!taskResult.ok) {
      return err(taskResult.error);
    }

    const originalTask = taskResult.value as Task;

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

  listTasks(): Result<readonly Task[]> {
    // DEPRECATED: This method is deprecated due to synchronous interface incompatibility
    // Use getStatus() without taskId parameter for async task listing
    this.logger.warn(
      'listTasks() is deprecated and returns empty array. ' +
      'Use getStatus() without taskId parameter for proper async task listing.'
    );
    return ok([]);
  }

}