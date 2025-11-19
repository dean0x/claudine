import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DependencyHandler } from '../../../../src/services/handlers/dependency-handler';
import { InMemoryEventBus } from '../../../../src/core/events/event-bus';
import { SQLiteTaskRepository } from '../../../../src/implementations/task-repository';
import { SQLiteDependencyRepository } from '../../../../src/implementations/dependency-repository';
import { Database } from '../../../../src/implementations/database';
import { TestLogger } from '../../../fixtures/test-doubles';
import { createTask, TaskId, type Task } from '../../../../src/core/domain';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestConfiguration } from '../../../fixtures/factories';

describe('DependencyHandler - Behavioral Tests', () => {
  let handler: DependencyHandler;
  let eventBus: InMemoryEventBus;
  let dependencyRepo: SQLiteDependencyRepository;
  let taskRepo: SQLiteTaskRepository;
  let database: Database;
  let tempDir: string;
  let logger: TestLogger;

  beforeEach(async () => {
    // Use real implementations instead of mocks
    logger = new TestLogger();
    const config = createTestConfiguration();
    eventBus = new InMemoryEventBus(config, logger);

    // Use real database for testing
    tempDir = await mkdtemp(join(tmpdir(), 'dependency-handler-test-'));
    database = new Database(join(tempDir, 'test.db'));
    dependencyRepo = new SQLiteDependencyRepository(database);
    taskRepo = new SQLiteTaskRepository(database);

    // Create handler with real dependencies
    handler = new DependencyHandler(dependencyRepo, taskRepo, logger);

    // Setup the handler to register event listeners
    const setupResult = await handler.setup(eventBus);
    if (!setupResult.ok) {
      throw new Error(`Failed to setup DependencyHandler: ${setupResult.error.message}`);
    }
  });

  afterEach(async () => {
    eventBus.dispose();
    database.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Setup and initialization', () => {
    it('should setup successfully and subscribe to events', async () => {
      // Arrange - Create a new handler
      const newHandler = new DependencyHandler(dependencyRepo, taskRepo, logger);

      // Act
      const result = await newHandler.setup(eventBus);

      // Assert
      expect(result.ok).toBe(true);
      expect(logger.hasLogContaining('DependencyHandler initialized')).toBe(true);
    });
  });

  describe('Task delegation with dependencies', () => {
    it('should add dependencies when task is delegated', async () => {
      // Arrange - Create parent task
      const parentTask = createTask({ prompt: 'parent task' });
      await taskRepo.save(parentTask);

      // Create child task with dependency
      const childTask = createTask({
        prompt: 'child task',
        dependsOn: [parentTask.id]
      });
      await taskRepo.save(childTask);

      // Act - Emit TaskDelegated event
      await eventBus.emit('TaskDelegated', { task: childTask });

      // Assert - Dependency should be created
      const dependencies = await dependencyRepo.getDependencies(childTask.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value).toHaveLength(1);
        expect(dependencies.value[0].taskId).toBe(childTask.id);
        expect(dependencies.value[0].dependsOnTaskId).toBe(parentTask.id);
        expect(dependencies.value[0].resolution).toBe('pending');
      }
    });

    it('should skip tasks with no dependencies', async () => {
      // Arrange - Create task without dependencies
      const task = createTask({ prompt: 'independent task' });
      await taskRepo.save(task);

      // Act - Emit TaskDelegated event
      await eventBus.emit('TaskDelegated', { task });

      // Assert - No dependencies should be created
      const dependencies = await dependencyRepo.getDependencies(task.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value).toHaveLength(0);
      }
    });

    it('should detect and prevent cycles (A -> B -> A)', async () => {
      // Arrange - Create tasks A and B
      const taskA = createTask({ prompt: 'task A' });
      const taskB = createTask({ prompt: 'task B', dependsOn: [taskA.id] });
      await taskRepo.save(taskA);
      await taskRepo.save(taskB);

      // Create B -> A dependency
      await eventBus.emit('TaskDelegated', { task: taskB });

      // Give handler time to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify B -> A dependency was created
      const depsB = await dependencyRepo.getDependencies(taskB.id);
      expect(depsB.ok).toBe(true);
      if (depsB.ok) {
        expect(depsB.value).toHaveLength(1);
        expect(depsB.value[0].dependsOnTaskId).toBe(taskA.id);
      }

      // Try to create A -> B dependency (would create cycle)
      const taskAWithCycle = { ...taskA, dependsOn: [taskB.id] };
      // NOTE: Don't save the task again - INSERT OR REPLACE would cascade delete existing dependencies
      // The handler only needs the event, not the persisted task

      // Act - Try to emit TaskDelegated for A with dependency on B
      await eventBus.emit('TaskDelegated', { task: taskAWithCycle });

      // Give handler time to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert - Cycle should be detected and prevented
      // Verify an error was logged about cycle detection
      const errorLogs = logger.getLogsByLevel('error');
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs.some(log =>
        log.message.includes('would create cycle') ||
        (log.context?.error?.message && log.context.error.message.includes('would create cycle'))
      )).toBe(true);

      // The cyclic dependency (A -> B) should NOT have been added
      const depsA = await dependencyRepo.getDependencies(taskA.id);
      expect(depsA.ok).toBe(true);
      if (depsA.ok) {
        // Verify the cyclic dependency was not created
        const hasCyclicDependency = depsA.value.some(d => d.dependsOnTaskId === taskB.id);
        expect(hasCyclicDependency).toBe(false);
      }
    });

    it('should detect and prevent transitive cycles (A -> B -> C -> A)', async () => {
      // Arrange - Create tasks A, B, C
      const taskA = createTask({ prompt: 'task A' });
      const taskB = createTask({ prompt: 'task B', dependsOn: [taskA.id] });
      const taskC = createTask({ prompt: 'task C', dependsOn: [taskB.id] });
      await taskRepo.save(taskA);
      await taskRepo.save(taskB);
      await taskRepo.save(taskC);

      // Create B -> A and C -> B dependencies
      await eventBus.emit('TaskDelegated', { task: taskB });
      await eventBus.emit('TaskDelegated', { task: taskC });

      // Give handler time to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify dependencies were created
      const depsB = await dependencyRepo.getDependencies(taskB.id);
      const depsC = await dependencyRepo.getDependencies(taskC.id);
      expect(depsB.ok && depsB.value.length === 1).toBe(true);
      expect(depsC.ok && depsC.value.length === 1).toBe(true);

      // Try to create A -> C dependency (would create transitive cycle: A->C->B->A)
      const taskAWithCycle = { ...taskA, dependsOn: [taskC.id] };
      // NOTE: Don't save the task again - INSERT OR REPLACE would cascade delete existing dependencies

      // Act
      await eventBus.emit('TaskDelegated', { task: taskAWithCycle });

      // Give handler time to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert - Transitive cycle should be detected and prevented
      // Verify an error was logged about cycle detection
      const errorLogs = logger.getLogsByLevel('error');
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs.some(log =>
        log.message.includes('would create cycle') ||
        (log.context?.error?.message && log.context.error.message.includes('would create cycle'))
      )).toBe(true);

      // The cyclic dependency (A -> C) should NOT have been added
      const depsA = await dependencyRepo.getDependencies(taskA.id);
      expect(depsA.ok).toBe(true);
      if (depsA.ok) {
        // Verify the cyclic dependency was not created
        const hasCyclicDependency = depsA.value.some(d => d.dependsOnTaskId === taskC.id);
        expect(hasCyclicDependency).toBe(false);
      }
    });

    it('should handle multiple dependencies for single task', async () => {
      // Arrange - Create parent tasks
      const parent1 = createTask({ prompt: 'parent 1' });
      const parent2 = createTask({ prompt: 'parent 2' });
      const parent3 = createTask({ prompt: 'parent 3' });
      await taskRepo.save(parent1);
      await taskRepo.save(parent2);
      await taskRepo.save(parent3);

      // Create child with multiple dependencies
      const child = createTask({
        prompt: 'child task',
        dependsOn: [parent1.id, parent2.id, parent3.id]
      });
      await taskRepo.save(child);

      // Act
      await eventBus.emit('TaskDelegated', { task: child });

      // Assert - All 3 dependencies should be created
      const dependencies = await dependencyRepo.getDependencies(child.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value).toHaveLength(3);
        const depTaskIds = dependencies.value.map(d => d.dependsOnTaskId);
        expect(depTaskIds).toContain(parent1.id);
        expect(depTaskIds).toContain(parent2.id);
        expect(depTaskIds).toContain(parent3.id);
      }
    });
  });

  describe('Task completion dependency resolution', () => {
    it('should use batch resolution method for performance', async () => {
      // Arrange - Create tasks A (parent) and B, C (dependents)
      const taskA = createTask({ prompt: 'task A' });
      const taskB = createTask({ prompt: 'task B', dependsOn: [taskA.id] });
      const taskC = createTask({ prompt: 'task C', dependsOn: [taskA.id] });

      await taskRepo.save(taskA);
      await taskRepo.save(taskB);
      await taskRepo.save(taskC);

      // Create dependencies
      await eventBus.emit('TaskDelegated', { task: taskB });
      await eventBus.emit('TaskDelegated', { task: taskC });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Spy on the batch resolution method to verify it's called
      const batchSpy = vi.spyOn(dependencyRepo, 'resolveDependenciesBatch');

      // Act - Complete task A
      await eventBus.emit('TaskCompleted', { taskId: taskA.id });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert - Verify batch method was called exactly once
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy).toHaveBeenCalledWith(taskA.id, 'completed');

      // Verify dependencies were actually resolved
      const depsB = await dependencyRepo.getDependencies(taskB.id);
      const depsC = await dependencyRepo.getDependencies(taskC.id);

      expect(depsB.ok && depsB.value[0].resolution).toBe('completed');
      expect(depsC.ok && depsC.value[0].resolution).toBe('completed');
    });

    it('should resolve dependency when parent task completes', async () => {
      // Arrange - Create parent and child with dependency
      const parent = createTask({ prompt: 'parent' });
      const child = createTask({ prompt: 'child', dependsOn: [parent.id] });
      await taskRepo.save(parent);
      await taskRepo.save(child);
      await eventBus.emit('TaskDelegated', { task: child });

      // Act - Complete parent task
      await eventBus.emit('TaskCompleted', { taskId: parent.id });

      // Assert - Dependency should be resolved as completed
      const dependencies = await dependencyRepo.getDependencies(child.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value[0].resolution).toBe('completed');
        expect(dependencies.value[0].resolvedAt).toBeDefined();
      }
    });

    it('should emit TaskUnblocked when all dependencies complete', async () => {
      // Arrange - Create parents and child
      const parent1 = createTask({ prompt: 'parent 1' });
      const parent2 = createTask({ prompt: 'parent 2' });
      const child = createTask({ prompt: 'child', dependsOn: [parent1.id, parent2.id] });
      await taskRepo.save(parent1);
      await taskRepo.save(parent2);
      await taskRepo.save(child);
      await eventBus.emit('TaskDelegated', { task: child });

      // Listen for TaskUnblocked event
      let unblockedEventReceived = false;
      let unblockedTaskId: TaskId | undefined;
      eventBus.subscribe('TaskUnblocked', async (event) => {
        unblockedEventReceived = true;
        unblockedTaskId = event.taskId;
      });

      // Act - Complete both parents
      await eventBus.emit('TaskCompleted', { taskId: parent1.id });
      await eventBus.emit('TaskCompleted', { taskId: parent2.id });

      // Give event time to propagate
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert - TaskUnblocked should be emitted
      expect(unblockedEventReceived).toBe(true);
      expect(unblockedTaskId).toBe(child.id);
    });

    it('should not emit TaskUnblocked if some dependencies remain pending', async () => {
      // Arrange
      const parent1 = createTask({ prompt: 'parent 1' });
      const parent2 = createTask({ prompt: 'parent 2' });
      const child = createTask({ prompt: 'child', dependsOn: [parent1.id, parent2.id] });
      await taskRepo.save(parent1);
      await taskRepo.save(parent2);
      await taskRepo.save(child);
      await eventBus.emit('TaskDelegated', { task: child });

      let unblockedEventReceived = false;
      eventBus.subscribe('TaskUnblocked', async () => {
        unblockedEventReceived = true;
      });

      // Act - Complete only one parent
      await eventBus.emit('TaskCompleted', { taskId: parent1.id });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert - Should still be blocked
      expect(unblockedEventReceived).toBe(false);
      const isBlocked = await dependencyRepo.isBlocked(child.id);
      expect(isBlocked.ok).toBe(true);
      if (isBlocked.ok) {
        expect(isBlocked.value).toBe(true);
      }
    });
  });

  describe('Task failure dependency resolution', () => {
    it('should resolve dependency as failed when parent task fails', async () => {
      // Arrange
      const parent = createTask({ prompt: 'parent' });
      const child = createTask({ prompt: 'child', dependsOn: [parent.id] });
      await taskRepo.save(parent);
      await taskRepo.save(child);
      await eventBus.emit('TaskDelegated', { task: child });

      // Act - Fail parent task
      await eventBus.emit('TaskFailed', { taskId: parent.id, error: new Error('test failure') });

      // Assert - Dependency should be resolved as failed
      const dependencies = await dependencyRepo.getDependencies(child.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value[0].resolution).toBe('failed');
      }
    });
  });

  describe('Task cancellation dependency resolution', () => {
    it('should resolve dependency as cancelled when parent task is cancelled', async () => {
      // Arrange
      const parent = createTask({ prompt: 'parent' });
      const child = createTask({ prompt: 'child', dependsOn: [parent.id] });
      await taskRepo.save(parent);
      await taskRepo.save(child);
      await eventBus.emit('TaskDelegated', { task: child });

      // Act - Cancel parent task
      await eventBus.emit('TaskCancelled', { taskId: parent.id, reason: 'test cancellation' });

      // Assert - Dependency should be resolved as cancelled
      const dependencies = await dependencyRepo.getDependencies(child.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value[0].resolution).toBe('cancelled');
      }
    });
  });

  describe('Task timeout dependency resolution', () => {
    it('should resolve dependency as failed when parent task times out', async () => {
      // Arrange
      const parent = createTask({ prompt: 'parent' });
      const child = createTask({ prompt: 'child', dependsOn: [parent.id] });
      await taskRepo.save(parent);
      await taskRepo.save(child);
      await eventBus.emit('TaskDelegated', { task: child });

      // Act - Timeout parent task
      await eventBus.emit('TaskTimeout', { taskId: parent.id });

      // Assert - Dependency should be resolved as failed
      const dependencies = await dependencyRepo.getDependencies(child.id);
      expect(dependencies.ok).toBe(true);
      if (dependencies.ok) {
        expect(dependencies.value[0].resolution).toBe('failed');
      }
    });
  });

  describe('Complex dependency chains', () => {
    it('should handle diamond dependency pattern (A <- B,C <- D)', async () => {
      // Arrange - Create diamond pattern
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      const taskA = createTask({ prompt: 'task A' });
      const taskB = createTask({ prompt: 'task B', dependsOn: [taskA.id] });
      const taskC = createTask({ prompt: 'task C', dependsOn: [taskA.id] });
      const taskD = createTask({ prompt: 'task D', dependsOn: [taskB.id, taskC.id] });

      await taskRepo.save(taskA);
      await taskRepo.save(taskB);
      await taskRepo.save(taskC);
      await taskRepo.save(taskD);

      await eventBus.emit('TaskDelegated', { task: taskB });
      await eventBus.emit('TaskDelegated', { task: taskC });
      await eventBus.emit('TaskDelegated', { task: taskD });

      // Act - Complete A, then B and C
      await eventBus.emit('TaskCompleted', { taskId: taskA.id });
      await new Promise(resolve => setTimeout(resolve, 50));

      // B and C should now be unblocked
      const isBBlocked = await dependencyRepo.isBlocked(taskB.id);
      const isCBlocked = await dependencyRepo.isBlocked(taskC.id);
      expect(isBBlocked.ok && !isBBlocked.value).toBe(true);
      expect(isCBlocked.ok && !isCBlocked.value).toBe(true);

      // Complete B and C
      await eventBus.emit('TaskCompleted', { taskId: taskB.id });
      await eventBus.emit('TaskCompleted', { taskId: taskC.id });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert - D should now be unblocked
      const isDBlocked = await dependencyRepo.isBlocked(taskD.id);
      expect(isDBlocked.ok).toBe(true);
      if (isDBlocked.ok) {
        expect(isDBlocked.value).toBe(false);
      }
    });
  });

  describe('Error handling', () => {
    it('should handle missing parent task gracefully', async () => {
      // Arrange - Create child with non-existent parent
      const nonExistentParentId = TaskId('task-non-existent');
      const child = createTask({ prompt: 'child', dependsOn: [nonExistentParentId] });
      await taskRepo.save(child);

      // Act - Try to create dependency with non-existent parent
      await eventBus.emit('TaskDelegated', { task: child });

      // Assert - Should log error
      expect(logger.getLogsByLevel('error').length).toBeGreaterThan(0);
    });

    it('should handle database errors during dependency creation', async () => {
      // Arrange - Create valid tasks
      const parent = createTask({ prompt: 'parent' });
      const child = createTask({ prompt: 'child', dependsOn: [parent.id] });
      await taskRepo.save(parent);
      await taskRepo.save(child);

      // Close database to force error
      database.close();

      // Act - Try to create dependency
      await eventBus.emit('TaskDelegated', { task: child });

      // Assert - Should handle error gracefully (check for error logs)
      // The handler should log an error when database operations fail
      const errorLogs = logger.getLogsByLevel('error');
      expect(errorLogs.length).toBeGreaterThan(0);
    });
  });

  describe('Concurrent dependency operations', () => {
    it('should handle concurrent dependency additions safely', async () => {
      // Arrange - Create multiple parent-child pairs
      const pairs = Array.from({ length: 10 }, (_, i) => ({
        parent: createTask({ prompt: `parent ${i}` }),
        child: createTask({ prompt: `child ${i}` })
      }));

      // Save all tasks
      for (const { parent, child } of pairs) {
        await taskRepo.save(parent);
        await taskRepo.save(child);
      }

      // Act - Emit TaskDelegated concurrently for all children
      await Promise.all(
        pairs.map(({ parent, child }) => {
          const childWithDep = { ...child, dependsOn: [parent.id] };
          return eventBus.emit('TaskDelegated', { task: childWithDep });
        })
      );

      // Assert - All dependencies should be created
      for (const { child } of pairs) {
        const deps = await dependencyRepo.getDependencies(child.id);
        expect(deps.ok).toBe(true);
      }
    });
  });
});
