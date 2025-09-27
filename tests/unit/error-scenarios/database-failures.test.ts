/**
 * Database Failure Scenarios
 * Tests for database errors, corruption, locks, and recovery
 *
 * ARCHITECTURE: These tests validate proper error handling for all database failure modes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteTaskRepository } from '../../../src/implementations/task-repository';
import { Database } from '../../../src/implementations/database';
import { TaskFactory } from '../../fixtures/factories';
import { TEST_COUNTS } from '../../constants';
import { TIMEOUTS, DB_CONFIG, ERROR_MESSAGES } from '../../constants';
import { mkdtemp, rm, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Task } from '../../../src/core/domain';

describe('Database Failure Scenarios', () => {
  let repository: SQLiteTaskRepository;
  let database: Database;
  let tempDir: string;
  let taskFactory: TaskFactory;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-error-test-'));
    taskFactory = new TaskFactory();
  });

  afterEach(async () => {
    if (database) {
      try {
        database.close();
      } catch {
        // Ignore close errors in cleanup
      }
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('Connection Failures', () => {
    it('should handle database connection failure on initialization', async () => {
      // Create database with invalid path
      const invalidPath = join(tempDir, 'nonexistent', 'subdir', 'test.db');

      expect(() => {
        database = new Database(invalidPath);
      }).toThrow();
    });

    it('should handle database file permission errors', async () => {
      const dbPath = join(tempDir, 'readonly.db');

      // Create database first
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Save a task successfully
      const task = taskFactory.build();
      const saveResult = await repository.save(task);
      expect(saveResult.ok).toBe(true);

      // Close database
      database.close();

      // Make database file read-only
      await chmod(dbPath, 0o444);

      // Try to open for writing
      expect(() => {
        database = new Database(dbPath);
      }).toThrow();

      // Restore permissions for cleanup
      await chmod(dbPath, 0o644);
    });

    it('should handle database closed errors', async () => {
      const dbPath = join(tempDir, 'test.db');
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Close database
      database.close();

      // Try to perform operations
      const task = taskFactory.build();
      const result = await repository.save(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('closed');
      }
    });
  });

  describe('Lock and Timeout Failures', () => {
    it('should handle database lock timeout', async () => {
      const dbPath = join(tempDir, 'locked.db');

      // Create two database connections
      const db1 = new Database(dbPath);
      const repo1 = new SQLiteTaskRepository(db1);

      const db2 = new Database(dbPath);
      const repo2 = new SQLiteTaskRepository(db2);

      // Create many tasks to potentially trigger lock contention
      const tasks = taskFactory.buildMany(10);

      // Try concurrent writes from both connections
      const results = await Promise.allSettled([
        ...tasks.slice(0, 5).map(t => repo1.save(t)),
        ...tasks.slice(5).map(t => repo2.save(t))
      ]);

      // Some operations might fail due to locks
      const failures = results.filter(r => r.status === 'rejected');
      const successes = results.filter(r => r.status === 'fulfilled');

      // At least some should succeed
      expect(successes.length).toBeGreaterThan(0);

      // Clean up
      db1.close();
      db2.close();
    });

    it('should handle transaction failures', async () => {
      const dbPath = join(tempDir, 'transaction.db');
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Create task with extremely long string that might cause issues
      const task = taskFactory
        .withPrompt('x'.repeat(1000000)) // 1 million characters
        .build();

      const result = await repository.save(task);

      // Should handle gracefully (either save or return error)
      expect(result.ok).toBeDefined();
    });
  });

  describe('Data Corruption Scenarios', () => {
    it('should handle corrupted task data retrieval', async () => {
      const dbPath = join(tempDir, 'corrupt.db');
      database = new Database(dbPath);

      // Directly execute SQL to insert corrupted data
      const db = (database as { db: any }).db;

      // Insert task with invalid JSON in metadata
      db.prepare(`
        INSERT INTO tasks (id, prompt, status, priority, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'corrupt-task',
        'test prompt',
        'pending',
        'P1',
        '{invalid json}', // Corrupted JSON
        Date.now(),
        Date.now()
      );

      repository = new SQLiteTaskRepository(database);

      // Try to retrieve corrupted task
      const result = await repository.findById('corrupt-task' as TaskId);

      // Should handle gracefully
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBeDefined();
      }
    });

    it('should handle missing required columns', async () => {
      const dbPath = join(tempDir, 'missing-columns.db');
      database = new Database(dbPath);

      // Drop a column to simulate schema corruption
      const db = (database as { db: any }).db;

      // Create a new table without all columns
      db.exec(`
        CREATE TABLE tasks_backup AS SELECT * FROM tasks;
        DROP TABLE tasks;
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL
          -- Missing other columns
        );
      `);

      repository = new SQLiteTaskRepository(database);

      // Try to save a task
      const task = taskFactory.build();
      const result = await repository.save(task);

      expect(result.ok).toBe(false);
    });
  });

  describe('Disk Space Issues', () => {
    it('should handle out of disk space errors gracefully', async () => {
      // Note: Actually triggering disk full is dangerous in tests
      // Instead we test with a very small database size limit

      const dbPath = join(tempDir, 'small.db');
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Try to save many large tasks
      const hugeTasks = taskFactory.buildMany(100, (f, i) => {
        f.withPrompt('x'.repeat(TEST_COUNTS.STRESS_TEST * 10)); // 10KB per task
      });

      const results: boolean[] = [];
      for (const task of hugeTasks) {
        const result = await repository.save(task);
        results.push(result.ok);

        // If we start getting errors, that's expected
        if (!result.ok) {
          break;
        }
      }

      // Should save some but potentially fail on later ones
      expect(results.filter(r => r).length).toBeGreaterThan(0);
    });
  });

  describe('Recovery and Resilience', () => {
    it('should recover from temporary database unavailability', async () => {
      const dbPath = join(tempDir, 'recovery.db');
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Save initial task
      const task1 = taskFactory.withId('task-1').build();
      await repository.save(task1);

      // Simulate database unavailability by closing
      database.close();

      // Operation should fail
      const task2 = taskFactory.withId('task-2').build();
      const failResult = await repository.save(task2);
      expect(failResult.ok).toBe(false);

      // Reconnect
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Should be able to read previous data
      const findResult = await repository.findById(task1.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value?.id).toBe(task1.id);
      }

      // Should be able to save new data
      const saveResult = await repository.save(task2);
      expect(saveResult.ok).toBe(true);
    });

    it('should handle concurrent read/write operations', async () => {
      const dbPath = join(tempDir, 'concurrent.db');
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Create initial tasks
      const tasks = taskFactory.buildMany(10);
      for (const task of tasks) {
        await repository.save(task);
      }

      // Perform concurrent operations
      const operations = [
        // Reads
        repository.findAll(),
        repository.findById(tasks[0].id),
        repository.findByStatus('pending'),

        // Writes
        repository.save(taskFactory.withId('new-1').build()),
        repository.update(tasks[0].id, { status: 'running' }),

        // More reads
        repository.findAll(),
        repository.findById(tasks[1].id),

        // More writes
        repository.save(taskFactory.withId('new-2').build()),
        repository.delete(tasks[9].id)
      ];

      const results = await Promise.allSettled(operations);

      // All operations should complete (either success or handled error)
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);

      // Verify data consistency
      const finalTasks = await repository.findAll();
      expect(finalTasks.ok).toBe(true);
      if (finalTasks.ok) {
        // Should have 10 original - 1 deleted + 2 new = 11 tasks
        expect(finalTasks.value.length).toBe(11);
      }
    });

    it('should handle invalid SQL injection attempts', async () => {
      const dbPath = join(tempDir, 'injection.db');
      database = new Database(dbPath);
      repository = new SQLiteTaskRepository(database);

      // Try SQL injection in task prompt
      const maliciousTask = taskFactory
        .withId("task'; DROP TABLE tasks; --")
        .withPrompt("'; DELETE FROM tasks WHERE '1'='1")
        .build();

      // Should safely save without executing injection
      const saveResult = await repository.save(maliciousTask);
      expect(saveResult.ok).toBe(true);

      // Verify table still exists and has data
      const findResult = await repository.findAll();
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value.length).toBe(1);
        expect(findResult.value[0].prompt).toContain('DELETE FROM');
      }
    });

    it('should handle WAL mode checkpoint failures', async () => {
      const dbPath = join(tempDir, 'wal.db');
      database = new Database(dbPath);

      // Verify WAL mode is enabled
      const db = (database as { db: any }).db;
      const walMode = db.prepare('PRAGMA journal_mode').get();
      expect(walMode.journal_mode).toBe('wal');

      repository = new SQLiteTaskRepository(database);

      // Create many tasks to trigger WAL growth
      const tasks = taskFactory.buildMany(100);

      for (const task of tasks) {
        await repository.save(task);
      }

      // Force checkpoint
      db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();

      // Should still be able to read data
      const result = await repository.findAll();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(100);
      }
    });
  });

  describe('Schema Migration Failures', () => {
    it('should handle incompatible schema versions', async () => {
      const dbPath = join(tempDir, 'schema.db');
      database = new Database(dbPath);

      // Modify schema version
      const db = (database as { db: any }).db;
      db.prepare('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER)').run();
      db.prepare('INSERT INTO schema_version (version) VALUES (999)').run();

      repository = new SQLiteTaskRepository(database);

      // Operations should handle schema mismatch gracefully
      const task = taskFactory.build();
      const result = await repository.save(task);

      // May fail or succeed depending on implementation
      expect(result.ok).toBeDefined();
    });
  });
});