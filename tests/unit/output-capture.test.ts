import { describe, it, expect, beforeEach } from 'vitest';
import { BufferedOutputCapture } from '../../src/implementations/output-capture.js';
import { TaskId } from '../../src/core/domain.js';
import { TestDataFactory, TEST_CONSTANTS, AssertionHelpers } from '../helpers/test-factories.js';

describe('BufferedOutputCapture Per-task Limits', () => {
  let outputCapture: BufferedOutputCapture;
  const taskId = TaskId('test-task');
  const smallData = TestDataFactory.smallData(TEST_CONSTANTS.SMALL_DATA_SIZE);
  const largeData = TestDataFactory.largeData(TEST_CONSTANTS.LARGE_DATA_SIZE);

  beforeEach(() => {
    outputCapture = new BufferedOutputCapture();
  });

  describe('per-task buffer configuration', () => {
    it('should accept per-task buffer limits during task setup', () => {
      const result = outputCapture.configureTask(taskId, {
        maxOutputBuffer: TEST_CONSTANTS.ONE_KB
      });
      
      AssertionHelpers.expectSuccessResult(result);
    });

    it('should use per-task limit when configured', () => {
      // Configure task with small buffer limit
      outputCapture.configureTask(taskId, {
        maxOutputBuffer: TEST_CONSTANTS.ONE_KB
      });

      // Try to capture large data - should fail
      const result = outputCapture.capture(taskId, 'stdout', largeData);
      
      const error = AssertionHelpers.expectErrorResult(result, 'Output buffer limit exceeded');
      expect(error.context).toEqual(
        expect.objectContaining({
          maxSize: TEST_CONSTANTS.ONE_KB,
          currentSize: expect.any(Number)
        })
      );
    });

    it('should use global limit when no per-task limit configured', () => {
      // Don't configure per-task limit, use default global limit (10MB)
      
      // Small data should succeed
      const result = outputCapture.capture(taskId, 'stdout', smallData);
      AssertionHelpers.expectSuccessResult(result);
    });

    it('should allow different limits for different tasks', () => {
      const task1 = TaskId('task-1');
      const task2 = TaskId('task-2');
      
      // Configure different limits
      const smallLimit = 500; // 500 bytes
      const largeLimit = TEST_CONSTANTS.FIVE_KB;
      
      outputCapture.configureTask(task1, { maxOutputBuffer: smallLimit });
      outputCapture.configureTask(task2, { maxOutputBuffer: largeLimit });
      
      // Task 1 should fail with large data
      const result1 = outputCapture.capture(task1, 'stdout', largeData);
      AssertionHelpers.expectErrorResult(result1, 'Output buffer limit exceeded');
      
      // Task 2 should succeed with same large data
      const result2 = outputCapture.capture(task2, 'stdout', largeData);
      AssertionHelpers.expectSuccessResult(result2);
    });

    it('should clean up per-task configuration when task completes', () => {
      outputCapture.configureTask(taskId, { maxOutputBuffer: TEST_CONSTANTS.ONE_KB });
      
      // Cleanup should succeed
      const result = outputCapture.cleanup(taskId);
      AssertionHelpers.expectSuccessResult(result);
      
      // After cleanup, should use global limit again (10MB default)
      const captureResult = outputCapture.capture(taskId, 'stdout', largeData);
      AssertionHelpers.expectSuccessResult(captureResult); // Should use global 10MB limit
    });
  });
});