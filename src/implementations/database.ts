/**
 * SQLite database initialization and management
 * Handles database creation, schema setup, and connection management
 */

import SQLite from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Logger } from '../core/interfaces.js';

/**
 * Silent no-op logger for when no logger is provided
 * Pattern: Null Object - avoids null checks throughout code
 */
const noOpLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noOpLogger,
};

export class Database {
  private db: SQLite.Database;
  private readonly dbPath: string;
  private readonly logger: Logger;

  constructor(dbPath?: string, logger?: Logger) {
    this.dbPath = dbPath || this.getDefaultDbPath();
    this.logger = logger ?? noOpLogger;

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
      this.logger.warn('WAL mode failed, falling back to DELETE mode', {
        error: error instanceof Error ? error.message : String(error)
      });
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
    // SCHEMA MIGRATIONS: Only create migrations table here
    // All other tables are created through migrations (single source of truth)
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

    // Apply all pending migrations (schema lives in migrations)
    this.applyMigrations(currentVersion);
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
    } catch (error: any) {
      // Only return 0 if the table doesn't exist (fresh database)
      // Re-throw all other errors (permissions, corruption, connection issues)
      if (error.message && error.message.includes('no such table')) {
        return 0;
      }
      throw error;
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
        this.logger.info('Applying database migration', {
          version: migration.version,
          description: migration.description
        });

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
        this.logger.info('Database migration applied successfully', {
          version: migration.version
        });
      }
    }
  }

  /**
   * Define all schema migrations
   * Add new migrations here with incrementing version numbers
   *
   * ARCHITECTURE: Migrations are the single source of truth for schema
   * - Fresh databases: All migrations run in order
   * - Existing databases: Only new migrations run (skips already applied)
   * - Uses IF NOT EXISTS for idempotency (safe if migration runs twice)
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
          // Tasks table - core task data
          db.exec(`
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

          // Task output table - stdout/stderr capture
          db.exec(`
            CREATE TABLE IF NOT EXISTS task_output (
              task_id TEXT PRIMARY KEY,
              stdout TEXT,
              stderr TEXT,
              total_size INTEGER,
              file_path TEXT,
              FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
          `);

          // Task dependencies table - DAG for dependency tracking
          // Pattern: Normalized dependency tracking with resolution states
          // Rationale: Enables efficient cycle detection, dependency queries, and state tracking
          db.exec(`
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

          // Performance indexes
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
            CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_resolution ON task_dependencies(resolution);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_blocked ON task_dependencies(task_id, resolution);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_resolution ON task_dependencies(depends_on_task_id, resolution);
          `);
        }
      },
      {
        version: 2,
        description: 'Add CHECK constraint on resolution column for defense-in-depth',
        up: (db) => {
          // SQLite doesn't support adding CHECK constraints to existing columns
          // So we recreate the table with the constraint
          // Pattern: Safe table migration with data preservation
          db.exec(`
            -- Create new table with CHECK constraint
            CREATE TABLE task_dependencies_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_id TEXT NOT NULL,
              depends_on_task_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              resolved_at INTEGER,
              resolution TEXT NOT NULL DEFAULT 'pending'
                CHECK (resolution IN ('pending', 'completed', 'failed', 'cancelled')),
              FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
              FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
              UNIQUE(task_id, depends_on_task_id)
            );

            -- Copy existing data (all existing values should be valid)
            INSERT INTO task_dependencies_new
              SELECT * FROM task_dependencies;

            -- Drop old table
            DROP TABLE task_dependencies;

            -- Rename new table
            ALTER TABLE task_dependencies_new RENAME TO task_dependencies;

            -- Recreate indexes (indexes don't survive table rename)
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_resolution ON task_dependencies(resolution);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_blocked ON task_dependencies(task_id, resolution);
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_resolution ON task_dependencies(depends_on_task_id, resolution);
          `);
        }
      },
      {
        version: 3,
        description: 'Add CHECK constraints on status and priority columns for defense-in-depth',
        up: (db) => {
          // SQLite doesn't support adding CHECK constraints to existing columns
          // So we recreate the table with the constraints
          // Pattern: Safe table migration with data preservation
          db.exec(`
            -- Create new table with CHECK constraints
            CREATE TABLE tasks_new (
              id TEXT PRIMARY KEY,
              prompt TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
              priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2')),
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
            );

            -- Copy existing data (all existing values should be valid)
            INSERT INTO tasks_new SELECT * FROM tasks;

            -- Drop old table
            DROP TABLE tasks;

            -- Rename new table
            ALTER TABLE tasks_new RENAME TO tasks;

            -- Recreate indexes (indexes don't survive table rename)
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
            CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
          `);
        }
      }
      // Future migrations go here:
      // {
      //   version: 4,
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