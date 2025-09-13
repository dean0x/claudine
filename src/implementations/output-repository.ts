/**
 * SQLite-based output repository implementation
 * Handles persistence of task output with file fallback for large outputs
 */

import SQLite from 'better-sqlite3';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { TaskId, TaskOutput } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import { Database } from './database.js';

// 100KB threshold for file storage
const FILE_STORAGE_THRESHOLD = 100 * 1024;

export interface OutputRepository {
  save(taskId: TaskId, output: TaskOutput): Promise<Result<void>>;
  append(taskId: TaskId, stream: 'stdout' | 'stderr', data: string): Promise<Result<void>>;
  get(taskId: TaskId): Promise<Result<TaskOutput | null>>;
  delete(taskId: TaskId): Promise<Result<void>>;
}

export class SQLiteOutputRepository implements OutputRepository {
  private readonly db: SQLite.Database;
  private readonly saveStmt: SQLite.Statement;
  private readonly getStmt: SQLite.Statement;
  private readonly deleteStmt: SQLite.Statement;
  private readonly outputDir: string;

  constructor(database: Database) {
    this.db = database.getDatabase();
    
    // Set up output directory for large files
    const dbPath = this.db.name;
    this.outputDir = path.join(path.dirname(dbPath), 'output');
    
    // Note: We intentionally keep sync operation in constructor
    // Async constructors are not supported in JS/TS
    // This runs once at startup, not in hot path
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Prepare statements
    this.saveStmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_output (
        task_id, stdout, stderr, total_size, file_path
      ) VALUES (
        @taskId, @stdout, @stderr, @totalSize, @filePath
      )
    `);

    this.getStmt = this.db.prepare(`
      SELECT * FROM task_output WHERE task_id = ?
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM task_output WHERE task_id = ?
    `);
  }

  async save(taskId: TaskId, output: Omit<TaskOutput, 'taskId'>): Promise<Result<void>> {
    try {
      const fullOutput = { ...output, taskId };
      const totalSize = this.calculateTotalSize(fullOutput);
      
      // Check if we should use file storage
      if (totalSize > FILE_STORAGE_THRESHOLD) {
        await this.saveToFile(taskId, fullOutput);
      } else {
        this.saveToDatabase(taskId, fullOutput, totalSize);
      }
      
      return ok(undefined);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to save output: ${error}`,
        { taskId }
      ));
    }
  }

  async append(taskId: TaskId, stream: 'stdout' | 'stderr', data: string): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        // Get existing output
        const existingResult = await this.get(taskId);
        
        let output: TaskOutput;
        if (existingResult.ok && existingResult.value) {
          // Append to existing
          output = {
            ...existingResult.value,
            [stream]: [...existingResult.value[stream], data],
            totalSize: existingResult.value.totalSize + data.length
          };
        } else {
          // Create new
          output = {
            taskId,
            stdout: stream === 'stdout' ? [data] : [],
            stderr: stream === 'stderr' ? [data] : [],
            totalSize: data.length
          };
        }

        await this.save(taskId, output);
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to append output: ${error}`,
        { taskId, stream }
      )
    );
  }

  async get(taskId: TaskId): Promise<Result<TaskOutput | null>> {
    return tryCatchAsync(
      async () => {
        const row = this.getStmt.get(taskId) as Record<string, any> | undefined;
        
        if (!row) {
          return null;
        }

        // Check if output is in a file
        if (row.file_path) {
          return await this.loadFromFile(taskId, row.file_path);
        }

        // Parse from database
        return {
          taskId: row.task_id as TaskId,
          stdout: JSON.parse(row.stdout || '[]'),
          stderr: JSON.parse(row.stderr || '[]'),
          totalSize: row.total_size || 0
        };
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to get output: ${error}`,
        { taskId }
      )
    );
  }

  async delete(taskId: TaskId): Promise<Result<void>> {
    return tryCatchAsync(
      async () => {
        // Get the row to check for file
        const row = this.getStmt.get(taskId) as Record<string, any> | undefined;
        
        if (row?.file_path) {
          // Delete the file
          const filePath = path.join(this.outputDir, row.file_path);
          try {
            await fsPromises.unlink(filePath);
          } catch (error: any) {
            // Ignore if file doesn't exist
            if (error.code !== 'ENOENT') {
              throw error;
            }
          }
        }

        // Delete from database
        this.deleteStmt.run(taskId);
      },
      (error) => new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to delete output: ${error}`,
        { taskId }
      )
    );
  }

  private calculateTotalSize(output: TaskOutput): number {
    const stdoutSize = output.stdout.reduce((sum, line) => sum + line.length, 0);
    const stderrSize = output.stderr.reduce((sum, line) => sum + line.length, 0);
    return stdoutSize + stderrSize;
  }

  private saveToDatabase(taskId: TaskId, output: TaskOutput, totalSize: number): void {
    this.saveStmt.run({
      taskId,
      stdout: JSON.stringify(output.stdout),
      stderr: JSON.stringify(output.stderr),
      totalSize,
      filePath: null
    });
  }

  private async saveToFile(taskId: TaskId, output: TaskOutput): Promise<void> {
    const fileName = `${taskId}.json`;
    const filePath = path.join(this.outputDir, fileName);
    
    // Write to file asynchronously
    await fsPromises.writeFile(filePath, JSON.stringify(output));
    
    // Save reference in database
    this.saveStmt.run({
      taskId,
      stdout: null,
      stderr: null,
      totalSize: this.calculateTotalSize(output),
      filePath: fileName
    });
  }

  private async loadFromFile(taskId: TaskId, fileName: string): Promise<TaskOutput> {
    const filePath = path.join(this.outputDir, fileName);
    
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Output file not found: ${filePath}`);
      }
      throw error;
    }
  }
}