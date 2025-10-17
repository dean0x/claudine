import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../src/bootstrap.js';
import { Container } from '../../src/core/container.js';
import { TaskManager, DependencyRepository } from '../../src/core/interfaces.js';
import { Task, TaskId, Priority } from '../../src/core/domain.js';
import { Database } from '../../src/implementations/database.js';

describe('Integration: Task Dependencies - End-to-End Flow', () => {
  let container: Container;
  let taskManager: TaskManager;
  let dependencyRepo: DependencyRepository;
  let database: Database;

  beforeEach(async () => {
    const result = await bootstrap();
    if (!result.ok) {
      throw new Error(`Bootstrap failed: ${result.error.message}`);
    }
    container = result.value;

    const tmResult = await container.resolve<TaskManager>('taskManager');
    if (!tmResult.ok) {
      throw new Error(`Failed to resolve TaskManager: ${tmResult.error.message}`);
    }
    taskManager = tmResult.value;

    const drResult = container.get<DependencyRepository>('dependencyRepository');
    if (!drResult.ok) {
      throw new Error(`Failed to get DependencyRepository: ${drResult.error.message}`);
    }
    dependencyRepo = drResult.value;

    const dbResult = container.get<Database>('database');
    if (!dbResult.ok) {
      throw new Error(`Failed to get Database: ${dbResult.error.message}`);
    }
    database = dbResult.value;
  });

  afterEach(() => {
    if (database) {
      database.close();
    }
  });

  describe('Basic Dependency Flow', () => {
    it('should block task B until task A completes', async () => {
      // Create Task A (no dependencies)
      const taskAResult = await taskManager.delegate({
        prompt: 'Task A - independent',
        priority: Priority.P2
      });

      expect(taskAResult.ok).toBe(true);
      if (!taskAResult.ok) return;

      const taskA = taskAResult.value;

      // Wait a bit for persistence
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create Task B that depends on Task A
      const taskBResult = await taskManager.delegate({
        prompt: 'Task B - depends on A',
        priority: Priority.P2,
        dependsOn: [taskA.id]
      });

      expect(taskBResult.ok).toBe(true);
      if (!taskBResult.ok) return;

      const taskB = taskBResult.value;

      // Wait for dependency to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify dependency was created
      const depsResult = await dependencyRepo.getDependencies(taskB.id);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value).toHaveLength(1);
      expect(depsResult.value[0].dependsOnTaskId).toBe(taskA.id);
      expect(depsResult.value[0].resolution).toBe('pending');

      // Verify Task B is blocked
      const isBlockedResult = await dependencyRepo.isBlocked(taskB.id);
      expect(isBlockedResult.ok).toBe(true);
      if (!isBlockedResult.ok) return;

      expect(isBlockedResult.value).toBe(true);
    });

    it('should allow task with no dependencies to execute immediately', async () => {
      const taskResult = await taskManager.delegate({
        prompt: 'Independent task',
        priority: Priority.P2
      });

      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;

      const task = taskResult.value;

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify task is not blocked
      const isBlockedResult = await dependencyRepo.isBlocked(task.id);
      expect(isBlockedResult.ok).toBe(true);
      if (!isBlockedResult.ok) return;

      expect(isBlockedResult.value).toBe(false);
    });
  });

  describe('Cycle Detection', () => {
    it('should reject circular dependencies', async () => {
      // Create Task A
      const taskAResult = await taskManager.delegate({
        prompt: 'Task A',
        priority: Priority.P2
      });

      expect(taskAResult.ok).toBe(true);
      if (!taskAResult.ok) return;

      const taskA = taskAResult.value;

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to create Task B that depends on A, then make A depend on B (cycle)
      const taskBResult = await taskManager.delegate({
        prompt: 'Task B - depends on A',
        priority: Priority.P2,
        dependsOn: [taskA.id]
      });

      expect(taskBResult.ok).toBe(true);
      if (!taskBResult.ok) return;

      const taskB = taskBResult.value;

      // Wait for dependency processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now try to add A -> B dependency (would create cycle)
      const cycleResult = await dependencyRepo.addDependency(taskA.id, taskB.id);

      // This should fail due to cycle detection
      expect(cycleResult.ok).toBe(false);
      if (cycleResult.ok) return;

      expect(cycleResult.error.message).toContain('cycle');
    });

    it('should reject self-dependencies', async () => {
      // Create Task A
      const taskAResult = await taskManager.delegate({
        prompt: 'Task A',
        priority: Priority.P2
      });

      expect(taskAResult.ok).toBe(true);
      if (!taskAResult.ok) return;

      const taskA = taskAResult.value;

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to make task depend on itself
      const selfDepResult = await dependencyRepo.addDependency(taskA.id, taskA.id);

      expect(selfDepResult.ok).toBe(false);
      // Self-dependency should be rejected
    });
  });

  describe('Multiple Dependencies', () => {
    it('should handle task with multiple dependencies', async () => {
      // Create Tasks A and B (independent)
      const taskAResult = await taskManager.delegate({
        prompt: 'Task A',
        priority: Priority.P2
      });

      const taskBResult = await taskManager.delegate({
        prompt: 'Task B',
        priority: Priority.P2
      });

      expect(taskAResult.ok).toBe(true);
      expect(taskBResult.ok).toBe(true);
      if (!taskAResult.ok || !taskBResult.ok) return;

      const taskA = taskAResult.value;
      const taskB = taskBResult.value;

      // Wait for persistence
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create Task C that depends on both A and B
      const taskCResult = await taskManager.delegate({
        prompt: 'Task C - depends on A and B',
        priority: Priority.P2,
        dependsOn: [taskA.id, taskB.id]
      });

      expect(taskCResult.ok).toBe(true);
      if (!taskCResult.ok) return;

      const taskC = taskCResult.value;

      // Wait for dependencies to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify both dependencies were created
      const depsResult = await dependencyRepo.getDependencies(taskC.id);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value).toHaveLength(2);

      const depTaskIds = depsResult.value.map(d => d.dependsOnTaskId);
      expect(depTaskIds).toContain(taskA.id);
      expect(depTaskIds).toContain(taskB.id);

      // Verify Task C is blocked
      const isBlockedResult = await dependencyRepo.isBlocked(taskC.id);
      expect(isBlockedResult.ok).toBe(true);
      if (!isBlockedResult.ok) return;

      expect(isBlockedResult.value).toBe(true);
    });
  });

  describe('Diamond Pattern', () => {
    it('should handle diamond dependency pattern', async () => {
      // Create Task D (base)
      const taskDResult = await taskManager.delegate({
        prompt: 'Task D - base',
        priority: Priority.P2
      });

      expect(taskDResult.ok).toBe(true);
      if (!taskDResult.ok) return;

      const taskD = taskDResult.value;

      await new Promise(resolve => setTimeout(resolve, 100));

      // Create Tasks B and C that both depend on D
      const taskBResult = await taskManager.delegate({
        prompt: 'Task B - depends on D',
        priority: Priority.P2,
        dependsOn: [taskD.id]
      });

      const taskCResult = await taskManager.delegate({
        prompt: 'Task C - depends on D',
        priority: Priority.P2,
        dependsOn: [taskD.id]
      });

      expect(taskBResult.ok).toBe(true);
      expect(taskCResult.ok).toBe(true);
      if (!taskBResult.ok || !taskCResult.ok) return;

      const taskB = taskBResult.value;
      const taskC = taskCResult.value;

      await new Promise(resolve => setTimeout(resolve, 100));

      // Create Task A that depends on both B and C (diamond pattern)
      const taskAResult = await taskManager.delegate({
        prompt: 'Task A - depends on B and C',
        priority: Priority.P2,
        dependsOn: [taskB.id, taskC.id]
      });

      expect(taskAResult.ok).toBe(true);
      if (!taskAResult.ok) return;

      const taskA = taskAResult.value;

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all dependencies were created
      const depsA = await dependencyRepo.getDependencies(taskA.id);
      const depsB = await dependencyRepo.getDependencies(taskB.id);
      const depsC = await dependencyRepo.getDependencies(taskC.id);

      expect(depsA.ok && depsB.ok && depsC.ok).toBe(true);
      if (!depsA.ok || !depsB.ok || !depsC.ok) return;

      expect(depsA.value).toHaveLength(2); // A depends on B, C
      expect(depsB.value).toHaveLength(1); // B depends on D
      expect(depsC.value).toHaveLength(1); // C depends on D
    });
  });

  describe('Dependency Queries', () => {
    it('should get all dependents of a task', async () => {
      // Create Task A (base)
      const taskAResult = await taskManager.delegate({
        prompt: 'Task A',
        priority: Priority.P2
      });

      expect(taskAResult.ok).toBe(true);
      if (!taskAResult.ok) return;

      const taskA = taskAResult.value;

      await new Promise(resolve => setTimeout(resolve, 100));

      // Create Tasks B and C that both depend on A
      const taskBResult = await taskManager.delegate({
        prompt: 'Task B - depends on A',
        priority: Priority.P2,
        dependsOn: [taskA.id]
      });

      const taskCResult = await taskManager.delegate({
        prompt: 'Task C - depends on A',
        priority: Priority.P2,
        dependsOn: [taskA.id]
      });

      expect(taskBResult.ok && taskCResult.ok).toBe(true);
      if (!taskBResult.ok || !taskCResult.ok) return;

      const taskB = taskBResult.value;
      const taskC = taskCResult.value;

      await new Promise(resolve => setTimeout(resolve, 100));

      // Get all dependents of Task A
      const dependentsResult = await dependencyRepo.getDependents(taskA.id);

      expect(dependentsResult.ok).toBe(true);
      if (!dependentsResult.ok) return;

      expect(dependentsResult.value).toHaveLength(2);

      const dependentTaskIds = dependentsResult.value.map(d => d.taskId);
      expect(dependentTaskIds).toContain(taskB.id);
      expect(dependentTaskIds).toContain(taskC.id);
    });
  });
});
