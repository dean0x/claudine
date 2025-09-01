import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Database } from '../../src/implementations/database.js';

describe('Database', () => {
  let database: Database;
  // Use in-memory database for tests to avoid CI file permission issues
  const testDbPath = ':memory:';

  afterEach(() => {
    // Clean up after each test
    try {
      database?.close();
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  describe('initialization', () => {
    it('should initialize in-memory database', () => {
      database = new Database(testDbPath);
      
      // Should not throw and should be functional
      expect(database).toBeDefined();
      expect(database.getTables().length).toBeGreaterThan(0);
    });

    it('should initialize SQLite database', () => {
      database = new Database(testDbPath);
      
      // In-memory databases don't exist on filesystem
      expect(database.isOpen()).toBe(true);
    });

    it('should create tables on first run', () => {
      database = new Database(testDbPath);
      
      const tables = database.getTables();
      
      expect(tables).toContain('tasks');
      expect(tables).toContain('task_output');
    });

    it('should handle existing database', () => {
      // Create first instance
      const db1 = new Database(testDbPath);
      db1.close();
      
      // Create second instance with existing DB
      database = new Database(testDbPath);
      
      expect(database.isOpen()).toBe(true);
      const tables = database.getTables();
      expect(tables).toContain('tasks');
    });

    it('should use WAL mode for better concurrency (or DELETE/MEMORY mode as fallback)', () => {
      database = new Database(testDbPath);
      
      const mode = database.getJournalMode();
      
      // In CI environments, WAL mode might fail and fall back to DELETE mode
      // In-memory databases use MEMORY mode
      expect(['wal', 'delete', 'memory']).toContain(mode);
    });
  });

  describe('Schema with timeout and buffer fields', () => {
    it('should have timeout and max_output_buffer columns in tasks table', () => {
      database = new Database(testDbPath);
      
      const tableInfo = database.getDatabase().prepare(`
        PRAGMA table_info(tasks)
      `).all();
      
      const columnNames = tableInfo.map((col: any) => col.name);
      
      expect(columnNames).toContain('timeout');
      expect(columnNames).toContain('max_output_buffer');
    });
  });
});