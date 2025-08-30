import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Database } from '../../src/implementations/database.js';

describe('Database', () => {
  let database: Database;
  const testDbPath = path.join(os.tmpdir(), 'claudine-test', 'test.db');
  const testDataDir = path.dirname(testDbPath);

  beforeEach(() => {
    // Clean up before each test
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (database) {
      database.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  describe('initialization', () => {
    it('should create data directory if not exists', () => {
      expect(fs.existsSync(testDataDir)).toBe(false);
      
      database = new Database(testDbPath);
      
      expect(fs.existsSync(testDataDir)).toBe(true);
    });

    it('should initialize SQLite database', () => {
      database = new Database(testDbPath);
      
      expect(fs.existsSync(testDbPath)).toBe(true);
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

    it('should use WAL mode for better concurrency', () => {
      database = new Database(testDbPath);
      
      const mode = database.getJournalMode();
      
      expect(mode).toBe('wal');
    });
  });
});