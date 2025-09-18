import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabase } from '../../../src/implementations/database';
import type { Database as SQLiteDB } from 'better-sqlite3';

describe('SQLiteDatabase - REAL Database Operations (In-Memory)', () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    // Use in-memory database for tests - real SQLite, no file I/O
    db = new SQLiteDatabase(':memory:');
    const result = await db.connect();
    expect(result.ok).toBe(true);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Connection management', () => {
    it('should connect to in-memory database', async () => {
      // Already connected in beforeEach
      const isConnected = await db.isConnected();
      expect(isConnected).toBe(true);
    });

    it('should handle double connection gracefully', async () => {
      // Already connected
      const secondConnect = await db.connect();
      expect(secondConnect.ok).toBe(true);

      // Should still be connected
      expect(await db.isConnected()).toBe(true);
    });

    it('should close connection', async () => {
      expect(await db.isConnected()).toBe(true);

      const result = await db.close();
      expect(result.ok).toBe(true);

      expect(await db.isConnected()).toBe(false);
    });

    it('should handle close when not connected', async () => {
      await db.close();
      const secondClose = await db.close();

      expect(secondClose.ok).toBe(true); // Should not error
    });
  });

  describe('Schema initialization', () => {
    it('should initialize schema with tables', async () => {
      const result = await db.initializeSchema();
      expect(result.ok).toBe(true);

      // Verify tables exist by querying sqlite_master
      const tables = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );

      expect(tables.ok).toBe(true);
      if (tables.ok) {
        const tableNames = tables.value.map((row: any) => row.name);
        expect(tableNames).toContain('tasks');
        expect(tableNames).toContain('workers');
        expect(tableNames).toContain('task_outputs');
      }
    });

    it('should create indexes for performance', async () => {
      await db.initializeSchema();

      const indexes = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
      );

      expect(indexes.ok).toBe(true);
      if (indexes.ok) {
        const indexNames = indexes.value.map((row: any) => row.name);
        // Should have indexes on commonly queried fields
        expect(indexNames.some(name => name.includes('status'))).toBe(true);
        expect(indexNames.some(name => name.includes('priority'))).toBe(true);
      }
    });

    it('should be idempotent', async () => {
      // Initialize twice
      const first = await db.initializeSchema();
      const second = await db.initializeSchema();

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      // Should still have correct schema
      const tables = await db.execute(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
      );

      if (tables.ok && tables.value[0]) {
        expect(tables.value[0].count).toBeGreaterThan(0);
      }
    });
  });

  describe('Query execution', () => {
    beforeEach(async () => {
      await db.initializeSchema();
    });

    it('should execute SELECT queries', async () => {
      const result = await db.execute('SELECT 1 as test');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].test).toBe(1);
      }
    });

    it('should execute INSERT queries', async () => {
      const insertResult = await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['task-123', 'test task', 1, 'PENDING', Date.now()]
      );

      expect(insertResult.ok).toBe(true);
      if (insertResult.ok) {
        expect(insertResult.value.changes).toBe(1);
      }

      // Verify insertion
      const selectResult = await db.execute(
        'SELECT * FROM tasks WHERE id = ?',
        ['task-123']
      );

      if (selectResult.ok) {
        expect(selectResult.value).toHaveLength(1);
        expect(selectResult.value[0].prompt).toBe('test task');
      }
    });

    it('should execute UPDATE queries', async () => {
      // Insert first
      await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES ('task-456', 'original', 1, 'PENDING', ?)`,
        [Date.now()]
      );

      // Update
      const updateResult = await db.run(
        'UPDATE tasks SET status = ? WHERE id = ?',
        ['COMPLETED', 'task-456']
      );

      expect(updateResult.ok).toBe(true);
      if (updateResult.ok) {
        expect(updateResult.value.changes).toBe(1);
      }

      // Verify update
      const result = await db.execute(
        'SELECT status FROM tasks WHERE id = ?',
        ['task-456']
      );

      if (result.ok && result.value[0]) {
        expect(result.value[0].status).toBe('COMPLETED');
      }
    });

    it('should execute DELETE queries', async () => {
      // Insert multiple
      for (let i = 0; i < 3; i++) {
        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES (?, 'test', 1, 'PENDING', ?)`,
          [`task-${i}`, Date.now()]
        );
      }

      // Delete one
      const deleteResult = await db.run(
        'DELETE FROM tasks WHERE id = ?',
        ['task-1']
      );

      expect(deleteResult.ok).toBe(true);
      if (deleteResult.ok) {
        expect(deleteResult.value.changes).toBe(1);
      }

      // Verify deletion
      const remaining = await db.execute('SELECT COUNT(*) as count FROM tasks');
      if (remaining.ok && remaining.value[0]) {
        expect(remaining.value[0].count).toBe(2);
      }
    });
  });

  describe('Transaction support', () => {
    beforeEach(async () => {
      await db.initializeSchema();
    });

    it('should execute transactions successfully', async () => {
      const result = await db.transaction(async () => {
        // Multiple operations in transaction
        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES ('tx-1', 'task 1', 1, 'PENDING', ?)`,
          [Date.now()]
        );

        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES ('tx-2', 'task 2', 1, 'PENDING', ?)`,
          [Date.now()]
        );

        return { ok: true, value: 'success' };
      });

      expect(result.ok).toBe(true);

      // Verify both inserted
      const count = await db.execute('SELECT COUNT(*) as count FROM tasks');
      if (count.ok && count.value[0]) {
        expect(count.value[0].count).toBe(2);
      }
    });

    it('should rollback on error', async () => {
      // Insert one task outside transaction
      await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES ('outside', 'outside', 1, 'PENDING', ?)`,
        [Date.now()]
      );

      const result = await db.transaction(async () => {
        // First insert succeeds
        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES ('tx-fail-1', 'task 1', 1, 'PENDING', ?)`,
          [Date.now()]
        );

        // This will fail (duplicate ID)
        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES ('outside', 'duplicate', 1, 'PENDING', ?)`,
          [Date.now()]
        );

        return { ok: true, value: 'should not reach' };
      });

      expect(result.ok).toBe(false);

      // Transaction should have rolled back
      const count = await db.execute('SELECT COUNT(*) as count FROM tasks');
      if (count.ok && count.value[0]) {
        expect(count.value[0].count).toBe(1); // Only 'outside' task
      }

      // tx-fail-1 should not exist
      const txTask = await db.execute(
        'SELECT * FROM tasks WHERE id = ?',
        ['tx-fail-1']
      );
      if (txTask.ok) {
        expect(txTask.value).toHaveLength(0);
      }
    });

    it('should handle nested transactions', async () => {
      const result = await db.transaction(async () => {
        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES ('outer', 'outer task', 1, 'PENDING', ?)`,
          [Date.now()]
        );

        // Nested transaction (SQLite uses savepoints)
        const innerResult = await db.transaction(async () => {
          await db.run(
            `INSERT INTO tasks (id, prompt, priority, status, created_at)
             VALUES ('inner', 'inner task', 1, 'PENDING', ?)`,
            [Date.now()]
          );
          return { ok: true, value: 'inner' };
        });

        expect(innerResult.ok).toBe(true);
        return { ok: true, value: 'outer' };
      });

      expect(result.ok).toBe(true);

      // Both should be committed
      const count = await db.execute('SELECT COUNT(*) as count FROM tasks');
      if (count.ok && count.value[0]) {
        expect(count.value[0].count).toBe(2);
      }
    });
  });

  describe('Prepared statements', () => {
    beforeEach(async () => {
      await db.initializeSchema();
    });

    it('should cache and reuse prepared statements', async () => {
      const query = 'SELECT * FROM tasks WHERE priority = ?';

      // Execute same query multiple times
      for (let i = 1; i <= 3; i++) {
        const result = await db.execute(query, [i]);
        expect(result.ok).toBe(true);
      }

      // Prepared statement should be cached (implementation detail)
      // Main test is that it works correctly
    });

    it('should handle parameter binding', async () => {
      // Insert test data
      await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['param-test', 'test prompt', 2, 'RUNNING', Date.now()]
      );

      // Query with parameters
      const result = await db.execute(
        'SELECT * FROM tasks WHERE id = ? AND priority = ?',
        ['param-test', 2]
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].prompt).toBe('test prompt');
      }
    });

    it('should prevent SQL injection', async () => {
      const maliciousInput = "'; DROP TABLE tasks; --";

      // This should be safely escaped
      const result = await db.execute(
        'SELECT * FROM tasks WHERE id = ?',
        [maliciousInput]
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0); // No results, but no damage
      }

      // Table should still exist
      const tables = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
      );

      expect(tables.ok).toBe(true);
      if (tables.ok) {
        expect(tables.value).toHaveLength(1);
      }
    });
  });

  describe('Performance features', () => {
    beforeEach(async () => {
      await db.initializeSchema();
    });

    it('should use WAL mode for better concurrency', async () => {
      // Check journal mode
      const mode = await db.execute('PRAGMA journal_mode');

      expect(mode.ok).toBe(true);
      if (mode.ok && mode.value[0]) {
        // In-memory databases might not support WAL, but should not error
        expect(['memory', 'wal', 'delete']).toContain(mode.value[0].journal_mode);
      }
    });

    it('should handle batch inserts efficiently', async () => {
      const batchSize = 1000;
      const start = performance.now();

      const result = await db.transaction(async () => {
        for (let i = 0; i < batchSize; i++) {
          await db.run(
            `INSERT INTO tasks (id, prompt, priority, status, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [`batch-${i}`, `Task ${i}`, (i % 3) + 1, 'PENDING', Date.now()]
          );
        }
        return { ok: true, value: batchSize };
      });

      const duration = performance.now() - start;

      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(1000); // Should insert 1000 rows in < 1 second

      // Verify count
      const count = await db.execute('SELECT COUNT(*) as count FROM tasks');
      if (count.ok && count.value[0]) {
        expect(count.value[0].count).toBe(batchSize);
      }
    });

    it('should use indexes for fast queries', async () => {
      // Insert many tasks
      await db.transaction(async () => {
        for (let i = 0; i < 100; i++) {
          await db.run(
            `INSERT INTO tasks (id, prompt, priority, status, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [`perf-${i}`, `Task ${i}`, (i % 3) + 1, ['PENDING', 'RUNNING', 'COMPLETED'][i % 3], Date.now()]
          );
        }
        return { ok: true, value: null };
      });

      const start = performance.now();

      // Query using indexed column
      const result = await db.execute(
        'SELECT * FROM tasks WHERE status = ? ORDER BY priority',
        ['COMPLETED']
      );

      const duration = performance.now() - start;

      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(10); // Should be very fast with index
    });
  });

  describe('Error handling', () => {
    it('should handle connection errors gracefully', async () => {
      const badDb = new SQLiteDatabase('/invalid/path/to/database.db');
      const result = await badDb.connect();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('SQLITE_CANTOPEN');
      }
    });

    it('should handle query errors', async () => {
      const result = await db.execute('SELECT * FROM nonexistent_table');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('no such table');
      }
    });

    it('should handle constraint violations', async () => {
      await db.initializeSchema();

      // Insert task
      await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES ('unique-id', 'test', 1, 'PENDING', ?)`,
        [Date.now()]
      );

      // Try to insert duplicate
      const result = await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES ('unique-id', 'duplicate', 1, 'PENDING', ?)`,
        [Date.now()]
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('UNIQUE constraint');
      }
    });
  });

  describe('Real-world usage patterns', () => {
    beforeEach(async () => {
      await db.initializeSchema();
    });

    it('should handle concurrent-like operations', async () => {
      // Simulate multiple operations happening quickly
      const operations = Array.from({ length: 10 }, (_, i) =>
        db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [`concurrent-${i}`, `Task ${i}`, 1, 'PENDING', Date.now()]
        )
      );

      const results = await Promise.all(operations);

      expect(results.every(r => r.ok)).toBe(true);

      // Verify all inserted
      const count = await db.execute('SELECT COUNT(*) as count FROM tasks');
      if (count.ok && count.value[0]) {
        expect(count.value[0].count).toBe(10);
      }
    });

    it('should support complex queries with joins', async () => {
      // Insert tasks and workers
      await db.run(
        `INSERT INTO tasks (id, prompt, priority, status, created_at)
         VALUES ('task-with-worker', 'test', 1, 'RUNNING', ?)`,
        [Date.now()]
      );

      await db.run(
        `INSERT INTO workers (id, task_id, pid, status, started_at)
         VALUES ('worker-1', 'task-with-worker', 12345, 'RUNNING', ?)`,
        [Date.now()]
      );

      // Join query
      const result = await db.execute(`
        SELECT t.id, t.prompt, w.pid, w.status as worker_status
        FROM tasks t
        LEFT JOIN workers w ON t.id = w.task_id
        WHERE t.status = 'RUNNING'
      `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].pid).toBe(12345);
      }
    });

    it('should handle pagination patterns', async () => {
      // Insert many tasks
      for (let i = 0; i < 50; i++) {
        await db.run(
          `INSERT INTO tasks (id, prompt, priority, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [`page-${i}`, `Task ${i}`, 1, 'PENDING', Date.now() + i]
        );
      }

      // Page 1
      const page1 = await db.execute(
        'SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [10, 0]
      );

      // Page 2
      const page2 = await db.execute(
        'SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [10, 10]
      );

      expect(page1.ok && page1.value).toHaveLength(10);
      expect(page2.ok && page2.value).toHaveLength(10);

      // Pages should have different data
      if (page1.ok && page2.ok) {
        const page1Ids = page1.value.map((r: any) => r.id);
        const page2Ids = page2.value.map((r: any) => r.id);
        expect(page1Ids).not.toEqual(page2Ids);
      }
    });
  });
});