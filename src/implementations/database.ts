/**
 * SQLite database initialization and management
 * Handles database creation, schema setup, and connection management
 */

import SQLite from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

export class Database {
  private db: SQLite.Database;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || this.getDefaultDbPath();
    
    // Ensure data directory exists
    // Note: We intentionally keep sync operation in constructor
    // Async constructors are not supported in JS/TS
    // This runs once at startup, not in hot path
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize SQLite database
    this.db = new SQLite(this.dbPath);
    
    // Configure for better performance and concurrency
    // Fall back to DELETE mode in test environments where WAL might fail
    try {
      this.db.pragma('journal_mode = WAL');
    } catch (error) {
      // WAL mode failed (common in CI environments), use DELETE mode
      console.error('WAL mode failed, falling back to DELETE mode:', error);
      this.db.pragma('journal_mode = DELETE');
    }
    this.db.pragma('synchronous = NORMAL');
    
    // Create tables if they don't exist
    this.createTables();
  }

  private getDefaultDbPath(): string {
    // Allow override via environment variable
    if (process.env.CLAUDINE_DATA_DIR) {
      return path.join(process.env.CLAUDINE_DATA_DIR, 'claudine.db');
    }
    
    // Platform-specific defaults
    const homeDir = os.homedir();
    
    if (process.platform === 'win32') {
      // Windows: %APPDATA%/claudine
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      return path.join(appData, 'claudine', 'claudine.db');
    } else {
      // Linux/Mac: ~/.claudine
      return path.join(homeDir, '.claudine', 'claudine.db');
    }
  }

  private createTables(): void {
    // Tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        working_directory TEXT,
        use_worktree INTEGER DEFAULT 0,
        cleanup_worktree INTEGER DEFAULT 1,
        timeout INTEGER,
        max_output_buffer INTEGER,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        worker_id TEXT,
        exit_code INTEGER,
        dependencies TEXT
      )
    `);

    // Task output table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_output (
        task_id TEXT PRIMARY KEY,
        stdout TEXT,
        stderr TEXT,
        total_size INTEGER,
        file_path TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    // Migrate existing databases by adding cleanup_worktree column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN cleanup_worktree INTEGER DEFAULT 1`);
    } catch (error) {
      // Column already exists, ignore the error
    }

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    `);
  }

  isOpen(): boolean {
    return this.db.open;
  }

  close(): void {
    if (this.db && this.db.open) {
      this.db.close();
    }
  }

  getTables(): string[] {
    const result = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `).all() as Array<{ name: string }>;
    
    return result.map(row => row.name);
  }

  getJournalMode(): string {
    const result = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    return result.journal_mode;
  }

  getDatabase(): SQLite.Database {
    return this.db;
  }
}