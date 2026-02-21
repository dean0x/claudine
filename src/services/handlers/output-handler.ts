/**
 * Output management event handler
 * Handles output-related events and provides task logs
 */

import { EventBus } from '../../core/events/event-bus.js';
import { LogsRequestedEvent, OutputCapturedEvent } from '../../core/events/events.js';
import { BaseEventHandler } from '../../core/events/handlers.js';
import { Logger, OutputCapture } from '../../core/interfaces.js';
import { ok, Result } from '../../core/result.js';

export class OutputHandler extends BaseEventHandler {
  constructor(
    private readonly outputCapture: OutputCapture,
    logger: Logger,
  ) {
    super(logger, 'OutputHandler');
  }

  /**
   * Set up event subscriptions
   */
  async setup(eventBus: EventBus): Promise<Result<void>> {
    const subscriptions = [
      eventBus.subscribe('LogsRequested', this.handleLogsRequested.bind(this)),
      eventBus.subscribe('OutputCaptured', this.handleOutputCaptured.bind(this)),
    ];

    // Check if any subscription failed
    for (const result of subscriptions) {
      if (!result.ok) {
        return result;
      }
    }

    this.logger.info('OutputHandler initialized');
    return ok(undefined);
  }

  /**
   * Handle logs requested - return task output
   */
  private async handleLogsRequested(event: LogsRequestedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      const result = this.outputCapture.getOutput(event.taskId, event.tail);

      if (!result.ok) {
        this.logger.error('Failed to get task output', result.error, {
          taskId: event.taskId,
        });
        return result;
      }

      this.logger.debug('Task logs retrieved', {
        taskId: event.taskId,
        stdoutLines: result.value.stdout.length,
        stderrLines: result.value.stderr.length,
        totalSize: result.value.totalSize,
        tail: event.tail,
      });

      return ok(undefined);
    });
  }

  /**
   * Handle output captured - log for debugging
   */
  private async handleOutputCaptured(event: OutputCapturedEvent): Promise<void> {
    await this.handleEvent(event, async (event) => {
      this.logger.debug('Output captured', {
        taskId: event.taskId,
        outputType: event.outputType,
        dataSize: Buffer.byteLength(event.data, 'utf8'),
      });

      return ok(undefined);
    });
  }
}
