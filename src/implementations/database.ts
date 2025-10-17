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

    // SECURITY: Enable foreign key constraints (disabled by default in SQLite)
    // This prevents dependencies from referencing non-existent tasks
    this.db.pragma('foreign_keys = ON');

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
    // SECURITY: Validate environment variable to prevent path traversal
    if (process.env.CLAUDINE_DATA_DIR) {
      const dataDir = process.env.CLAUDINE_DATA_DIR;

      // Validate path is absolute and doesn't contain traversal
      if (!path.isAbsolute(dataDir)) {
        throw new Error('CLAUDINE_DATA_DIR must be an absolute path');
      }

      const normalized = path.normalize(dataDir);
      if (normalized.includes('..')) {
        throw new Error('CLAUDINE_DATA_DIR must not contain path traversal sequences (..)');
      }

      return path.join(normalized, 'claudine.db');
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
    // SCHEMA MIGRATIONS: Track applied migrations for safe production upgrades
    // Pattern: Version-based migrations with timestamps
    // Rationale: Enables safe schema evolution without data loss
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);

    // Get current schema version
    const currentVersion = this.getCurrentSchemaVersion();

    // Apply migrations if needed (currently at v1 - baseline schema)
    this.applyMigrations(currentVersion);

    // Tasks table with complete schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        working_directory TEXT,
        use_worktree INTEGER DEFAULT 0,
        worktree_cleanup TEXT DEFAULT 'auto',
        merge_strategy TEXT DEFAULT 'pr',
        branch_name TEXT,
        base_branch TEXT,
        auto_commit INTEGER DEFAULT 1,
        push_to_remote INTEGER DEFAULT 1,
        pr_title TEXT,
        pr_body TEXT,
        timeout INTEGER,
        max_output_buffer INTEGER,
        parent_task_id TEXT,
        retry_count INTEGER,
        retry_of TEXT,
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

    // Task dependencies table
    // ARCHITECTURE: Relational model for task dependencies with DAG validation
    // Pattern: Normalized dependency tracking with resolution states
    // Rationale: Enables efficient cycle detection, dependency queries, and state tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        depends_on_task_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolution TEXT NOT NULL DEFAULT 'pending',
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, depends_on_task_id)
      )
    `);

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_resolution ON task_dependencies(resolution);
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_blocked ON task_dependencies(task_id, resolution);
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

  /**
   * Get current schema version from migrations table
   * Returns 0 if no migrations have been applied (fresh database)
   */
  private getCurrentSchemaVersion(): number {
    try {
      const result = this.db.prepare(`
        SELECT MAX(version) as version FROM schema_migrations
      `).get() as { version: number | null };

      return result?.version || 0;
    } catch (error) {
      // Table doesn't exist yet (fresh database)
      return 0;
    }
  }

  /**
   * Apply migrations incrementally from current version to latest
   * Pattern: Version-based migrations with idempotent operations
   * Rationale: Safe incremental upgrades without data loss
   */
  private applyMigrations(currentVersion: number): void {
    const migrations = this.getMigrations();

    // Apply migrations in order
    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        console.log(`Applying migration v${migration.version}: ${migration.description}`);

        // Run migration in transaction for safety
        const applyMigration = this.db.transaction(() => {
          // Execute migration SQL
          migration.up(this.db);

          // Record migration as applied
          this.db.prepare(`
            INSERT INTO schema_migrations (version, applied_at, description)
            VALUES (?, ?, ?)
          `).run(migration.version, Date.now(), migration.description);
        });

        applyMigration();
        console.log(`Migration v${migration.version} applied successfully`);
      }
    }
  }

  /**
   * Define all schema migrations
   * Add new migrations here with incrementing version numbers
   */
  private getMigrations(): Array<{
    version: number;
    description: string;
    up: (db: SQLite.Database) => void;
  }> {
    return [
      {
        version: 1,
        description: 'Baseline schema with tasks, dependencies, and output tables',
        up: (db) => {
          // Migration v1 is the baseline - tables are already created in createTables()
          // This just records the baseline version
        }
      }
      // Future migrations go here:
      // {
      //   version: 2,
      //   description: 'Add new column to tasks table',
      //   up: (db) => {
      //     db.exec('ALTER TABLE tasks ADD COLUMN new_field TEXT');
      //   }
      // }
    ];
  }

  /**
   * Get current schema version (public method for monitoring/debugging)
   */
  getSchemaVersion(): number {
    return this.getCurrentSchemaVersion();
  }
}