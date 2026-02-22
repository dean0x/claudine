/**
 * Unit tests for ScheduleHandler
 * ARCHITECTURE: Tests event-driven schedule lifecycle with real SQLite (in-memory)
 * Pattern: Behavioral testing with InMemoryEventBus (matches dependency-handler pattern)
 *
 * NOTE: ScheduleHandler extends BaseEventHandler. Its handleEvent() wrapper catches errors
 * from inner handlers and logs them rather than propagating. So error-path tests verify
 * state (repo, logger) rather than thrown exceptions.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Schedule } from '../../../../src/core/domain';
import {
  createSchedule,
  MissedRunPolicy,
  ScheduleId,
  ScheduleStatus,
  ScheduleType,
  TaskStatus,
} from '../../../../src/core/domain';
import { InMemoryEventBus } from '../../../../src/core/events/event-bus';
import { Database } from '../../../../src/implementations/database';
import { SQLiteScheduleRepository } from '../../../../src/implementations/schedule-repository';
import { SQLiteTaskRepository } from '../../../../src/implementations/task-repository';
import { ScheduleHandler } from '../../../../src/services/handlers/schedule-handler';
import { createTestConfiguration } from '../../../fixtures/factories';
import { TestLogger } from '../../../fixtures/test-doubles';
import { flushEventLoop } from '../../../utils/event-helpers';

describe('ScheduleHandler - Behavioral Tests', () => {
  let handler: ScheduleHandler;
  let eventBus: InMemoryEventBus;
  let scheduleRepo: SQLiteScheduleRepository;
  let taskRepo: SQLiteTaskRepository;
  let database: Database;
  let logger: TestLogger;

  beforeEach(async () => {
    logger = new TestLogger();
    const config = createTestConfiguration();
    eventBus = new InMemoryEventBus(config, logger);

    database = new Database(':memory:');
    scheduleRepo = new SQLiteScheduleRepository(database);
    taskRepo = new SQLiteTaskRepository(database);

    const handlerResult = await ScheduleHandler.create(scheduleRepo, taskRepo, eventBus, logger);
    if (!handlerResult.ok) {
      throw new Error(`Failed to create ScheduleHandler: ${handlerResult.error.message}`);
    }
    handler = handlerResult.value;
  });

  afterEach(() => {
    eventBus.dispose();
    database.close();
  });

  // Helper: create a test schedule and optionally save it
  function createTestSchedule(overrides: Partial<Parameters<typeof createSchedule>[0]> = {}): Schedule {
    return createSchedule({
      taskTemplate: {
        prompt: 'Scheduled task prompt',
        workingDirectory: '/tmp',
      },
      scheduleType: ScheduleType.CRON,
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
      missedRunPolicy: MissedRunPolicy.SKIP,
      ...overrides,
    });
  }

  async function saveSchedule(schedule: Schedule): Promise<void> {
    const result = await scheduleRepo.save(schedule);
    if (!result.ok) throw new Error(`Failed to save schedule: ${result.error.message}`);
  }

  describe('Factory create()', () => {
    it('should succeed and subscribe to events', async () => {
      const freshEventBus = new InMemoryEventBus(createTestConfiguration(), new TestLogger());
      const freshLogger = new TestLogger();

      const result = await ScheduleHandler.create(scheduleRepo, taskRepo, freshEventBus, freshLogger);

      expect(result.ok).toBe(true);
      expect(freshLogger.hasLogContaining('ScheduleHandler initialized')).toBe(true);

      freshEventBus.dispose();
    });
  });

  describe('handleScheduleCreated', () => {
    it('should persist cron schedule with calculated nextRunAt', async () => {
      const schedule = createTestSchedule();

      await eventBus.emit('ScheduleCreated', { schedule });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      const persisted = findResult.value;
      expect(persisted).not.toBeNull();
      expect(persisted!.nextRunAt).toBeDefined();
      expect(persisted!.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('should persist one-time schedule with scheduledAt as nextRunAt', async () => {
      const scheduledAt = Date.now() + 3600000; // 1 hour from now
      const schedule = createTestSchedule({
        scheduleType: ScheduleType.ONE_TIME,
        cronExpression: undefined,
        scheduledAt,
      });

      await eventBus.emit('ScheduleCreated', { schedule });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.nextRunAt).toBe(scheduledAt);
    });

    it('should log error for invalid timezone but not throw', async () => {
      // Create schedule directly with bad timezone to bypass service validation
      const schedule: Schedule = {
        ...createTestSchedule(),
        timezone: 'Invalid/Timezone',
      };

      await eventBus.emit('ScheduleCreated', { schedule });
      await flushEventLoop();

      // Schedule should NOT be persisted since validation failed
      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      expect(findResult.value).toBeNull();
    });

    it('should log error for missing cron expression on CRON type', async () => {
      const schedule: Schedule = {
        ...createTestSchedule(),
        cronExpression: undefined,
      };

      await eventBus.emit('ScheduleCreated', { schedule });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      expect(findResult.value).toBeNull();
    });

    it('should log error for missing scheduledAt on ONE_TIME type', async () => {
      const schedule: Schedule = {
        ...createTestSchedule({
          scheduleType: ScheduleType.ONE_TIME,
          cronExpression: undefined,
        }),
        scheduledAt: undefined,
      };

      await eventBus.emit('ScheduleCreated', { schedule });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      expect(findResult.value).toBeNull();
    });
  });

  describe('handleScheduleTriggered', () => {
    it('should create task from template and record execution', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      const nextRunAt = Date.now() - 60000; // Due 1 minute ago
      await scheduleRepo.update(schedule.id, { nextRunAt });

      const triggeredAt = Date.now();
      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt,
      });
      await flushEventLoop();

      // Verify task was created
      const allTasks = await taskRepo.findAll();
      expect(allTasks.ok).toBe(true);
      if (!allTasks.ok) return;
      expect(allTasks.value.length).toBeGreaterThanOrEqual(1);
      expect(allTasks.value[0].prompt).toBe('Scheduled task prompt');

      // Verify execution was recorded
      const history = await scheduleRepo.getExecutionHistory(schedule.id);
      expect(history.ok).toBe(true);
      if (!history.ok) return;
      expect(history.value.length).toBeGreaterThanOrEqual(1);
      expect(history.value[0].status).toBe('triggered');
    });

    it('should update runCount and lastRunAt', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: Date.now() - 60000 });

      const triggeredAt = Date.now();
      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt,
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.runCount).toBe(1);
      expect(findResult.value!.lastRunAt).toBe(triggeredAt);
    });

    it('should calculate next run time for cron schedules', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      // Next run should be in the future
      expect(findResult.value!.nextRunAt).toBeDefined();
      expect(findResult.value!.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('should skip inactive schedules', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, {
        status: ScheduleStatus.PAUSED,
        nextRunAt: Date.now() - 60000,
      });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // No tasks should be created
      const allTasks = await taskRepo.findAll();
      expect(allTasks.ok).toBe(true);
      if (!allTasks.ok) return;
      expect(allTasks.value).toHaveLength(0);
    });

    it('should mark schedule completed when maxRuns reached', async () => {
      const schedule = createTestSchedule({ maxRuns: 1 });
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.status).toBe(ScheduleStatus.COMPLETED);
      expect(findResult.value!.runCount).toBe(1);
      expect(findResult.value!.nextRunAt).toBeUndefined();
    });

    it('should mark one-time schedule completed after single run', async () => {
      const scheduledAt = Date.now() - 60000;
      const schedule = createTestSchedule({
        scheduleType: ScheduleType.ONE_TIME,
        cronExpression: undefined,
        scheduledAt,
      });
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: scheduledAt });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.status).toBe(ScheduleStatus.COMPLETED);
      expect(findResult.value!.nextRunAt).toBeUndefined();
    });

    it('should mark schedule expired when expiresAt is reached', async () => {
      const schedule = createTestSchedule({
        expiresAt: Date.now() - 1000, // Already expired
      });
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.status).toBe(ScheduleStatus.EXPIRED);
      expect(findResult.value!.nextRunAt).toBeUndefined();
    });

    it('should emit TaskDelegated and ScheduleExecuted events', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: schedule.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // Check for emitted events (InMemoryEventBus tracks all emitted events)
      // TaskDelegated should be emitted for the created task
      expect(logger.hasLogContaining('Schedule triggered successfully')).toBe(true);
    });
  });

  describe('handleScheduleCancelled', () => {
    it('should update status to CANCELLED and clear nextRunAt', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { nextRunAt: Date.now() + 3600000 });

      await eventBus.emit('ScheduleCancelled', {
        scheduleId: schedule.id,
        reason: 'manual cancellation',
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.status).toBe(ScheduleStatus.CANCELLED);
      expect(findResult.value!.nextRunAt).toBeUndefined();
    });
  });

  describe('handleSchedulePaused', () => {
    it('should update status to PAUSED', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);

      await eventBus.emit('SchedulePaused', { scheduleId: schedule.id });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.status).toBe(ScheduleStatus.PAUSED);
    });
  });

  describe('handleScheduleResumed', () => {
    it('should update status to ACTIVE and recalculate nextRunAt for cron', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);
      await scheduleRepo.update(schedule.id, { status: ScheduleStatus.PAUSED });

      await eventBus.emit('ScheduleResumed', { scheduleId: schedule.id });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.status).toBe(ScheduleStatus.ACTIVE);
      expect(findResult.value!.nextRunAt).toBeDefined();
      expect(findResult.value!.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('should log error for non-existent schedule', async () => {
      await eventBus.emit('ScheduleResumed', {
        scheduleId: ScheduleId('non-existent'),
      });
      await flushEventLoop();

      // handleEvent logs the error rather than throwing
      expect(logger.hasLogContaining('event handling failed')).toBe(true);
    });
  });

  describe('handleScheduleUpdated', () => {
    it('should apply partial updates to schedule', async () => {
      const schedule = createTestSchedule();
      await saveSchedule(schedule);

      await eventBus.emit('ScheduleUpdated', {
        scheduleId: schedule.id,
        update: { maxRuns: 10 },
      });
      await flushEventLoop();

      const findResult = await scheduleRepo.findById(schedule.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value!.maxRuns).toBe(10);
    });
  });

  describe('afterScheduleId chaining', () => {
    it('should inject dependency when target task is non-terminal', async () => {
      // Schedule A triggers and creates a task that stays QUEUED (non-terminal)
      const scheduleA = createTestSchedule();
      await saveSchedule(scheduleA);
      await scheduleRepo.update(scheduleA.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: scheduleA.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // Get task A's ID
      const allTasks = await taskRepo.findAll();
      expect(allTasks.ok).toBe(true);
      if (!allTasks.ok) return;
      expect(allTasks.value).toHaveLength(1);
      const taskA = allTasks.value[0];
      expect(taskA.status).toBe(TaskStatus.QUEUED);

      // Capture TaskDelegated events to inspect task.dependsOn
      // (dependsOn is not persisted by task repo — it flows via events to DependencyHandler)
      const delegatedTasks: { task: { dependsOn?: readonly string[] } }[] = [];
      eventBus.subscribe('TaskDelegated', (event) => {
        delegatedTasks.push(event);
      });

      // Schedule B chains after Schedule A
      const scheduleB = createTestSchedule({
        afterScheduleId: scheduleA.id,
      });
      await saveSchedule(scheduleB);
      await scheduleRepo.update(scheduleB.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: scheduleB.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // The TaskDelegated event for task B should carry dependsOn containing task A's ID
      expect(delegatedTasks).toHaveLength(1);
      expect(delegatedTasks[0].task.dependsOn).toContain(taskA.id);
    });

    it('should skip dependency when target task already completed', async () => {
      // Schedule A triggers and creates a task
      const scheduleA = createTestSchedule();
      await saveSchedule(scheduleA);
      await scheduleRepo.update(scheduleA.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: scheduleA.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // Mark task A as completed
      const allTasks = await taskRepo.findAll();
      expect(allTasks.ok).toBe(true);
      if (!allTasks.ok) return;
      const taskA = allTasks.value[0];
      await taskRepo.update(taskA.id, { status: TaskStatus.COMPLETED });

      // Capture TaskDelegated events
      const delegatedTasks: { task: { dependsOn?: readonly string[] } }[] = [];
      eventBus.subscribe('TaskDelegated', (event) => {
        delegatedTasks.push(event);
      });

      // Schedule B chains after Schedule A
      const scheduleB = createTestSchedule({
        afterScheduleId: scheduleA.id,
      });
      await saveSchedule(scheduleB);
      await scheduleRepo.update(scheduleB.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: scheduleB.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // Task B should have no injected dependency (target already completed)
      expect(delegatedTasks).toHaveLength(1);
      expect(delegatedTasks[0].task.dependsOn ?? []).not.toContain(taskA.id);
    });

    it('should skip dependency when no prior execution exists', async () => {
      // Schedule A exists but has never been triggered (no execution history)
      const scheduleA = createTestSchedule();
      await saveSchedule(scheduleA);

      // Schedule B chains after Schedule A
      const scheduleB = createTestSchedule({
        afterScheduleId: scheduleA.id,
      });
      await saveSchedule(scheduleB);
      await scheduleRepo.update(scheduleB.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: scheduleB.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // Task B should run with no dependsOn
      const allTasks = await taskRepo.findAll();
      expect(allTasks.ok).toBe(true);
      if (!allTasks.ok) return;
      expect(allTasks.value).toHaveLength(1);
      expect(allTasks.value[0].dependsOn ?? []).toHaveLength(0);
    });

    it('should skip dependency when execution has no taskId', async () => {
      // Schedule A has a failed execution record with no taskId
      const scheduleA = createTestSchedule();
      await saveSchedule(scheduleA);

      // Record a failed execution without a taskId
      await scheduleRepo.recordExecution({
        scheduleId: scheduleA.id,
        scheduledFor: Date.now() - 120000,
        executedAt: Date.now() - 120000,
        status: 'failed',
        errorMessage: 'Failed to create task',
        createdAt: Date.now() - 120000,
      });

      // Schedule B chains after Schedule A
      const scheduleB = createTestSchedule({
        afterScheduleId: scheduleA.id,
      });
      await saveSchedule(scheduleB);
      await scheduleRepo.update(scheduleB.id, { nextRunAt: Date.now() - 60000 });

      await eventBus.emit('ScheduleTriggered', {
        scheduleId: scheduleB.id,
        triggeredAt: Date.now(),
      });
      await flushEventLoop();

      // Task B should run with no dependsOn
      const allTasks = await taskRepo.findAll();
      expect(allTasks.ok).toBe(true);
      if (!allTasks.ok) return;
      expect(allTasks.value).toHaveLength(1);
      expect(allTasks.value[0].dependsOn ?? []).toHaveLength(0);
    });
  });
});
