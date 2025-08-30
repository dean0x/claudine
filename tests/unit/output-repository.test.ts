import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Database } from '../../src/implementations/database.js';
import { SQLiteOutputRepository } from '../../src/implementations/output-repository.js';
import { SQLiteTaskRepository } from '../../src/implementations/task-repository.js';
import { TaskId, createTask, Priority } from '../../src/core/domain.js';

describe('SQLiteOutputRepository', () => {
  let database: Database;
  let repository: SQLiteOutputRepository;
  let taskRepository: SQLiteTaskRepository;
  const testDbPath = path.join(os.tmpdir(), 'claudine-test', 'output-test.db');
  const testDataDir = path.dirname(testDbPath);

  beforeEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
    
    database = new Database(testDbPath);
    repository = new SQLiteOutputRepository(database);
    taskRepository = new SQLiteTaskRepository(database);
    
    // Create test tasks to satisfy foreign key constraints
    const task1 = { ...createTask({ prompt: 'Test 1', priority: Priority.P2 }), id: TaskId('test-task-1') };
    const task2 = { ...createTask({ prompt: 'Test 2', priority: Priority.P2 }), id: TaskId('test-task-2') };
    const task3 = { ...createTask({ prompt: 'Test 3', priority: Priority.P2 }), id: TaskId('test-task-3') };
    const task4 = { ...createTask({ prompt: 'Test 4', priority: Priority.P2 }), id: TaskId('test-task-4') };
    
    await taskRepository.save(task1);
    await taskRepository.save(task2);
    await taskRepository.save(task3);
    await taskRepository.save(task4);
  });

  afterEach(() => {
    database.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  describe('output operations', () => {
    it('should save task output', async () => {
      const taskId = TaskId('test-task-1');
      const output = {
        taskId,
        stdout: ['Line 1', 'Line 2'],
        stderr: ['Error 1'],
        totalSize: 100
      };

      const result = await repository.save(taskId, output);

      if (!result.ok) {
        console.error('Save failed:', result.error);
      }
      expect(result.ok).toBe(true);
      
      const retrieved = await repository.get(taskId);
      expect(retrieved.ok).toBe(true);
      if (retrieved.ok && retrieved.value) {
        expect(retrieved.value.stdout).toEqual(['Line 1', 'Line 2']);
        expect(retrieved.value.stderr).toEqual(['Error 1']);
      }
    });

    it('should append to output', async () => {
      const taskId = TaskId('test-task-2');
      
      // Save initial output
      await repository.save(taskId, {
        taskId,
        stdout: ['Initial'],
        stderr: [],
        totalSize: 7
      });

      // Append stdout
      const appendResult = await repository.append(taskId, 'stdout', 'Appended line');
      
      expect(appendResult.ok).toBe(true);

      const retrieved = await repository.get(taskId);
      expect(retrieved.ok).toBe(true);
      if (retrieved.ok && retrieved.value) {
        expect(retrieved.value.stdout).toEqual(['Initial', 'Appended line']);
      }
    });

    it('should handle large outputs with file fallback', async () => {
      const taskId = TaskId('test-task-3');
      const largeOutput = 'x'.repeat(1024 * 1024); // 1MB
      
      const output = {
        taskId,
        stdout: [largeOutput],
        stderr: [],
        totalSize: largeOutput.length
      };

      const result = await repository.save(taskId, output);
      
      expect(result.ok).toBe(true);

      const retrieved = await repository.get(taskId);
      expect(retrieved.ok).toBe(true);
      if (retrieved.ok && retrieved.value) {
        expect(retrieved.value.stdout[0].length).toBe(1024 * 1024);
      }
    });

    it('should delete task output', async () => {
      const taskId = TaskId('test-task-4');
      
      await repository.save(taskId, {
        taskId,
        stdout: ['To be deleted'],
        stderr: [],
        totalSize: 13
      });

      const deleteResult = await repository.delete(taskId);
      expect(deleteResult.ok).toBe(true);

      const retrieved = await repository.get(taskId);
      expect(retrieved.ok).toBe(true);
      if (retrieved.ok) {
        expect(retrieved.value).toBeNull();
      }
    });

    it('should return null for non-existent output', async () => {
      const result = await repository.get(TaskId('non-existent'));
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });
});