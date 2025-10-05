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
import { EventBus, InMemoryEventBus } from '../../core/events/event-bus.js';
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
    private readonly eventBus: EventBus,
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
   * ARCHITECTURE: Uses Result pattern instead of throwing
   */
  private async handleTaskStatusQuery(event: TaskStatusQueryEvent & { __correlationId?: string }): Promise<void> {
    const correlationId = event.__correlationId;

    this.logger.debug('Processing task status query', {
      taskId: event.taskId,
      isAllTasks: !event.taskId,
      correlationId
    });

    let queryResult: Result<Task | readonly Task[] | null>;

    if (event.taskId) {
      // Query single task
      const taskResult = await this.repository.findById(event.taskId);

      if (!taskResult.ok) {
        queryResult = taskResult;
      } else {
        // Return null for not-found instead of throwing
        // This provides graceful handling for non-existent tasks
        queryResult = ok(taskResult.value);
      }
    } else {
      // Query all tasks
      const tasksResult = await this.repository.findAll();

      if (!tasksResult.ok) {
        queryResult = tasksResult;
      } else {
        queryResult = ok(tasksResult.value);
      }
    }

    // Send response or error back via event bus
    if (correlationId && 'respond' in this.eventBus) {
      if (queryResult.ok) {
        (this.eventBus as InMemoryEventBus).respond(correlationId, queryResult.value);
      } else {
        this.logger.error('Task status query failed', queryResult.error, {
          taskId: event.taskId,
          correlationId
        });
        (this.eventBus as InMemoryEventBus).respondError(correlationId, queryResult.error);
      }
    }
  }

  /**
   * Handle task logs queries
   * ARCHITECTURE: Uses Result pattern instead of throwing
   */
  private async handleTaskLogsQuery(event: TaskLogsQueryEvent & { __correlationId?: string }): Promise<void> {
    const correlationId = event.__correlationId;

    this.logger.debug('Processing task logs query', {
      taskId: event.taskId,
      tail: event.tail,
      correlationId
    });

    // First verify task exists
    const taskResult = await this.repository.findById(event.taskId);

    if (!taskResult.ok) {
      this.logger.error('Task logs query failed - repository error', taskResult.error, {
        taskId: event.taskId,
        correlationId
      });

      if (correlationId && 'respondError' in this.eventBus) {
        (this.eventBus as InMemoryEventBus).respondError(correlationId, taskResult.error);
      }
      return;
    }

    if (!taskResult.value) {
      const notFoundError = taskNotFound(event.taskId);
      this.logger.error('Task logs query failed - task not found', notFoundError, {
        taskId: event.taskId,
        correlationId
      });

      if (correlationId && 'respondError' in this.eventBus) {
        (this.eventBus as InMemoryEventBus).respondError(correlationId, notFoundError);
      }
      return;
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

    const response = {
      taskId: event.taskId,
      stdout,
      stderr,
      totalSize
    };

    // Send response back via event bus
    if (correlationId && 'respond' in this.eventBus) {
      (this.eventBus as InMemoryEventBus).respond(correlationId, response);
    }
  }
}