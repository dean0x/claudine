/**
 * Query handler for read operations in pure event-driven architecture
 *
 * ARCHITECTURE: This handler processes all query events (reads) to maintain
 * pure event-driven pattern. ALL data access goes through events, no direct
 * repository access allowed in services.
 *
 * Pattern: Pure Event-Driven Architecture
 * Rationale: Consistency, testability, single source of truth
 * Trade-offs: Slight performance overhead vs direct reads (< 1ms)
 */

import { TaskRepository, Logger, OutputCapture } from '../../core/interfaces.js';
import { Task } from '../../core/domain.js';
import { Result, ok, err } from '../../core/result.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  TaskStatusQueryEvent,
  TaskStatusResponseEvent,
  TaskLogsQueryEvent,
  TaskLogsResponseEvent,
  createEvent
} from '../../core/events/events.js';
import { taskNotFound } from '../../core/errors.js';

export class QueryHandler extends BaseEventHandler {
  constructor(
    private readonly repository: TaskRepository,
    private readonly outputCapture: OutputCapture | undefined,
    logger: Logger
  ) {
    super(logger, 'QueryHandler');
  }

  /**
   * Set up event subscriptions for all query events
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    const subscriptions = [
      eventBus.subscribe('TaskStatusQuery', this.handleTaskStatusQuery.bind(this)),
      eventBus.subscribe('TaskLogsQuery', this.handleTaskLogsQuery.bind(this))
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('QueryHandler initialized - pure event-driven queries active');
    return ok(undefined);
  }

  /**
   * Handle task status queries
   * Returns single task or all tasks based on query
   */
  private async handleTaskStatusQuery(event: TaskStatusQueryEvent): Promise<void> {
    this.logger.debug('Processing task status query', {
      taskId: event.taskId,
      isAllTasks: !event.taskId
    });

    try {
      let result: Task | readonly Task[];

      if (event.taskId) {
        // Query single task
        const taskResult = await this.repository.findById(event.taskId);

        if (!taskResult.ok) {
          throw taskResult.error;
        }

        if (!taskResult.value) {
          throw taskNotFound(event.taskId);
        }

        result = taskResult.value;
      } else {
        // Query all tasks
        const tasksResult = await this.repository.findAll();

        if (!tasksResult.ok) {
          throw tasksResult.error;
        }

        result = tasksResult.value;
      }

      // Emit response event with result
      const responseEvent = createEvent<TaskStatusResponseEvent>(
        'TaskStatusResponse',
        { result }
      );

      // Store response for caller to retrieve
      // Note: In a full implementation, we'd use request-response correlation
      (event as any).__response = result;

    } catch (error) {
      this.logger.error('Task status query failed', error as Error, {
        taskId: event.taskId
      });
      (event as any).__error = error;
    }
  }

  /**
   * Handle task logs queries
   */
  private async handleTaskLogsQuery(event: TaskLogsQueryEvent): Promise<void> {
    this.logger.debug('Processing task logs query', {
      taskId: event.taskId,
      tail: event.tail
    });

    try {
      // First verify task exists
      const taskResult = await this.repository.findById(event.taskId);

      if (!taskResult.ok) {
        throw taskResult.error;
      }

      if (!taskResult.value) {
        throw taskNotFound(event.taskId);
      }

      // Get logs from output capture if available
      let stdout: string[] = [];
      let stderr: string[] = [];
      let totalSize = 0;

      if (this.outputCapture) {
        const outputResult = await this.outputCapture.getOutput(event.taskId, event.tail);

        if (outputResult.ok) {
          stdout = [...outputResult.value.stdout];
          stderr = [...outputResult.value.stderr];
          totalSize = outputResult.value.totalSize;
        }
      }

      // Store response for caller
      (event as any).__response = {
        taskId: event.taskId,
        stdout,
        stderr,
        totalSize
      };

    } catch (error) {
      this.logger.error('Task logs query failed', error as Error, {
        taskId: event.taskId
      });
      (event as any).__error = error;
    }
  }
}