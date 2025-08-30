import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Database } from '../../src/implementations/database.js';
import { SQLiteTaskRepository } from '../../src/implementations/task-repository.js';
import { createTask, TaskId, Priority, TaskStatus, updateTask } from '../../src/core/domain.js';

describe('SQLiteTaskRepository', () => {
  let database: Database;
  let repository: SQLiteTaskRepository;
  const testDbPath = path.join(os.tmpdir(), 'claudine-test', 'repo-test.db');
  const testDataDir = path.dirname(testDbPath);

  beforeEach(() => {
    // Clean up before each test
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
    
    database = new Database(testDbPath);
    repository = new SQLiteTaskRepository(database);
  });

  afterEach(() => {
    database.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  describe('retrieve operations', () => {
    it('should find task by ID', async () => {
      const task = createTask({
        prompt: 'Find me',
        priority: Priority.P1
      });

      await repository.save(task);

      const result = await repository.findById(task.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeTruthy();
        expect(result.value?.id).toBe(task.id);
        expect(result.value?.prompt).toBe('Find me');
      }
    });

    it('should return null for non-existent task', async () => {
      const result = await repository.findById(TaskId('non-existent'));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should find all tasks', async () => {
      const task1 = createTask({ prompt: 'Task 1', priority: Priority.P2 });
      const task2 = createTask({ prompt: 'Task 2', priority: Priority.P1 });
      const task3 = createTask({ prompt: 'Task 3', priority: Priority.P0 });

      await repository.save(task1);
      await repository.save(task2);
      await repository.save(task3);

      const result = await repository.findAll();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        const prompts = result.value.map(t => t.prompt);
        expect(prompts).toContain('Task 1');
        expect(prompts).toContain('Task 2');
        expect(prompts).toContain('Task 3');
      }
    });

    it('should find tasks by status', async () => {
      const task1 = createTask({ prompt: 'Queued 1', priority: Priority.P2 });
      const task2 = createTask({ prompt: 'Queued 2', priority: Priority.P1 });
      const task3 = updateTask(
        createTask({ prompt: 'Running', priority: Priority.P0 }),
        { status: TaskStatus.RUNNING }
      );

      await repository.save(task1);
      await repository.save(task2);
      await repository.save(task3);

      const queuedResult = await repository.findByStatus(TaskStatus.QUEUED);
      const runningResult = await repository.findByStatus(TaskStatus.RUNNING);

      expect(queuedResult.ok).toBe(true);
      expect(runningResult.ok).toBe(true);
      
      if (queuedResult.ok) {
        expect(queuedResult.value).toHaveLength(2);
      }
      if (runningResult.ok) {
        expect(runningResult.value).toHaveLength(1);
        expect(runningResult.value[0].prompt).toBe('Running');
      }
    });
  });

  describe('save operations', () => {
    it('should save a new task', async () => {
      const task = createTask({
        prompt: 'Test task',
        priority: Priority.P2,
        workingDirectory: '/test/dir',
        useWorktree: false
      });

      const result = await repository.save(task);

      expect(result.ok).toBe(true);
      
      // Verify it was saved
      const found = await repository.findById(task.id);
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.value).toBeTruthy();
        expect(found.value?.prompt).toBe('Test task');
      }
    });

    it('should update an existing task', async () => {
      const task = createTask({
        prompt: 'Original prompt',
        priority: Priority.P2
      });

      // Save initial task
      await repository.save(task);

      // Update task
      const updatedTask = updateTask(task, {
        status: TaskStatus.RUNNING,
        startedAt: Date.now()
      });

      const result = await repository.save(updatedTask);

      expect(result.ok).toBe(true);

      // Verify update
      const found = await repository.findById(task.id);
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.value?.status).toBe(TaskStatus.RUNNING);
        expect(found.value?.startedAt).toBeTruthy();
      }
    });

    it('should handle save errors gracefully', async () => {
      const task = createTask({
        prompt: 'Test task',
        priority: Priority.P2
      });

      // Close database to cause error
      database.close();

      const result = await repository.save(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('database');
      }
    });

    it('should save all task fields correctly', async () => {
      const now = Date.now();
      const task = {
        id: TaskId('test-123'),
        prompt: 'Complex task',
        status: TaskStatus.COMPLETED,
        priority: Priority.P0,
        workingDirectory: '/work/dir',
        useWorktree: true,
        createdAt: now,
        startedAt: now + 1000,
        completedAt: now + 2000,
        workerId: 'worker-456' as any,
        exitCode: 0
      };

      const result = await repository.save(task);
      expect(result.ok).toBe(true);

      const found = await repository.findById(task.id);
      expect(found.ok).toBe(true);
      if (found.ok && found.value) {
        expect(found.value.prompt).toBe('Complex task');
        expect(found.value.status).toBe(TaskStatus.COMPLETED);
        expect(found.value.priority).toBe(Priority.P0);
        expect(found.value.workingDirectory).toBe('/work/dir');
        expect(found.value.useWorktree).toBe(true);
        expect(found.value.exitCode).toBe(0);
      }
    });
  });
});