import { describe, it, expect, beforeEach } from 'vitest';
import { BufferedOutputCapture } from '../../src/implementations/output-capture.js';
import { TaskId } from '../../src/core/domain.js';

describe('BufferedOutputCapture Per-task Limits', () => {
  let outputCapture: BufferedOutputCapture;
  const taskId = TaskId('test-task');
  const smallData = 'a'.repeat(100); // 100 bytes
  const largeData = 'b'.repeat(2000); // 2KB

  beforeEach(() => {
    outputCapture = new BufferedOutputCapture();
  });

  describe('per-task buffer configuration', () => {
    it('should accept per-task buffer limits during task setup', () => {
      const result = outputCapture.configureTask(taskId, {
        maxOutputBuffer: 1024 // 1KB
      });
      
      expect(result.ok).toBe(true);
    });

    it('should use per-task limit when configured', () => {
      // Configure task with 1KB limit
      outputCapture.configureTask(taskId, {
        maxOutputBuffer: 1024
      });

      // Try to capture 2KB of data - should fail
      const result = outputCapture.capture(taskId, 'stdout', largeData);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Output buffer limit exceeded');
      }
    });

    it('should use global limit when no per-task limit configured', () => {
      // Don't configure per-task limit, use default global limit (10MB)
      
      // Small data should succeed
      const result = outputCapture.capture(taskId, 'stdout', smallData);
      expect(result.ok).toBe(true);
    });

    it('should allow different limits for different tasks', () => {
      const task1 = TaskId('task-1');
      const task2 = TaskId('task-2');
      
      // Configure different limits
      outputCapture.configureTask(task1, { maxOutputBuffer: 500 }); // 500 bytes
      outputCapture.configureTask(task2, { maxOutputBuffer: 5000 }); // 5KB
      
      // Task 1 should fail with large data
      const result1 = outputCapture.capture(task1, 'stdout', largeData);
      expect(result1.ok).toBe(false);
      
      // Task 2 should succeed with same large data
      const result2 = outputCapture.capture(task2, 'stdout', largeData);
      expect(result2.ok).toBe(true);
    });

    it('should clean up per-task configuration when task completes', () => {
      outputCapture.configureTask(taskId, { maxOutputBuffer: 1024 });
      
      // Cleanup should succeed
      const result = outputCapture.cleanup(taskId);
      expect(result.ok).toBe(true);
      
      // After cleanup, should use global limit again
      const captureResult = outputCapture.capture(taskId, 'stdout', largeData);
      expect(captureResult.ok).toBe(true); // Should use global 10MB limit
    });
  });
});