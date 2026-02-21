import { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { SQLiteOutputRepository } from '@/implementations/sqlite-output-repository';
import { SQLiteTaskRepository } from '@/implementations/sqlite-task-repository';

export class TestDatabase {
  private db: Database | null = null;
  private dbPath: string;

  constructor(name: string = 'test') {
    const testDbDir = path.join(process.cwd(), 'test-db');
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
    this.dbPath = path.join(testDbDir, `${name}-${randomUUID()}.db`);
  }

  async setup(): Promise<{ taskRepo: SQLiteTaskRepository; outputRepo: SQLiteOutputRepository }> {
    const taskRepo = new SQLiteTaskRepository(this.dbPath);
    const outputRepo = new SQLiteOutputRepository(this.dbPath);

    await taskRepo.initialize();
    await outputRepo.initialize();

    return { taskRepo, outputRepo };
  }

  async cleanup(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }

    // Clean up WAL and SHM files
    const walPath = `${this.dbPath}-wal`;
    const shmPath = `${this.dbPath}-shm`;

    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }

    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
    }
  }

  async reset(): Promise<void> {
    await this.cleanup();
    await this.setup();
  }
}

export function createTestDb(name?: string): TestDatabase {
  return new TestDatabase(name);
}
