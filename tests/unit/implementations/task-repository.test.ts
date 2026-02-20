/**
 * Unit tests for SQLiteTaskRepository
 *
 * ARCHITECTURE: Tests pagination, count, and unbounded query methods
 * Pattern: Mirrors dependency-repository.test.ts for consistency
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteTaskRepository } from '../../../src/implementations/task-repository.js';
import { Database } from '../../../src/implementations/database.js';
import { createTestTask } from '../../fixtures/test-data.js';
import type { Task } from '../../../src/core/domain.js';

describe('SQLiteTaskRepository', () => {
  let database: Database;
  let repo: SQLiteTaskRepository;

  beforeEach(() => {
    database = new Database(':memory:');
    repo = new SQLiteTaskRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  describe('findAll() pagination', () => {
    it('should apply default limit of 100', async () => {
      // Create 105 tasks to test the boundary
      for (let i = 0; i < 105; i++) {
        const task = createTestTask({ id: `task-${i}` });
        await repo.save(task);
      }

      // Without explicit limit, should get 100 (default)
      const result = await repo.findAll();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(100);
    });

    it('should respect custom limit', async () => {
      // Create 10 tasks
      for (let i = 0; i < 10; i++) {
        const task = createTestTask({ id: `task-${i}` });
        await repo.save(task);
      }

      const result = await repo.findAll(5);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(5);
    });

    it('should respect offset', async () => {
      // Create 5 tasks with different timestamps
      const tasks: Task[] = [];
      for (let i = 0; i < 5; i++) {
        const task = createTestTask({
          id: `task-${i}`,
          createdAt: Date.now() + i * 100 // Ensure distinct timestamps
        });
        tasks.push(task);
        await repo.save(task);
      }

      // Skip first 2 (most recent), get next 2
      const result = await repo.findAll(2, 2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      // Results are ordered by created_at DESC, so offset 2 skips the 2 newest
      expect(result.value[0].id).toBe('task-2');
      expect(result.value[1].id).toBe('task-1');
    });

    it('should return empty array when offset exceeds count', async () => {
      // Create 5 tasks
      for (let i = 0; i < 5; i++) {
        const task = createTestTask({ id: `task-${i}` });
        await repo.save(task);
      }

      const result = await repo.findAll(100, 1000);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('should order by created_at DESC (newest first)', async () => {
      // Create tasks with specific timestamps
      const task1 = createTestTask({ id: 'old-task', createdAt: 1000 });
      const task2 = createTestTask({ id: 'new-task', createdAt: 2000 });

      await repo.save(task1);
      await repo.save(task2);

      const result = await repo.findAll();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0].id).toBe('new-task'); // Newest first
      expect(result.value[1].id).toBe('old-task');
    });
  });

  describe('findAllUnbounded()', () => {
    it('should return all tasks without limit', async () => {
      // Create 105 tasks (more than default limit of 100)
      for (let i = 0; i < 105; i++) {
        const task = createTestTask({ id: `task-${i}` });
        await repo.save(task);
      }

      const result = await repo.findAllUnbounded();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(105);
    });

    it('should return empty array when no tasks exist', async () => {
      const result = await repo.findAllUnbounded();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('count()', () => {
    it('should return total task count', async () => {
      // Create 7 tasks
      for (let i = 0; i < 7; i++) {
        const task = createTestTask({ id: `task-${i}` });
        await repo.save(task);
      }

      const result = await repo.count();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(7);
    });

    it('should return 0 when no tasks exist', async () => {
      const result = await repo.count();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(0);
    });

    it('should reflect deletions', async () => {
      // Create 5 tasks
      for (let i = 0; i < 5; i++) {
        const task = createTestTask({ id: `task-${i}` });
        await repo.save(task);
      }

      // Delete 2 tasks
      await repo.delete('task-0' as any);
      await repo.delete('task-1' as any);

      const result = await repo.count();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(3);
    });
  });

  describe('continueFrom field', () => {
    it('should save and retrieve task with continueFrom', async () => {
      const task = createTestTask({
        id: 'task-with-continue',
        continueFrom: 'task-parent-123',
      });
      await repo.save(task);

      const result = await repo.findById('task-with-continue' as any);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value!.continueFrom).toBe('task-parent-123');
    });

    it('should save and retrieve task without continueFrom as undefined', async () => {
      const task = createTestTask({
        id: 'task-no-continue',
      });
      await repo.save(task);

      const result = await repo.findById('task-no-continue' as any);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value!.continueFrom).toBeUndefined();
    });

    it('should update continueFrom via update()', async () => {
      const task = createTestTask({
        id: 'task-update-continue',
      });
      await repo.save(task);

      // Update with continueFrom
      const updateResult = await repo.update('task-update-continue' as any, {
        continueFrom: 'task-dep-456' as any,
      });
      expect(updateResult.ok).toBe(true);

      const result = await repo.findById('task-update-continue' as any);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value!.continueFrom).toBe('task-dep-456');
    });

    it('should apply migration v6 correctly (column exists)', async () => {
      // The Database constructor applies all migrations automatically
      // Verify the column exists by saving/retrieving a task with continueFrom
      const task = createTestTask({
        id: 'task-migration-test',
        continueFrom: 'task-parent-migration',
      });
      const saveResult = await repo.save(task);
      expect(saveResult.ok).toBe(true);

      const findResult = await repo.findById('task-migration-test' as any);
      expect(findResult.ok).toBe(true);
      if (findResult.ok && findResult.value) {
        expect(findResult.value.continueFrom).toBe('task-parent-migration');
      }
    });
  });
});
