/**
 * Schedule executor service - timer-based scheduler tick loop
 * ARCHITECTURE: Periodically checks for due schedules and triggers execution
 * Pattern: Timer service with start/stop lifecycle, handles missed runs
 * Rationale: Decoupled from ScheduleHandler for testability and separation of concerns
 */

import { EventBus } from '../core/events/event-bus.js';
import { ScheduleRepository } from '../core/interfaces.js';
import { Logger } from '../core/interfaces.js';
import { Result, ok, err } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import {
  Schedule,
  ScheduleId,
  ScheduleStatus,
  ScheduleType,
  MissedRunPolicy,
} from '../core/domain.js';
import { getNextRunTime } from '../utils/cron.js';

/**
 * Configuration options for ScheduleExecutor
 */
export interface ScheduleExecutorOptions {
  /** Check interval in milliseconds. Default: 60000 (60 seconds) */
  readonly checkIntervalMs?: number;
  /** Grace period for missed runs in milliseconds. Default: 300000 (5 minutes) */
  readonly missedRunGracePeriodMs?: number;
}

/**
 * ScheduleExecutor - Timer-based service that checks for due schedules
 *
 * ARCHITECTURE:
 * - Uses setInterval with .unref() to not block process exit
 * - Checks every 60 seconds (configurable) for due schedules
 * - Emits ScheduleTriggered events for ScheduleHandler to process
 * - Handles missed run policies (skip, catchup, fail)
 */
export class ScheduleExecutor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly checkIntervalMs: number;
  private readonly missedRunGracePeriodMs: number;

  /** Default check interval: 60 seconds */
  private static readonly DEFAULT_CHECK_INTERVAL_MS = 60_000;

  /** Default grace period before considering a run "missed": 5 minutes */
  private static readonly DEFAULT_MISSED_RUN_GRACE_PERIOD_MS = 300_000;

  constructor(
    private readonly scheduleRepo: ScheduleRepository,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    options?: ScheduleExecutorOptions
  ) {
    this.checkIntervalMs = options?.checkIntervalMs ?? ScheduleExecutor.DEFAULT_CHECK_INTERVAL_MS;
    this.missedRunGracePeriodMs = options?.missedRunGracePeriodMs ?? ScheduleExecutor.DEFAULT_MISSED_RUN_GRACE_PERIOD_MS;
  }

  /**
   * Start the scheduler tick loop
   *
   * @returns Result<void> - Error if already running
   */
  start(): Result<void, ClaudineError> {
    if (this.isRunning) {
      return err(new ClaudineError(
        ErrorCode.INVALID_OPERATION,
        'ScheduleExecutor is already running'
      ));
    }

    this.isRunning = true;
    this.timer = setInterval(
      () => void this.tick(),
      this.checkIntervalMs
    );

    // Don't block process exit - timer will be cleaned up naturally
    this.timer.unref();

    this.logger.info('ScheduleExecutor started', {
      intervalMs: this.checkIntervalMs,
      missedRunGracePeriodMs: this.missedRunGracePeriodMs
    });

    // Run initial tick immediately
    void this.tick();

    return ok(undefined);
  }

  /**
   * Stop the scheduler
   *
   * @returns Result<void> - Always succeeds
   */
  stop(): Result<void, ClaudineError> {
    if (!this.isRunning) {
      return ok(undefined);
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;

    this.logger.info('ScheduleExecutor stopped');
    return ok(undefined);
  }

  /**
   * Check if executor is currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Single scheduler tick - check and execute due schedules
   *
   * ARCHITECTURE: This runs every checkIntervalMs (default 60s)
   * Finds all active schedules where nextRunAt <= now
   * Processes each due schedule with missed run handling
   */
  private async tick(): Promise<void> {
    const now = Date.now();
    this.logger.debug('Scheduler tick', {
      now,
      nowDate: new Date(now).toISOString()
    });

    try {
      // Find schedules due for execution
      const dueResult = await this.scheduleRepo.findDue(now);
      if (!dueResult.ok) {
        this.logger.error('Failed to find due schedules', dueResult.error);
        return;
      }

      const dueSchedules = dueResult.value;
      if (dueSchedules.length === 0) {
        this.logger.debug('No due schedules found');
        return;
      }

      this.logger.info('Found due schedules', {
        count: dueSchedules.length,
        scheduleIds: dueSchedules.map(s => s.id)
      });

      // Process each due schedule
      for (const schedule of dueSchedules) {
        await this.executeSchedule(schedule, now);
      }
    } catch (error) {
      this.logger.error('Scheduler tick failed', error as Error);
    }
  }

  /**
   * Execute a single due schedule
   *
   * Determines if the run was missed (based on grace period) and applies
   * the appropriate missed run policy.
   */
  private async executeSchedule(schedule: Schedule, now: number): Promise<void> {
    try {
      // Calculate how late we are
      const scheduledTime = schedule.nextRunAt ?? now;
      const delayMs = now - scheduledTime;
      const isMissed = delayMs > this.missedRunGracePeriodMs;

      if (isMissed) {
        await this.handleMissedRun(schedule, now);
        return;
      }

      // Normal execution - emit trigger event
      // ScheduleHandler will create the task and update the schedule
      await this.eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: now,
      });

      this.logger.info('Schedule triggered', {
        scheduleId: schedule.id,
        scheduledFor: scheduledTime,
        actualTime: now,
        delayMs,
        type: schedule.scheduleType
      });
    } catch (error) {
      this.logger.error('Failed to execute schedule', error as Error, {
        scheduleId: schedule.id
      });
    }
  }

  /**
   * Handle missed run based on policy
   *
   * Policies:
   * - SKIP: Calculate next run time, don't execute the missed run
   * - CATCHUP: Execute the missed run immediately (one time only)
   * - FAIL: Mark the schedule as cancelled/failed
   */
  private async handleMissedRun(schedule: Schedule, now: number): Promise<void> {
    const missedAt = schedule.nextRunAt ?? now;

    this.logger.warn('Missed schedule run', {
      scheduleId: schedule.id,
      policy: schedule.missedRunPolicy,
      scheduledFor: missedAt,
      scheduledForDate: new Date(missedAt).toISOString(),
      currentTime: now,
      delayMs: now - missedAt,
      gracePeriodMs: this.missedRunGracePeriodMs
    });

    switch (schedule.missedRunPolicy) {
      case MissedRunPolicy.SKIP:
        // Skip this run, calculate next run time
        await this.eventBus.emit('ScheduleMissed', {
          scheduleId: schedule.id,
          missedAt,
          policy: MissedRunPolicy.SKIP,
        });

        // Update nextRunAt to skip this run
        await this.updateNextRun(schedule);

        this.logger.info('Skipped missed schedule run', { scheduleId: schedule.id });
        break;

      case MissedRunPolicy.CATCHUP:
        // Execute the missed run immediately (catch up)
        await this.eventBus.emit('ScheduleTriggered', {
          scheduleId: schedule.id,
          triggeredAt: now,
        });

        this.logger.info('Catching up missed schedule run', { scheduleId: schedule.id });
        break;

      case MissedRunPolicy.FAIL:
        // Mark schedule as cancelled due to missed run
        await this.scheduleRepo.update(schedule.id, {
          status: ScheduleStatus.CANCELLED,
          nextRunAt: undefined,
        });

        await this.eventBus.emit('ScheduleMissed', {
          scheduleId: schedule.id,
          missedAt,
          policy: MissedRunPolicy.FAIL,
        });

        // Record failed execution
        await this.scheduleRepo.recordExecution({
          scheduleId: schedule.id,
          scheduledFor: missedAt,
          status: 'missed',
          errorMessage: `Schedule missed by ${now - missedAt}ms, policy: FAIL`,
          createdAt: now,
        });

        this.logger.info('Schedule failed due to missed run', { scheduleId: schedule.id });
        break;
    }
  }

  /**
   * Calculate and update next run time for a schedule
   *
   * For CRON schedules: Calculate next occurrence from now
   * For ONE_TIME schedules: Mark as completed (they don't repeat)
   */
  private async updateNextRun(schedule: Schedule): Promise<void> {
    if (schedule.scheduleType === ScheduleType.ONE_TIME) {
      // One-time schedules don't repeat - mark as completed
      await this.scheduleRepo.update(schedule.id, {
        status: ScheduleStatus.COMPLETED,
        nextRunAt: undefined,
      });

      this.logger.info('One-time schedule completed', { scheduleId: schedule.id });
      return;
    }

    // Calculate next cron run from now
    if (schedule.cronExpression) {
      const nextResult = getNextRunTime(
        schedule.cronExpression,
        schedule.timezone,
        new Date()
      );

      if (nextResult.ok) {
        await this.scheduleRepo.update(schedule.id, {
          nextRunAt: nextResult.value,
        });

        this.logger.debug('Updated nextRunAt for schedule', {
          scheduleId: schedule.id,
          nextRunAt: nextResult.value,
          nextRunAtDate: new Date(nextResult.value).toISOString()
        });
      } else {
        this.logger.error('Failed to calculate next run time', nextResult.error, {
          scheduleId: schedule.id,
          cronExpression: schedule.cronExpression
        });
      }
    }
  }

  /**
   * Manually trigger a tick (useful for testing)
   * ARCHITECTURE: Exposed for testing, normally called by internal timer
   */
  async triggerTick(): Promise<void> {
    await this.tick();
  }
}
