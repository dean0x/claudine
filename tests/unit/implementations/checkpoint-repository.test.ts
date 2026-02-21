/**
 * Unit tests for SQLiteCheckpointRepository
 * ARCHITECTURE: Tests repository operations in isolation with in-memory database
 * Pattern: Behavior-driven testing with Result pattern validation
 */

import type SQLite from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskCheckpoint } from '../../../src/core/domain';
import { TaskId } from '../../../src/core/domain';
import { SQLiteCheckpointRepository } from '../../../src/implementations/checkpoint-repository';
import { Database } from '../../../src/implementations/database';

describe('SQLiteCheckpointRepository - Unit Tests', () => {
  let db: Database;
  let repo: SQLiteCheckpointRepository;
  let rawDb: SQLite.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new SQLiteCheckpointRepository(db);
    rawDb = db.getDatabase();
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Insert a stub task row to satisfy FK constraint on task_checkpoints.task_id
   * ARCHITECTURE: Minimal row insertion - only required fields for FK satisfaction
   */
  function ensureTaskExists(taskId: string): void {
    rawDb
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, priority, created_at)
       VALUES (?, 'stub', 'completed', 'P2', ?)`,
      )
      .run(taskId, Date.now());
  }

  function createTestCheckpoint(overrides: Partial<Omit<TaskCheckpoint, 'id'>> = {}): Omit<TaskCheckpoint, 'id'> {
    const data = {
      taskId: TaskId('test-task-1'),
      checkpointType: 'completed' as const,
      outputSummary: 'Build succeeded',
      errorSummary: undefined,
      gitBranch: 'main',
      gitCommitSha: 'abc123def456',
      gitDirtyFiles: ['src/app.ts', 'package.json'],
      contextNote: undefined,
      createdAt: Date.now(),
      ...overrides,
    };

    // Ensure the referenced task exists in the database
    ensureTaskExists(data.taskId);

    return data;
  }

  // ============================================================================
  // save()
  // ============================================================================

  describe('save()', () => {
    it('should save a checkpoint and return it with an auto-generated ID', async () => {
      // Arrange
      const checkpoint = createTestCheckpoint();

      // Act
      const result = await repo.save(checkpoint);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBeTypeOf('number');
      expect(result.value.id).toBeGreaterThan(0);
      expect(result.value.taskId).toBe(checkpoint.taskId);
      expect(result.value.checkpointType).toBe('completed');
    });

    it('should persist all fields including optional ones', async () => {
      // Arrange
      const checkpoint = createTestCheckpoint({
        outputSummary: 'Tests passed: 42/42',
        errorSummary: 'Warning: deprecated API usage',
        gitBranch: 'feature/checkpoint',
        gitCommitSha: 'deadbeef12345678',
        gitDirtyFiles: ['src/index.ts', 'tests/unit/foo.test.ts', 'README.md'],
        contextNote: 'User-provided resumption context',
      });

      // Act
      await repo.save(checkpoint);
      const findResult = await repo.findLatest(checkpoint.taskId);

      // Assert
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      const found = findResult.value!;
      expect(found.outputSummary).toBe('Tests passed: 42/42');
      expect(found.errorSummary).toBe('Warning: deprecated API usage');
      expect(found.gitBranch).toBe('feature/checkpoint');
      expect(found.gitCommitSha).toBe('deadbeef12345678');
      expect(found.gitDirtyFiles).toEqual(['src/index.ts', 'tests/unit/foo.test.ts', 'README.md']);
      expect(found.contextNote).toBe('User-provided resumption context');
    });

    it('should persist checkpoint with undefined optional fields as null', async () => {
      // Arrange
      const checkpoint = createTestCheckpoint({
        outputSummary: undefined,
        errorSummary: undefined,
        gitBranch: undefined,
        gitCommitSha: undefined,
        gitDirtyFiles: undefined,
        contextNote: undefined,
      });

      // Act
      await repo.save(checkpoint);
      const findResult = await repo.findLatest(checkpoint.taskId);

      // Assert
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      const found = findResult.value!;
      expect(found.outputSummary).toBeUndefined();
      expect(found.errorSummary).toBeUndefined();
      expect(found.gitBranch).toBeUndefined();
      expect(found.gitCommitSha).toBeUndefined();
      expect(found.gitDirtyFiles).toBeUndefined();
      expect(found.contextNote).toBeUndefined();
    });

    it('should assign unique IDs to each saved checkpoint', async () => {
      // Arrange
      const checkpoint1 = createTestCheckpoint({ createdAt: Date.now() });
      const checkpoint2 = createTestCheckpoint({ createdAt: Date.now() + 1 });

      // Act
      const result1 = await repo.save(checkpoint1);
      const result2 = await repo.save(checkpoint2);

      // Assert
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      expect(result1.value.id).not.toBe(result2.value.id);
    });
  });

  // ============================================================================
  // findLatest()
  // ============================================================================

  describe('findLatest()', () => {
    it('should return the latest checkpoint for a task', async () => {
      // Arrange - save two checkpoints with different timestamps
      const now = Date.now();
      const older = createTestCheckpoint({
        outputSummary: 'older checkpoint',
        createdAt: now - 10000,
      });
      const newer = createTestCheckpoint({
        outputSummary: 'newer checkpoint',
        createdAt: now,
      });

      await repo.save(older);
      await repo.save(newer);

      // Act
      const result = await repo.findLatest(TaskId('test-task-1'));

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value!.outputSummary).toBe('newer checkpoint');
      expect(result.value!.createdAt).toBe(now);
    });

    it('should return null when no checkpoints exist for a task', async () => {
      // Act
      const result = await repo.findLatest(TaskId('non-existent-task'));

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toBeNull();
    });

    it('should return checkpoint for the specific task only', async () => {
      // Arrange
      const checkpoint1 = createTestCheckpoint({
        taskId: TaskId('task-alpha'),
        outputSummary: 'alpha output',
      });
      const checkpoint2 = createTestCheckpoint({
        taskId: TaskId('task-beta'),
        outputSummary: 'beta output',
      });

      await repo.save(checkpoint1);
      await repo.save(checkpoint2);

      // Act
      const result = await repo.findLatest(TaskId('task-alpha'));

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value!.taskId).toBe(TaskId('task-alpha'));
      expect(result.value!.outputSummary).toBe('alpha output');
    });
  });

  // ============================================================================
  // findAll()
  // ============================================================================

  describe('findAll()', () => {
    it('should return all checkpoints ordered by created_at DESC', async () => {
      // Arrange
      const now = Date.now();
      const taskId = TaskId('task-multi');
      ensureTaskExists(taskId);
      await repo.save(createTestCheckpoint({ taskId, createdAt: now - 2000, outputSummary: 'first' }));
      await repo.save(createTestCheckpoint({ taskId, createdAt: now - 1000, outputSummary: 'second' }));
      await repo.save(createTestCheckpoint({ taskId, createdAt: now, outputSummary: 'third' }));

      // Act
      const result = await repo.findAll(taskId);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(3);
      expect(result.value[0].outputSummary).toBe('third');
      expect(result.value[1].outputSummary).toBe('second');
      expect(result.value[2].outputSummary).toBe('first');
    });

    it('should respect the limit parameter', async () => {
      // Arrange
      const now = Date.now();
      const taskId = TaskId('task-limited');
      ensureTaskExists(taskId);
      await repo.save(createTestCheckpoint({ taskId, createdAt: now - 2000 }));
      await repo.save(createTestCheckpoint({ taskId, createdAt: now - 1000 }));
      await repo.save(createTestCheckpoint({ taskId, createdAt: now }));

      // Act
      const result = await repo.findAll(taskId, 2);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      // Should return the 2 most recent (ordered DESC)
      expect(result.value[0].createdAt).toBe(now);
      expect(result.value[1].createdAt).toBe(now - 1000);
    });

    it('should return empty array when no checkpoints exist', async () => {
      // Act
      const result = await repo.findAll(TaskId('no-checkpoints'));

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(0);
    });

    it('should only return checkpoints for the specified task', async () => {
      // Arrange
      const taskA = TaskId('task-A');
      const taskB = TaskId('task-B');
      await repo.save(createTestCheckpoint({ taskId: taskA, outputSummary: 'A1' }));
      await repo.save(createTestCheckpoint({ taskId: taskA, outputSummary: 'A2' }));
      await repo.save(createTestCheckpoint({ taskId: taskB, outputSummary: 'B1' }));

      // Act
      const result = await repo.findAll(taskA);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      expect(result.value.every((cp) => cp.taskId === taskA)).toBe(true);
    });
  });

  // ============================================================================
  // deleteByTask()
  // ============================================================================

  describe('deleteByTask()', () => {
    it('should delete all checkpoints for a task', async () => {
      // Arrange
      const taskId = TaskId('task-to-delete');
      ensureTaskExists(taskId);
      await repo.save(createTestCheckpoint({ taskId, createdAt: Date.now() - 1000 }));
      await repo.save(createTestCheckpoint({ taskId, createdAt: Date.now() }));

      // Act
      const deleteResult = await repo.deleteByTask(taskId);

      // Assert
      expect(deleteResult.ok).toBe(true);

      const findResult = await repo.findAll(taskId);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;

      expect(findResult.value).toHaveLength(0);
    });

    it('should be idempotent for non-existent task', async () => {
      // Act - deleting checkpoints for a task that was never saved
      const result = await repo.deleteByTask(TaskId('non-existent'));

      // Assert - should succeed without error
      expect(result.ok).toBe(true);
    });

    it('should not affect checkpoints of other tasks', async () => {
      // Arrange
      const taskToDelete = TaskId('task-delete-me');
      const taskToKeep = TaskId('task-keep-me');
      await repo.save(createTestCheckpoint({ taskId: taskToDelete }));
      await repo.save(createTestCheckpoint({ taskId: taskToKeep }));

      // Act
      await repo.deleteByTask(taskToDelete);

      // Assert - other task's checkpoints remain
      const remaining = await repo.findAll(taskToKeep);
      expect(remaining.ok).toBe(true);
      if (!remaining.ok) return;

      expect(remaining.value).toHaveLength(1);
      expect(remaining.value[0].taskId).toBe(taskToKeep);
    });
  });

  // ============================================================================
  // JSON serialization: gitDirtyFiles
  // ============================================================================

  describe('gitDirtyFiles JSON serialization', () => {
    it('should serialize array to JSON string and deserialize back', async () => {
      // Arrange
      const dirtyFiles = ['src/app.ts', 'package.json', 'tests/foo.test.ts'];
      const checkpoint = createTestCheckpoint({ gitDirtyFiles: dirtyFiles });

      // Act
      await repo.save(checkpoint);
      const result = await repo.findLatest(checkpoint.taskId);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value!.gitDirtyFiles).toEqual(dirtyFiles);
    });

    it('should handle empty array for gitDirtyFiles', async () => {
      // Arrange
      const checkpoint = createTestCheckpoint({ gitDirtyFiles: [] });

      // Act
      await repo.save(checkpoint);
      const result = await repo.findLatest(checkpoint.taskId);

      // Assert - empty array serialized as JSON "[]" should come back as array
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value!.gitDirtyFiles).toEqual([]);
    });

    it('should handle undefined gitDirtyFiles (stored as null)', async () => {
      // Arrange
      const checkpoint = createTestCheckpoint({ gitDirtyFiles: undefined });

      // Act
      await repo.save(checkpoint);
      const result = await repo.findLatest(checkpoint.taskId);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value!.gitDirtyFiles).toBeUndefined();
    });

    it('should handle single-file dirty list', async () => {
      // Arrange
      const checkpoint = createTestCheckpoint({ gitDirtyFiles: ['only-one.ts'] });

      // Act
      await repo.save(checkpoint);
      const result = await repo.findLatest(checkpoint.taskId);

      // Assert
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value!.gitDirtyFiles).toEqual(['only-one.ts']);
    });
  });

  // ============================================================================
  // Zod validation at boundary
  // ============================================================================

  describe('Zod validation at boundary', () => {
    it('should validate checkpoint_type values from database', async () => {
      // Arrange & Act - Save each valid checkpoint type
      for (const checkpointType of ['completed', 'failed', 'cancelled'] as const) {
        const checkpoint = createTestCheckpoint({
          taskId: TaskId(`task-${checkpointType}`),
          checkpointType,
        });
        const result = await repo.save(checkpoint);
        expect(result.ok).toBe(true);
      }

      // Assert - All types persist and validate correctly
      for (const checkpointType of ['completed', 'failed', 'cancelled'] as const) {
        const found = await repo.findLatest(TaskId(`task-${checkpointType}`));
        expect(found.ok).toBe(true);
        if (found.ok && found.value) {
          expect(found.value.checkpointType).toBe(checkpointType);
        }
      }
    });

    it('should correctly convert nullable database fields to domain model', async () => {
      // Arrange - Save checkpoint with all optional fields null
      const checkpoint = createTestCheckpoint({
        outputSummary: undefined,
        errorSummary: undefined,
        gitBranch: undefined,
        gitCommitSha: undefined,
        gitDirtyFiles: undefined,
        contextNote: undefined,
      });

      // Act
      await repo.save(checkpoint);
      const result = await repo.findLatest(checkpoint.taskId);

      // Assert - null columns should map to undefined in domain model
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const found = result.value!;
      expect(found.outputSummary).toBeUndefined();
      expect(found.errorSummary).toBeUndefined();
      expect(found.gitBranch).toBeUndefined();
      expect(found.gitCommitSha).toBeUndefined();
      expect(found.gitDirtyFiles).toBeUndefined();
      expect(found.contextNote).toBeUndefined();
    });
  });

  // ============================================================================
  // Multiple checkpoints per task
  // ============================================================================

  describe('multiple checkpoints per task', () => {
    it('should store multiple checkpoints and findLatest returns the most recent', async () => {
      // Arrange
      const taskId = TaskId('retry-task');
      ensureTaskExists(taskId);
      const now = Date.now();

      await repo.save(
        createTestCheckpoint({
          taskId,
          checkpointType: 'failed',
          errorSummary: 'First attempt failed',
          createdAt: now - 20000,
        }),
      );
      await repo.save(
        createTestCheckpoint({
          taskId,
          checkpointType: 'failed',
          errorSummary: 'Second attempt failed',
          createdAt: now - 10000,
        }),
      );
      await repo.save(
        createTestCheckpoint({
          taskId,
          checkpointType: 'completed',
          outputSummary: 'Third attempt succeeded',
          createdAt: now,
        }),
      );

      // Act
      const latestResult = await repo.findLatest(taskId);
      const allResult = await repo.findAll(taskId);

      // Assert - findLatest returns most recent
      expect(latestResult.ok).toBe(true);
      if (!latestResult.ok) return;
      expect(latestResult.value!.checkpointType).toBe('completed');
      expect(latestResult.value!.outputSummary).toBe('Third attempt succeeded');

      // Assert - findAll returns all three
      expect(allResult.ok).toBe(true);
      if (!allResult.ok) return;
      expect(allResult.value).toHaveLength(3);
    });

    it('should maintain correct ordering across multiple tasks', async () => {
      // Arrange
      const taskA = TaskId('task-A');
      const taskB = TaskId('task-B');
      ensureTaskExists(taskA);
      ensureTaskExists(taskB);
      const now = Date.now();

      await repo.save(createTestCheckpoint({ taskId: taskA, createdAt: now - 3000, outputSummary: 'A-old' }));
      await repo.save(createTestCheckpoint({ taskId: taskB, createdAt: now - 2000, outputSummary: 'B-old' }));
      await repo.save(createTestCheckpoint({ taskId: taskA, createdAt: now - 1000, outputSummary: 'A-new' }));
      await repo.save(createTestCheckpoint({ taskId: taskB, createdAt: now, outputSummary: 'B-new' }));

      // Act
      const latestA = await repo.findLatest(taskA);
      const latestB = await repo.findLatest(taskB);

      // Assert - each task's latest is independent
      expect(latestA.ok).toBe(true);
      expect(latestB.ok).toBe(true);
      if (!latestA.ok || !latestB.ok) return;

      expect(latestA.value!.outputSummary).toBe('A-new');
      expect(latestB.value!.outputSummary).toBe('B-new');
    });
  });
});
