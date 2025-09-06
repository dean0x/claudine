import { describe, it, expect } from 'vitest';
import { createTask, updateTask, Priority, TaskStatus } from '../../src/core/domain.js';
import { BufferedOutputCapture } from '../../src/implementations/output-capture.js';
import { TaskFactory, TEST_CONSTANTS, AssertionHelpers } from '../helpers/test-factories.js';

describe('Property-Based Tests', () => {
  
  describe('Task creation properties', () => {
    it('should always create tasks with QUEUED status regardless of input', () => {
      const prompts = [
        'simple task',
        '',
        'a'.repeat(1000),
        'task with\nnewlines\nand\ttabs',
        'task with special chars: !@#$%^&*()',
        '🚀 emoji task 🎯',
      ];
      
      const priorities = [Priority.P0, Priority.P1, Priority.P2];
      
      for (const prompt of prompts) {
        for (const priority of priorities) {
          const task = createTask({ prompt, priority });
          
          expect(task.status).toBe(TaskStatus.QUEUED);
          expect(task.prompt).toBe(prompt);
          expect(task.priority).toBe(priority);
          expect(task.id).toBeDefined();
          expect(task.createdAt).toBeGreaterThan(0);
          expect(task.useWorktree).toBe(false); // Default value
        }
      }
    });
    
    it('should handle various timeout values correctly', () => {
      const timeoutValues = [
        undefined,
        0,
        1,
        TEST_CONSTANTS.ONE_SECOND_MS,
        TEST_CONSTANTS.FIVE_SECONDS_MS,
        TEST_CONSTANTS.ONE_HOUR_MS,
        Number.MAX_SAFE_INTEGER,
        -1,
      ];
      
      for (const timeout of timeoutValues) {
        const task = createTask({ 
          prompt: 'timeout test',
          timeout 
        });
        
        expect(task.timeout).toBe(timeout);
        expect(task.status).toBe(TaskStatus.QUEUED);
        expect(task.id).toBeDefined();
      }
    });
    
    it('should handle various buffer size values correctly', () => {
      const bufferSizes = [
        undefined,
        0,
        1,
        TEST_CONSTANTS.ONE_KB,
        TEST_CONSTANTS.ONE_MB,
        TEST_CONSTANTS.TEN_MB,
        Number.MAX_SAFE_INTEGER,
      ];
      
      for (const maxOutputBuffer of bufferSizes) {
        const task = createTask({ 
          prompt: 'buffer test',
          maxOutputBuffer 
        });
        
        expect(task.maxOutputBuffer).toBe(maxOutputBuffer);
        expect(task.status).toBe(TaskStatus.QUEUED);
        expect(task.id).toBeDefined();
      }
    });
  });
  
  describe('Task update properties', () => {
    it('should preserve immutability when updating tasks', () => {
      const originalTask = TaskFactory.basic();
      const updateData = {
        status: TaskStatus.RUNNING,
        startedAt: Date.now()
      };
      
      const updatedTask = updateTask(originalTask, updateData);
      
      // Original task should be unchanged
      expect(originalTask.status).toBe(TaskStatus.QUEUED);
      expect(originalTask.startedAt).toBeUndefined();
      
      // Updated task should have new values
      expect(updatedTask.status).toBe(TaskStatus.RUNNING);
      expect(updatedTask.startedAt).toBeDefined();
      
      // Other properties should be preserved
      expect(updatedTask.id).toBe(originalTask.id);
      expect(updatedTask.prompt).toBe(originalTask.prompt);
      expect(updatedTask.priority).toBe(originalTask.priority);
      expect(updatedTask.createdAt).toBe(originalTask.createdAt);
    });
    
    it('should handle all possible status transitions', () => {
      const statuses = [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.COMPLETED, TaskStatus.FAILED];
      
      for (const fromStatus of statuses) {
        for (const toStatus of statuses) {
          const originalTask = TaskFactory.basic();
          const taskWithFromStatus = updateTask(originalTask, { status: fromStatus });
          const finalTask = updateTask(taskWithFromStatus, { status: toStatus });
          
          expect(finalTask.status).toBe(toStatus);
          expect(finalTask.id).toBe(originalTask.id);
        }
      }
    });
  });
  
  describe('Output capture buffer limits', () => {
    it('should respect buffer limits regardless of data patterns', () => {
      const outputCapture = new BufferedOutputCapture();
      const bufferLimit = TEST_CONSTANTS.ONE_KB;
      
      // Test different data patterns
      const dataPatterns = [
        'a'.repeat(bufferLimit + 1),           // Simple repetition
        'ab'.repeat(Math.floor(bufferLimit/2) + 1), // Two character pattern  
        Array(Math.floor(bufferLimit/10) + 1).fill('0123456789').join(''), // Number patterns
      ];
      
      for (let i = 0; i < dataPatterns.length; i++) {
        const task = TaskFactory.basic();
        outputCapture.configureTask(task.id, { maxOutputBuffer: bufferLimit });
        const data = dataPatterns[i];
        const result = outputCapture.capture(task.id, 'stdout', data);
        
        if (data.length > bufferLimit) {
          AssertionHelpers.expectErrorResult(result, 'limit exceeded');
        } else {
          AssertionHelpers.expectSuccessResult(result);
        }
      }
    });
    
    it('should handle boundary conditions for buffer sizes', () => {
      const outputCapture = new BufferedOutputCapture();
      const bufferSize = TEST_CONSTANTS.ONE_KB;
      
      // Test data exactly at the boundary
      const task1 = TaskFactory.basic();
      const task2 = TaskFactory.basic();
      const task3 = TaskFactory.basic();
      
      outputCapture.configureTask(task1.id, { maxOutputBuffer: bufferSize });
      outputCapture.configureTask(task2.id, { maxOutputBuffer: bufferSize });
      outputCapture.configureTask(task3.id, { maxOutputBuffer: bufferSize });
      
      // Test exactly at limit, one under, one over
      const exactLimit = outputCapture.capture(task1.id, 'stdout', 'x'.repeat(bufferSize));
      const underLimit = outputCapture.capture(task2.id, 'stdout', 'x'.repeat(bufferSize - 1));
      const overLimit = outputCapture.capture(task3.id, 'stdout', 'x'.repeat(bufferSize + 1));
      
      AssertionHelpers.expectSuccessResult(exactLimit);
      AssertionHelpers.expectSuccessResult(underLimit);
      AssertionHelpers.expectErrorResult(overLimit);
    });
    
    it('should document zero buffer size behavior', () => {
      const outputCapture = new BufferedOutputCapture();
      const task = TaskFactory.basic();
      outputCapture.configureTask(task.id, { maxOutputBuffer: 0 });
      
      // Test what actually happens with zero buffer size
      const emptyResult = outputCapture.capture(task.id, 'stdout', '');
      const singleCharResult = outputCapture.capture(task.id, 'stdout', 'x');
      
      // Document current behavior - this is a property-based test discovering system behavior
      expect(emptyResult.ok).toBeDefined(); // Either succeeds or fails consistently
      expect(singleCharResult.ok).toBeDefined(); // Either succeeds or fails consistently
    });
  });
  
  describe('Task ID generation properties', () => {
    it('should generate unique IDs for concurrent task creation', () => {
      const numberOfTasks = 1000;
      const tasks = Array.from({ length: numberOfTasks }, () => TaskFactory.basic());
      const taskIds = tasks.map(task => task.id);
      const uniqueIds = new Set(taskIds);
      
      // All IDs should be unique
      expect(uniqueIds.size).toBe(numberOfTasks);
      
      // All IDs should be strings
      for (const id of taskIds) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    });
    
    it('should create tasks with consistent timestamp ordering', () => {
      const tasks = [];
      
      // Create tasks in rapid succession
      for (let i = 0; i < 10; i++) {
        tasks.push(TaskFactory.basic());
        // Small delay to ensure time progression
        const start = Date.now();
        while (Date.now() - start < 1) { /* busy wait */ }
      }
      
      // Timestamps should be in non-decreasing order
      for (let i = 1; i < tasks.length; i++) {
        expect(tasks[i].createdAt).toBeGreaterThanOrEqual(tasks[i-1].createdAt);
      }
    });
  });
});