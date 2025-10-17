/**
 * Unit tests for SQLiteDependencyRepository
 * ARCHITECTURE: Tests repository operations in isolation with in-memory database
 * Pattern: Behavior-driven testing with Result pattern validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../../src/implementations/database.js';
import { SQLiteDependencyRepository } from '../../../src/implementations/dependency-repository.js';
import { TaskId } from '../../../src/core/domain.js';
import SQLite from 'better-sqlite3';

describe('SQLiteDependencyRepository - Unit Tests', () => {
  let db: Database;
  let repo: SQLiteDependencyRepository;
  let sqliteDb: SQLite.Database;

  beforeEach(() => {
    // Use in-memory database for tests - real SQLite, no file I/O
    db = new Database(':memory:');
    repo = new SQLiteDependencyRepository(db);
    sqliteDb = db.getDatabase();
  });

  afterEach(() => {
    db.close();
  });

  // Helper function to create a task in the database
  function createTask(taskId: TaskId): void {
    sqliteDb.prepare(`
      INSERT INTO tasks (id, prompt, status, priority, created_at)
      VALUES (?, ?, 'queued', 'P2', ?)
    `).run(taskId, `Prompt for ${taskId}`, Date.now());
  }

  describe('addDependency()', () => {
    it('should successfully add a dependency', async () => {
      const taskId = 'task-b' as TaskId;
      const dependsOnTaskId = 'task-a' as TaskId;

      // Create tasks first (required for foreign key constraints)
      createTask(taskId);
      createTask(dependsOnTaskId);

      const result = await repo.addDependency(taskId, dependsOnTaskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.taskId).toBe(taskId);
      expect(result.value.dependsOnTaskId).toBe(dependsOnTaskId);
      expect(result.value.resolution).toBe('pending');
      expect(result.value.createdAt).toBeGreaterThan(0);
      expect(result.value.resolvedAt).toBeNull();
    });

    it('should reject duplicate dependencies', async () => {
      const taskId = 'task-b' as TaskId;
      const dependsOnTaskId = 'task-a' as TaskId;

      // Create tasks first
      createTask(taskId);
      createTask(dependsOnTaskId);

      // Add dependency first time
      const firstResult = await repo.addDependency(taskId, dependsOnTaskId);
      expect(firstResult.ok).toBe(true);

      // Try to add same dependency again
      const duplicateResult = await repo.addDependency(taskId, dependsOnTaskId);
      expect(duplicateResult.ok).toBe(false);
      if (duplicateResult.ok) return;

      expect(duplicateResult.error.message).toContain('already exists');
    });

    it('should allow different tasks to depend on the same task', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // B depends on A

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      const result1 = await repo.addDependency(taskB, taskA);
      expect(result1.ok).toBe(true);

      // C also depends on A
      const result2 = await repo.addDependency(taskC, taskA);
      expect(result2.ok).toBe(true);

      // Verify both dependencies exist
      const dependentsResult = await repo.getDependents(taskA);
      expect(dependentsResult.ok).toBe(true);
      if (!dependentsResult.ok) return;

      expect(dependentsResult.value).toHaveLength(2);
      const dependentTaskIds = dependentsResult.value.map(d => d.taskId);
      expect(dependentTaskIds).toContain(taskB);
      expect(dependentTaskIds).toContain(taskC);
    });

    it('should allow a task to depend on multiple tasks', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // C depends on both A and B

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      const result1 = await repo.addDependency(taskC, taskA);
      const result2 = await repo.addDependency(taskC, taskB);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      // Verify both dependencies exist
      const depsResult = await repo.getDependencies(taskC);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value).toHaveLength(2);
      const depTaskIds = depsResult.value.map(d => d.dependsOnTaskId);
      expect(depTaskIds).toContain(taskA);
      expect(depTaskIds).toContain(taskB);
    });

    it('should invalidate cache after dependency changes to detect cycles', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // Create tasks first
      createTask(taskA);
      createTask(taskB);
      createTask(taskC);

      // Add A->B dependency (cache is built during cycle check)
      const result1 = await repo.addDependency(taskA, taskB);
      expect(result1.ok).toBe(true);

      // Add B->C dependency (cache should be invalidated and rebuilt)
      const result2 = await repo.addDependency(taskB, taskC);
      expect(result2.ok).toBe(true);

      // Try to add C->A dependency (would create transitive cycle: A->B->C->A)
      // This should fail because cache was invalidated and fresh graph detects cycle
      const result3 = await repo.addDependency(taskC, taskA);
      expect(result3.ok).toBe(false);
      if (result3.ok) return;

      expect(result3.error.message).toContain('cycle');
    });
  });

  describe('getDependencies()', () => {
    it('should return all dependencies for a task', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;

      // C depends on A and B

      // Create tasks first (required for foreign key constraints)
      createTask('task-c' as TaskId);
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      await repo.addDependency(taskC, taskA);
      await repo.addDependency(taskC, taskB);

      const result = await repo.getDependencies(taskC);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      const depTaskIds = result.value.map(d => d.dependsOnTaskId);
      expect(depTaskIds).toContain(taskA);
      expect(depTaskIds).toContain(taskB);
    });

    it('should return empty array for task with no dependencies', async () => {
      const taskId = 'independent-task' as TaskId;

      const result = await repo.getDependencies(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(0);
    });

    it('should return dependencies in correct format', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);

      const result = await repo.getDependencies(taskB);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const dep = result.value[0];
      expect(dep.taskId).toBe(taskB);
      expect(dep.dependsOnTaskId).toBe(taskA);
      expect(dep.resolution).toBe('pending');
      expect(dep.createdAt).toBeGreaterThan(0);
      expect(dep.resolvedAt).toBeNull();
      expect(dep.id).toBeDefined();
    });
  });

  describe('getDependents()', () => {
    it('should return all tasks that depend on a given task', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // B and C both depend on A

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskA);

      const result = await repo.getDependents(taskA);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      const dependentTaskIds = result.value.map(d => d.taskId);
      expect(dependentTaskIds).toContain(taskB);
      expect(dependentTaskIds).toContain(taskC);
    });

    it('should return empty array for task with no dependents', async () => {
      const taskId = 'leaf-task' as TaskId;

      const result = await repo.getDependents(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(0);
    });
  });

  describe('resolveDependency()', () => {
    it('should resolve dependency as completed', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);

      const result = await repo.resolveDependency(taskB, taskA, 'completed');

      expect(result.ok).toBe(true);

      // Verify resolution was persisted
      const depsResult = await repo.getDependencies(taskB);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value[0].resolution).toBe('completed');
      expect(depsResult.value[0].resolvedAt).toBeGreaterThan(0);
    });

    it('should resolve dependency as failed', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);

      const result = await repo.resolveDependency(taskB, taskA, 'failed');

      expect(result.ok).toBe(true);

      const depsResult = await repo.getDependencies(taskB);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value[0].resolution).toBe('failed');
    });

    it('should resolve dependency as cancelled', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);

      const result = await repo.resolveDependency(taskB, taskA, 'cancelled');

      expect(result.ok).toBe(true);

      const depsResult = await repo.getDependencies(taskB);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value[0].resolution).toBe('cancelled');
    });

    it('should fail when resolving non-existent dependency', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;

      // Try to resolve dependency that was never added
      const result = await repo.resolveDependency(taskB, taskA, 'completed');

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.message).toContain('not found');
    });

    it('should update resolvedAt timestamp', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);

      const beforeResolve = Date.now();
      await repo.resolveDependency(taskB, taskA, 'completed');
      const afterResolve = Date.now();

      const depsResult = await repo.getDependencies(taskB);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      const resolvedAt = depsResult.value[0].resolvedAt;
      expect(resolvedAt).not.toBeNull();
      expect(resolvedAt).toBeGreaterThanOrEqual(beforeResolve);
      expect(resolvedAt).toBeLessThanOrEqual(afterResolve);
    });
  });

  describe('getUnresolvedDependencies()', () => {
    it('should return only unresolved dependencies', async () => {
      const taskD = 'task-d' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // D depends on A, B, C

      // Create tasks first (required for foreign key constraints)
      createTask('task-d' as TaskId);
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskD, taskA);
      await repo.addDependency(taskD, taskB);
      await repo.addDependency(taskD, taskC);

      // Resolve A and B, leave C unresolved
      await repo.resolveDependency(taskD, taskA, 'completed');
      await repo.resolveDependency(taskD, taskB, 'completed');

      const result = await repo.getUnresolvedDependencies(taskD);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(1);
      expect(result.value[0].dependsOnTaskId).toBe(taskC);
      expect(result.value[0].resolution).toBe('pending');
    });

    it('should return empty array when all dependencies resolved', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.resolveDependency(taskB, taskA, 'completed');

      const result = await repo.getUnresolvedDependencies(taskB);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(0);
    });

    it('should return all dependencies when none resolved', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-c' as TaskId);
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      await repo.addDependency(taskC, taskA);
      await repo.addDependency(taskC, taskB);

      const result = await repo.getUnresolvedDependencies(taskC);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
    });
  });

  describe('isBlocked()', () => {
    it('should return true when task has unresolved dependencies', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);

      const result = await repo.isBlocked(taskB);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(true);
    });

    it('should return false when task has no dependencies', async () => {
      const taskA = 'task-a' as TaskId;

      const result = await repo.isBlocked(taskA);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(false);
    });

    it('should return false when all dependencies resolved', async () => {
      const taskB = 'task-b' as TaskId;
      const taskA = 'task-a' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-b' as TaskId);
      createTask('task-a' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.resolveDependency(taskB, taskA, 'completed');

      const result = await repo.isBlocked(taskB);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(false);
    });

    it('should return true when at least one dependency is unresolved', async () => {
      const taskD = 'task-d' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // D depends on A, B, C

      // Create tasks first (required for foreign key constraints)
      createTask('task-d' as TaskId);
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskD, taskA);
      await repo.addDependency(taskD, taskB);
      await repo.addDependency(taskD, taskC);

      // Resolve only A and B
      await repo.resolveDependency(taskD, taskA, 'completed');
      await repo.resolveDependency(taskD, taskB, 'failed');

      const result = await repo.isBlocked(taskD);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Still blocked by C
      expect(result.value).toBe(true);
    });

    it('should return false even if dependencies failed or cancelled', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-c' as TaskId);
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      await repo.addDependency(taskC, taskA);
      await repo.addDependency(taskC, taskB);

      await repo.resolveDependency(taskC, taskA, 'failed');
      await repo.resolveDependency(taskC, taskB, 'cancelled');

      const result = await repo.isBlocked(taskC);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Not blocked - resolution indicates dependencies are "done"
      expect(result.value).toBe(false);
    });
  });

  describe('findAll()', () => {
    it('should return all dependencies in the system', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;


      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskA);
      await repo.addDependency(taskC, taskB);

      const result = await repo.findAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(3);
    });

    it('should return empty array when no dependencies exist', async () => {
      const result = await repo.findAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(0);
    });

    it('should return dependencies ordered by created_at DESC', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // Add dependencies with slight delays to ensure different timestamps

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskB, taskA);
      await new Promise(resolve => setTimeout(resolve, 5));
      await repo.addDependency(taskC, taskA);
      await new Promise(resolve => setTimeout(resolve, 5));
      await repo.addDependency(taskC, taskB);

      const result = await repo.findAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Most recent dependency should be first
      expect(result.value[0].taskId).toBe(taskC);
      expect(result.value[0].dependsOnTaskId).toBe(taskB);
    });
  });

  describe('deleteDependencies()', () => {
    it('should delete all dependencies for a task (as dependent)', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;

      // C depends on A and B

      // Create tasks first (required for foreign key constraints)
      createTask('task-c' as TaskId);
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      await repo.addDependency(taskC, taskA);
      await repo.addDependency(taskC, taskB);

      const deleteResult = await repo.deleteDependencies(taskC);
      expect(deleteResult.ok).toBe(true);

      // Verify dependencies deleted
      const depsResult = await repo.getDependencies(taskC);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;

      expect(depsResult.value).toHaveLength(0);
    });

    it('should delete all dependencies for a task (as dependency)', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // B and C depend on A

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskA);

      const deleteResult = await repo.deleteDependencies(taskA);
      expect(deleteResult.ok).toBe(true);

      // Verify dependencies deleted
      const dependentsResult = await repo.getDependents(taskA);
      expect(dependentsResult.ok).toBe(true);
      if (!dependentsResult.ok) return;

      expect(dependentsResult.value).toHaveLength(0);
    });

    it('should delete all dependencies involving a task (both directions)', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // B depends on A, C depends on B

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskB);

      // Delete all dependencies involving B
      const deleteResult = await repo.deleteDependencies(taskB);
      expect(deleteResult.ok).toBe(true);

      // Verify B's dependencies deleted
      const bDepsResult = await repo.getDependencies(taskB);
      expect(bDepsResult.ok).toBe(true);
      if (!bDepsResult.ok) return;
      expect(bDepsResult.value).toHaveLength(0);

      // Verify B's dependents deleted
      const bDependentsResult = await repo.getDependents(taskB);
      expect(bDependentsResult.ok).toBe(true);
      if (!bDependentsResult.ok) return;
      expect(bDependentsResult.value).toHaveLength(0);

      // Verify other dependencies untouched (none in this case)
      const allResult = await repo.findAll();
      expect(allResult.ok).toBe(true);
      if (!allResult.ok) return;
      expect(allResult.value).toHaveLength(0);
    });

    it('should succeed even when task has no dependencies', async () => {
      const taskId = 'no-deps' as TaskId;

      const result = await repo.deleteDependencies(taskId);

      expect(result.ok).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle many dependencies for a single task', async () => {
      const taskZ = 'task-z' as TaskId;
      const dependencyCount = 50;

      // Create all tasks first
      createTask(taskZ);
      for (let i = 0; i < dependencyCount; i++) {
        createTask(`task-${i}` as TaskId);
      }

      // Add 50 dependencies
      for (let i = 0; i < dependencyCount; i++) {
        await repo.addDependency(taskZ, `task-${i}` as TaskId);
      }

      const result = await repo.getDependencies(taskZ);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(dependencyCount);
    });

    it('should handle many dependents for a single task', async () => {
      const taskA = 'task-a' as TaskId;
      const dependentCount = 50;

      // Create all tasks first
      createTask(taskA);
      for (let i = 0; i < dependentCount; i++) {
        createTask(`task-${i}` as TaskId);
      }

      // Add 50 dependents
      for (let i = 0; i < dependentCount; i++) {
        await repo.addDependency(`task-${i}` as TaskId, taskA);
      }

      const result = await repo.getDependents(taskA);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(dependentCount);
    });

    it('should maintain dependency integrity across multiple operations', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // Build complex dependency graph

      // Create tasks first (required for foreign key constraints)
      createTask('task-a' as TaskId);
      createTask('task-b' as TaskId);
      createTask('task-c' as TaskId);
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskB);

      // Resolve middle dependency
      await repo.resolveDependency(taskB, taskA, 'completed');

      // Verify B is now unblocked
      const bBlockedResult = await repo.isBlocked(taskB);
      expect(bBlockedResult.ok).toBe(true);
      if (!bBlockedResult.ok) return;
      expect(bBlockedResult.value).toBe(false);

      // Verify C is still blocked
      const cBlockedResult = await repo.isBlocked(taskC);
      expect(cBlockedResult.ok).toBe(true);
      if (!cBlockedResult.ok) return;
      expect(cBlockedResult.value).toBe(true);
    });

    it('should handle rapid concurrent operations', async () => {
      const tasks = ['a', 'b', 'c', 'd', 'e'].map(id => `task-${id}` as TaskId);

      // Create all tasks first
      for (const task of tasks) {
        createTask(task);
      }

      // Add dependencies in parallel
      const promises = [];
      for (let i = 1; i < tasks.length; i++) {
        promises.push(repo.addDependency(tasks[i], tasks[i - 1]));
      }

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every(r => r.ok)).toBe(true);

      // Verify all dependencies exist
      const allResult = await repo.findAll();
      expect(allResult.ok).toBe(true);
      if (!allResult.ok) return;
      expect(allResult.value).toHaveLength(tasks.length - 1);
    });
  });
});
