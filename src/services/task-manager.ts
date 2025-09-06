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
  canCancel
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