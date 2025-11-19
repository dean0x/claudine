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

    it('should reject adding dependency when task already has 100 dependencies', async () => {
      const taskZ = 'task-z' as TaskId;

      // Create task and 100 dependencies
      createTask(taskZ);
      for (let i = 0; i < 100; i++) {
        const depId = `task-${i}` as TaskId;
        createTask(depId);
      }

      // Add 100 dependencies (at the limit)
      for (let i = 0; i < 100; i++) {
        const result = await repo.addDependency(taskZ, `task-${i}` as TaskId);
        expect(result.ok).toBe(true);
      }

      // Try to add 101st dependency (should fail)
      const task101 = 'task-101' as TaskId;
      createTask(task101);

      const result = await repo.addDependency(taskZ, task101);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('exceed maximum of 100');
      expect(result.error.message).toContain('currently has 100');

      // Verify only 100 dependencies exist
      const depsResult = await repo.getDependencies(taskZ);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;
      expect(depsResult.value).toHaveLength(100);
    });

    it('should reject adding dependency when chain depth exceeds 100', async () => {
      // Create a chain of 100 tasks: task-0 -> task-1 -> ... -> task-99 -> task-100
      for (let i = 0; i <= 100; i++) {
        createTask(`task-${i}` as TaskId);
      }

      // Build chain: task-0 -> task-1 -> task-2 -> ... -> task-100
      for (let i = 0; i < 100; i++) {
        const result = await repo.addDependency(`task-${i}` as TaskId, `task-${i + 1}` as TaskId);
        expect(result.ok).toBe(true);
      }

      // Now task-0 has depth 100 (task-0 -> task-1 -> ... -> task-100)
      // Try to add new-task -> task-0, which would create depth 101
      const newTask = 'new-task' as TaskId;
      createTask(newTask);

      const result = await repo.addDependency(newTask, 'task-0' as TaskId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('chain depth');
      expect(result.error.message).toContain('maximum 100');
    });
  });

  describe('addDependencies() - Atomic Batch Operations', () => {
    it('should successfully add multiple dependencies atomically', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;

      // Create tasks first
      createTask(taskC);
      createTask(taskA);
      createTask(taskB);

      // Add multiple dependencies in one atomic operation
      const result = await repo.addDependencies(taskC, [taskA, taskB]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      expect(result.value[0].taskId).toBe(taskC);
      expect(result.value[1].taskId).toBe(taskC);

      const depIds = result.value.map(d => d.dependsOnTaskId);
      expect(depIds).toContain(taskA);
      expect(depIds).toContain(taskB);

      // Verify all dependencies were persisted
      const depsResult = await repo.getDependencies(taskC);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;
      expect(depsResult.value).toHaveLength(2);
    });

    it('should rollback all dependencies on cycle detection failure', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      // Create tasks first
      createTask(taskA);
      createTask(taskB);
      createTask(taskC);

      // Set up: A -> B (existing dependency)
      await repo.addDependency(taskA, taskB);

      // Try to add B -> [C, A] atomically
      // This should fail because B -> A would create cycle (A -> B -> A)
      const result = await repo.addDependencies(taskB, [taskC, taskA]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('cycle');

      // CRITICAL: Verify B -> C was NOT persisted (rollback worked)
      const bDepsResult = await repo.getDependencies(taskB);
      expect(bDepsResult.ok).toBe(true);
      if (!bDepsResult.ok) return;
      expect(bDepsResult.value).toHaveLength(0);

      // Verify no partial state in database
      const allDeps = await repo.findAll();
      expect(allDeps.ok).toBe(true);
      if (!allDeps.ok) return;
      // Should only have the original A -> B dependency
      expect(allDeps.value).toHaveLength(1);
      expect(allDeps.value[0].taskId).toBe(taskA);
      expect(allDeps.value[0].dependsOnTaskId).toBe(taskB);
    });

    it('should rollback all dependencies on duplicate detection', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;

      // Create tasks first
      createTask(taskC);
      createTask(taskA);
      createTask(taskB);

      // Set up: C already depends on A
      await repo.addDependency(taskC, taskA);

      // Try to add C -> [A, B] atomically
      // This should fail because C -> A already exists
      const result = await repo.addDependencies(taskC, [taskA, taskB]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('already exists');

      // CRITICAL: Verify C -> B was NOT persisted (rollback worked)
      const cDepsResult = await repo.getDependencies(taskC);
      expect(cDepsResult.ok).toBe(true);
      if (!cDepsResult.ok) return;
      // Should only have the original C -> A dependency
      expect(cDepsResult.value).toHaveLength(1);
      expect(cDepsResult.value[0].dependsOnTaskId).toBe(taskA);
    });

    it('should rollback all dependencies on task not found error', async () => {
      const taskC = 'task-c' as TaskId;
      const taskA = 'task-a' as TaskId;
      const nonExistent = 'non-existent' as TaskId;

      // Create only some tasks
      createTask(taskC);
      createTask(taskA);
      // nonExistent task is NOT created

      // Try to add C -> [A, nonExistent] atomically
      const result = await repo.addDependencies(taskC, [taskA, nonExistent]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('not found');

      // CRITICAL: Verify C -> A was NOT persisted (rollback worked)
      const cDepsResult = await repo.getDependencies(taskC);
      expect(cDepsResult.ok).toBe(true);
      if (!cDepsResult.ok) return;
      expect(cDepsResult.value).toHaveLength(0);

      // Verify no dependencies in database
      const allDeps = await repo.findAll();
      expect(allDeps.ok).toBe(true);
      if (!allDeps.ok) return;
      expect(allDeps.value).toHaveLength(0);
    });

    it('should reject empty dependency arrays', async () => {
      const taskA = 'task-a' as TaskId;

      // Create task first
      createTask(taskA);

      // Try to add empty array
      const result = await repo.addDependencies(taskA, []);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('empty array');
    });

    it('should handle large batch additions atomically', async () => {
      const taskZ = 'task-z' as TaskId;
      const dependencyCount = 50;

      // Create all tasks first
      createTask(taskZ);
      const deps: TaskId[] = [];
      for (let i = 0; i < dependencyCount; i++) {
        const depId = `task-${i}` as TaskId;
        createTask(depId);
        deps.push(depId);
      }

      // Add all 50 dependencies in one atomic operation
      const result = await repo.addDependencies(taskZ, deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(dependencyCount);

      // Verify all were persisted
      const depsResult = await repo.getDependencies(taskZ);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;
      expect(depsResult.value).toHaveLength(dependencyCount);
    });

    it('should rollback large batch on single failure', async () => {
      const taskZ = 'task-z' as TaskId;
      const taskA = 'task-a' as TaskId;
      const dependencyCount = 49;

      // Create all tasks first
      createTask(taskZ);
      createTask(taskA);
      const deps: TaskId[] = [taskA];
      for (let i = 0; i < dependencyCount; i++) {
        const depId = `task-${i}` as TaskId;
        createTask(depId);
        deps.push(depId);
      }

      // Pre-create one dependency to cause duplicate
      await repo.addDependency(taskZ, taskA);

      // Try to add 50 dependencies (including the duplicate)
      const result = await repo.addDependencies(taskZ, deps);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('already exists');

      // CRITICAL: Verify only the original dependency exists (all 49 others rolled back)
      const depsResult = await repo.getDependencies(taskZ);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;
      expect(depsResult.value).toHaveLength(1);
      expect(depsResult.value[0].dependsOnTaskId).toBe(taskA);
    });

    it('should invalidate cache after successful batch addition', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;
      const taskD = 'task-d' as TaskId;

      // Create all tasks first
      createTask(taskA);
      createTask(taskB);
      createTask(taskC);
      createTask(taskD);

      // Add A -> [B, C] atomically (builds and caches graph)
      const result1 = await repo.addDependencies(taskA, [taskB, taskC]);
      expect(result1.ok).toBe(true);

      // Try to add D -> A (should detect transitive cycle if cache is invalidated)
      // This tests that cache invalidation works correctly
      const result2 = await repo.addDependency(taskB, taskD);
      expect(result2.ok).toBe(true);

      // Now try to create cycle: D -> A (would create A -> B -> D -> A)
      const result3 = await repo.addDependency(taskD, taskA);
      expect(result3.ok).toBe(false);
      if (result3.ok) return;
      expect(result3.error.message).toContain('cycle');
    });

    it('should reject adding more than 100 dependencies in one batch', async () => {
      const taskZ = 'task-z' as TaskId;

      // Create task and 101 dependencies
      createTask(taskZ);
      const deps: TaskId[] = [];
      for (let i = 0; i < 101; i++) {
        const depId = `task-${i}` as TaskId;
        createTask(depId);
        deps.push(depId);
      }

      // Try to add 101 dependencies (exceeds limit of 100)
      const result = await repo.addDependencies(taskZ, deps);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('more than 100');

      // Verify nothing was persisted
      const depsResult = await repo.getDependencies(taskZ);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;
      expect(depsResult.value).toHaveLength(0);
    });

    it('should reject adding dependencies that would exceed 100 total', async () => {
      const taskZ = 'task-z' as TaskId;

      // Create task and dependencies
      createTask(taskZ);
      const initialDeps: TaskId[] = [];
      for (let i = 0; i < 90; i++) {
        const depId = `task-${i}` as TaskId;
        createTask(depId);
        initialDeps.push(depId);
      }

      // Add 90 dependencies (within limit)
      const result1 = await repo.addDependencies(taskZ, initialDeps);
      expect(result1.ok).toBe(true);

      // Try to add 20 more dependencies (would exceed 100 total)
      const moreDeps: TaskId[] = [];
      for (let i = 90; i < 110; i++) {
        const depId = `task-${i}` as TaskId;
        createTask(depId);
        moreDeps.push(depId);
      }

      const result2 = await repo.addDependencies(taskZ, moreDeps);

      expect(result2.ok).toBe(false);
      if (result2.ok) return;
      expect(result2.error.message).toContain('exceed maximum of 100');
      expect(result2.error.message).toContain('currently has 90');

      // Verify only original 90 dependencies exist
      const depsResult = await repo.getDependencies(taskZ);
      expect(depsResult.ok).toBe(true);
      if (!depsResult.ok) return;
      expect(depsResult.value).toHaveLength(90);
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

  describe('resolveDependenciesBatch()', () => {
    it('should batch resolve all pending dependencies in single query', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;
      const taskD = 'task-d' as TaskId;

      // Create tasks: A is dependency, B, C, D depend on A
      createTask(taskA);
      createTask(taskB);
      createTask(taskC);
      createTask(taskD);

      // Create dependencies: B->A, C->A, D->A
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskA);
      await repo.addDependency(taskD, taskA);

      // Batch resolve all dependencies on A as 'completed'
      const result = await repo.resolveDependenciesBatch(taskA, 'completed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should have resolved 3 dependencies
      expect(result.value).toBe(3);

      // Verify all dependencies are marked as completed
      const depsB = await repo.getDependencies(taskB);
      const depsC = await repo.getDependencies(taskC);
      const depsD = await repo.getDependencies(taskD);

      expect(depsB.ok && depsB.value[0].resolution).toBe('completed');
      expect(depsC.ok && depsC.value[0].resolution).toBe('completed');
      expect(depsD.ok && depsD.value[0].resolution).toBe('completed');

      // Verify timestamps were set
      expect(depsB.ok && depsB.value[0].resolvedAt).toBeGreaterThan(0);
      expect(depsC.ok && depsC.value[0].resolvedAt).toBeGreaterThan(0);
      expect(depsD.ok && depsD.value[0].resolvedAt).toBeGreaterThan(0);
    });

    it('should only resolve pending dependencies, skip already resolved', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      createTask(taskA);
      createTask(taskB);
      createTask(taskC);

      // Create dependencies: B->A, C->A
      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskA);

      // Manually resolve B->A first
      await repo.resolveDependency(taskB, taskA, 'failed');

      // Batch resolve all pending dependencies on A
      const result = await repo.resolveDependenciesBatch(taskA, 'completed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should only resolve C (B was already resolved)
      expect(result.value).toBe(1);

      // Verify B kept its original resolution
      const depsB = await repo.getDependencies(taskB);
      expect(depsB.ok && depsB.value[0].resolution).toBe('failed');

      // Verify C got new resolution
      const depsC = await repo.getDependencies(taskC);
      expect(depsC.ok && depsC.value[0].resolution).toBe('completed');
    });

    it('should return 0 when no pending dependencies exist', async () => {
      const taskA = 'task-a' as TaskId;

      createTask(taskA);

      // Batch resolve when task has no dependents
      const result = await repo.resolveDependenciesBatch(taskA, 'completed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(0);
    });

    it('should handle failed resolution state', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;
      const taskC = 'task-c' as TaskId;

      createTask(taskA);
      createTask(taskB);
      createTask(taskC);

      await repo.addDependency(taskB, taskA);
      await repo.addDependency(taskC, taskA);

      // Batch resolve as 'failed'
      const result = await repo.resolveDependenciesBatch(taskA, 'failed');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(2);

      const depsB = await repo.getDependencies(taskB);
      const depsC = await repo.getDependencies(taskC);

      expect(depsB.ok && depsB.value[0].resolution).toBe('failed');
      expect(depsC.ok && depsC.value[0].resolution).toBe('failed');
    });

    it('should handle cancelled resolution state', async () => {
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;

      createTask(taskA);
      createTask(taskB);

      await repo.addDependency(taskB, taskA);

      // Batch resolve as 'cancelled'
      const result = await repo.resolveDependenciesBatch(taskA, 'cancelled');

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(1);

      const depsB = await repo.getDependencies(taskB);
      expect(depsB.ok && depsB.value[0].resolution).toBe('cancelled');
    });

    it('should handle large number of dependents efficiently', async () => {
      const taskA = 'task-a' as TaskId;

      createTask(taskA);

      // Create 50 tasks that all depend on A
      const dependents: TaskId[] = [];
      for (let i = 0; i < 50; i++) {
        const taskId = `task-${i}` as TaskId;
        createTask(taskId);
        dependents.push(taskId);
        await repo.addDependency(taskId, taskA);
      }

      // Single batch resolve should update all 50 in one query
      const beforeResolve = Date.now();
      const result = await repo.resolveDependenciesBatch(taskA, 'completed');
      const afterResolve = Date.now();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBe(50);

      // Verify operation was fast (should complete in < 500ms for in-memory DB)
      // Increased from 100ms to 500ms to prevent flakiness in CI environments
      const duration = afterResolve - beforeResolve;
      expect(duration).toBeLessThan(500);

      // Spot check a few dependents
      const deps0 = await repo.getDependencies('task-0' as TaskId);
      const deps25 = await repo.getDependencies('task-25' as TaskId);
      const deps49 = await repo.getDependencies('task-49' as TaskId);

      expect(deps0.ok && deps0.value[0].resolution).toBe('completed');
      expect(deps25.ok && deps25.value[0].resolution).toBe('completed');
      expect(deps49.ok && deps49.value[0].resolution).toBe('completed');
    });

    it('should handle database errors gracefully', async () => {
      const taskA = 'task-a' as TaskId;

      createTask(taskA);

      // Close the database to simulate a database error
      db.close();

      // Attempt batch resolution on closed database
      const result = await repo.resolveDependenciesBatch(taskA, 'completed');

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('SYSTEM_ERROR');
      expect(result.error.message).toContain('Failed to batch resolve dependencies');
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

    it('should prevent TOCTOU race conditions with concurrent cycle attempts', async () => {
      /**
       * SECURITY TEST: Verify TOCTOU (Time-of-Check-Time-of-Use) protection
       *
       * This tests that the synchronous transaction in addDependency prevents:
       *   Thread A: check cycle A->B (pass)
       *   Thread B: check cycle B->A (pass) <- Can't happen, transaction locked
       *   Thread A: add A->B
       *   Thread B: add B->A <- Would create cycle
       *
       * Expected behavior: One or both operations fail, no cycle created
       */
      const taskA = 'task-a' as TaskId;
      const taskB = 'task-b' as TaskId;

      // Create tasks first
      createTask(taskA);
      createTask(taskB);

      // Attempt to create A->B and B->A concurrently
      // Due to transaction locks, one will see the other's dependency
      const [resultAB, resultBA] = await Promise.all([
        repo.addDependency(taskA, taskB),
        repo.addDependency(taskB, taskA)
      ]);

      // SECURITY ASSERTION: At least one must fail (both failing is also valid)
      const failures = [resultAB, resultBA].filter(r => !r.ok);
      expect(failures.length).toBeGreaterThan(0);

      // Verify at least one failure is due to cycle detection
      const hasCycleError = failures.some(f =>
        !f.ok && f.error.message.toLowerCase().includes('cycle')
      );
      expect(hasCycleError).toBe(true);

      // SECURITY ASSERTION: No cycle was created in database
      const allDeps = await repo.findAll();
      expect(allDeps.ok).toBe(true);
      if (allDeps.ok) {
        // Should have at most 1 dependency, NOT 2 (which would be a cycle)
        expect(allDeps.value.length).toBeLessThanOrEqual(1);

        // If one dependency exists, verify it's valid (not both directions)
        if (allDeps.value.length === 1) {
          const dep = allDeps.value[0];
          const hasBothDirections = allDeps.value.some(d =>
            d.taskId === dep.dependsOnTaskId && d.dependsOnTaskId === dep.taskId
          );
          expect(hasBothDirections).toBe(false);
        }
      }
    });
  });
});
