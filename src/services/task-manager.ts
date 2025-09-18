/**
 * Event-driven task manager orchestrator
 * Coordinates components through events, eliminating race conditions and state divergence
 */

import { 
  TaskManager, 
  TaskRepository,
  Logger,
  EventBus,
  OutputCapture
} from '../core/interfaces.js';
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
    private readonly repository: TaskRepository | undefined,
    private readonly logger: Logger,
    private readonly config: Configuration,
    private readonly outputCapture?: OutputCapture
  ) {}

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
    // Database-only approach - no memory cache to manage
    if (!this.repository) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        'TaskRepository not available'
      ));
    }

    if (taskId) {
      const result = await this.repository.findById(taskId);
      
      if (!result.ok) {
        return result;
      }
      
      if (!result.value) {
        return err(taskNotFound(taskId));
      }
      
      return ok(result.value);
    }

    // Return all tasks from database
    const result = await this.repository.findAll();
    return result.ok ? ok(result.value) : err(result.error);
  }

  async getLogs(taskId: TaskId, tail?: number): Promise<Result<TaskOutput>> {
    // Verify task exists first if repository is available
    if (this.repository) {
      const taskResult = await this.repository.findById(taskId);
      
      if (!taskResult.ok) {
        return err(taskResult.error);
      }
      
      if (!taskResult.value) {
        return err(taskNotFound(taskId));
      }
    }

    // Get logs directly from output capture if available
    if (this.outputCapture) {
      return this.outputCapture.getOutput(taskId, tail);
    }

    // Fallback: emit event to request logs
    await this.eventBus.emit('LogsRequested', { taskId, tail });
    
    // Return empty logs as fallback
    return ok({
      taskId,
      stdout: [],
      stderr: [],
      totalSize: 0,
    });
  }

  async cancel(taskId: TaskId, reason?: string): Promise<Result<void>> {
    // Verify task exists and can be cancelled if repository is available
    if (this.repository) {
      const taskResult = await this.repository.findById(taskId);

      if (!taskResult.ok) {
        return err(taskResult.error);
      }

      if (!taskResult.value) {
        return err(taskNotFound(taskId));
      }

      const task = taskResult.value;

      if (!canCancel(task)) {
        return err(new ClaudineError(
          ErrorCode.TASK_CANNOT_CANCEL,
          `Task ${taskId} cannot be cancelled in state ${task.status}`
        ));
      }
    }

    this.logger.info('Cancelling task', { taskId, reason });

    // Emit event - handlers will manage the cancellation process
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
    // Verify task exists and is in a terminal state
    if (!this.repository) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        'TaskRepository not available'
      ));
    }

    const taskResult = await this.repository.findById(taskId);

    if (!taskResult.ok) {
      return err(taskResult.error);
    }

    if (!taskResult.value) {
      return err(taskNotFound(taskId));
    }

    const originalTask = taskResult.value;

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