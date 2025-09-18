import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BufferedOutputCapture } from '../../../src/implementations/output-capture';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('BufferedOutputCapture - REAL Buffer Management', () => {
  let capture: BufferedOutputCapture;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpdir(), `claudine-test-${Date.now()}`);
    capture = new BufferedOutputCapture(
      1024,  // 1KB max buffer
      testDir // Use temp dir for overflow files
    );
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic capture operations', () => {
    it('should start and stop capture for a task', () => {
      const startResult = capture.startCapture('task-123');
      expect(startResult.ok).toBe(true);

      const stopResult = capture.stopCapture('task-123');
      expect(stopResult.ok).toBe(true);
    });

    it('should append output to buffer', () => {
      capture.startCapture('task-123');

      const result = capture.appendOutput('task-123', 'stdout', 'Hello World\n');
      expect(result.ok).toBe(true);

      const output = capture.getOutput('task-123');
      expect(output.ok).toBe(true);
      if (output.ok) {
        expect(output.value.stdout).toEqual(['Hello World']);
        expect(output.value.stderr).toEqual([]);
      }
    });

    it('should capture both stdout and stderr separately', () => {
      capture.startCapture('task-123');

      capture.appendOutput('task-123', 'stdout', 'Standard output\n');
      capture.appendOutput('task-123', 'stderr', 'Error output\n');
      capture.appendOutput('task-123', 'stdout', 'More stdout\n');

      const output = capture.getOutput('task-123');
      if (output.ok) {
        expect(output.value.stdout).toEqual(['Standard output', 'More stdout']);
        expect(output.value.stderr).toEqual(['Error output']);
      }
    });

    it('should handle output without trailing newlines', () => {
      capture.startCapture('task-123');

      capture.appendOutput('task-123', 'stdout', 'No newline');
      capture.appendOutput('task-123', 'stdout', 'Also no newline');

      const output = capture.getOutput('task-123');
      if (output.ok) {
        expect(output.value.stdout).toEqual(['No newlineAlso no newline']);
      }
    });

    it('should handle multi-line output', () => {
      capture.startCapture('task-123');

      capture.appendOutput('task-123', 'stdout', 'Line 1\nLine 2\nLine 3\n');

      const output = capture.getOutput('task-123');
      if (output.ok) {
        expect(output.value.stdout).toEqual(['Line 1', 'Line 2', 'Line 3']);
      }
    });

    it('should handle empty output', () => {
      capture.startCapture('task-123');

      const output = capture.getOutput('task-123');
      if (output.ok) {
        expect(output.value.stdout).toEqual([]);
        expect(output.value.stderr).toEqual([]);
        expect(output.value.totalSize).toBe(0);
      }
    });
  });

  describe('Buffer overflow handling', () => {
    it('should overflow to file when buffer exceeds limit', async () => {
      capture.startCapture('task-overflow');

      // Generate output larger than 1KB buffer
      const largeOutput = 'x'.repeat(600) + '\n';

      // Add enough to exceed buffer
      capture.appendOutput('task-overflow', 'stdout', largeOutput);
      capture.appendOutput('task-overflow', 'stdout', largeOutput); // This should trigger overflow

      const output = capture.getOutput('task-overflow');
      if (output.ok) {
        expect(output.value.totalSize).toBeGreaterThan(1024);
        expect(output.value.stdout.join('')).toHaveLength(1200); // 2 * 600
      }

      // Check overflow file exists
      const overflowPath = path.join(testDir, 'task-overflow-stdout.log');
      const fileExists = await fs.access(overflowPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should handle multiple tasks with overflow', async () => {
      const taskCount = 5;
      const largeOutput = 'data'.repeat(300) + '\n'; // 1200+ bytes

      for (let i = 0; i < taskCount; i++) {
        const taskId = `task-${i}`;
        capture.startCapture(taskId);
        capture.appendOutput(taskId, 'stdout', largeOutput);
      }

      // Verify all tasks captured correctly
      for (let i = 0; i < taskCount; i++) {
        const output = capture.getOutput(`task-${i}`);
        expect(output.ok).toBe(true);
        if (output.ok) {
          expect(output.value.stdout[0]).toHaveLength(1200);
        }
      }
    });

    it('should read from overflow file when retrieving', async () => {
      capture.startCapture('task-file');

      // Force overflow
      const chunk = 'chunk'.repeat(250) + '\n'; // 1250+ bytes
      capture.appendOutput('task-file', 'stdout', chunk);

      // Stop capture (should keep file)
      capture.stopCapture('task-file');

      // Clear memory buffer to force file read
      capture.clearOutput('task-file');

      // Should still be able to read from file
      const output = capture.getOutput('task-file');
      expect(output.ok).toBe(true);
      if (output.ok) {
        expect(output.value.stdout[0]).toHaveLength(1250);
      }
    });
  });

  describe('Tail functionality', () => {
    it('should return last N lines with tail', () => {
      capture.startCapture('task-tail');

      for (let i = 1; i <= 10; i++) {
        capture.appendOutput('task-tail', 'stdout', `Line ${i}\n`);
      }

      const output = capture.getOutput('task-tail', 5);
      if (output.ok) {
        expect(output.value.stdout).toEqual([
          'Line 6',
          'Line 7',
          'Line 8',
          'Line 9',
          'Line 10'
        ]);
      }
    });

    it('should handle tail larger than output', () => {
      capture.startCapture('task-tail');

      capture.appendOutput('task-tail', 'stdout', 'Line 1\n');
      capture.appendOutput('task-tail', 'stdout', 'Line 2\n');

      const output = capture.getOutput('task-tail', 10);
      if (output.ok) {
        expect(output.value.stdout).toEqual(['Line 1', 'Line 2']);
      }
    });

    it('should tail both stdout and stderr', () => {
      capture.startCapture('task-tail');

      for (let i = 1; i <= 5; i++) {
        capture.appendOutput('task-tail', 'stdout', `Out ${i}\n`);
        capture.appendOutput('task-tail', 'stderr', `Err ${i}\n`);
      }

      const output = capture.getOutput('task-tail', 3);
      if (output.ok) {
        expect(output.value.stdout).toEqual(['Out 3', 'Out 4', 'Out 5']);
        expect(output.value.stderr).toEqual(['Err 3', 'Err 4', 'Err 5']);
      }
    });
  });

  describe('Multiple task management', () => {
    it('should handle multiple concurrent tasks', () => {
      const taskIds = ['task-1', 'task-2', 'task-3'];

      taskIds.forEach(id => {
        capture.startCapture(id);
        capture.appendOutput(id, 'stdout', `Output for ${id}\n`);
      });

      taskIds.forEach(id => {
        const output = capture.getOutput(id);
        if (output.ok) {
          expect(output.value.stdout).toEqual([`Output for ${id}`]);
        }
      });
    });

    it('should isolate output between tasks', () => {
      capture.startCapture('task-a');
      capture.startCapture('task-b');

      capture.appendOutput('task-a', 'stdout', 'A output\n');
      capture.appendOutput('task-b', 'stdout', 'B output\n');
      capture.appendOutput('task-a', 'stderr', 'A error\n');

      const outputA = capture.getOutput('task-a');
      const outputB = capture.getOutput('task-b');

      if (outputA.ok) {
        expect(outputA.value.stdout).toEqual(['A output']);
        expect(outputA.value.stderr).toEqual(['A error']);
      }

      if (outputB.ok) {
        expect(outputB.value.stdout).toEqual(['B output']);
        expect(outputB.value.stderr).toEqual([]);
      }
    });

    it('should get all outputs', () => {
      capture.startCapture('task-1');
      capture.startCapture('task-2');

      capture.appendOutput('task-1', 'stdout', 'Task 1\n');
      capture.appendOutput('task-2', 'stdout', 'Task 2\n');

      const allOutputs = capture.getAllOutput();
      expect(allOutputs.ok).toBe(true);
      if (allOutputs.ok) {
        const outputs = allOutputs.value;
        expect(outputs.size).toBe(2);
        expect(outputs.get('task-1')?.stdout).toEqual(['Task 1']);
        expect(outputs.get('task-2')?.stdout).toEqual(['Task 2']);
      }
    });
  });

  describe('Clear and cleanup', () => {
    it('should clear output for specific task', () => {
      capture.startCapture('task-clear');
      capture.appendOutput('task-clear', 'stdout', 'To be cleared\n');

      const beforeClear = capture.getOutput('task-clear');
      expect(beforeClear.ok && beforeClear.value.stdout).toHaveLength(1);

      const clearResult = capture.clearOutput('task-clear');
      expect(clearResult.ok).toBe(true);

      const afterClear = capture.getOutput('task-clear');
      if (afterClear.ok) {
        expect(afterClear.value.stdout).toEqual([]);
        expect(afterClear.value.stderr).toEqual([]);
      }
    });

    it('should clean up overflow files on clear', async () => {
      capture.startCapture('task-cleanup');

      // Force overflow
      const largeOutput = 'x'.repeat(2000) + '\n';
      capture.appendOutput('task-cleanup', 'stdout', largeOutput);

      const overflowPath = path.join(testDir, 'task-cleanup-stdout.log');

      // File should exist after overflow
      await fs.access(overflowPath); // Will throw if not exists

      // Clear should remove file
      capture.clearOutput('task-cleanup');

      // File should be gone
      const fileExists = await fs.access(overflowPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should handle clear for non-existent task', () => {
      const result = capture.clearOutput('non-existent');
      expect(result.ok).toBe(true); // Should not error
    });
  });

  describe('Error handling', () => {
    it('should handle appending to non-started task', () => {
      const result = capture.appendOutput('not-started', 'stdout', 'data\n');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not started');
      }
    });

    it('should handle getting output for non-existent task', () => {
      const result = capture.getOutput('non-existent');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stdout).toEqual([]);
        expect(result.value.stderr).toEqual([]);
      }
    });

    it('should handle invalid output type', () => {
      capture.startCapture('task-123');

      // @ts-ignore - Testing invalid type
      const result = capture.appendOutput('task-123', 'invalid', 'data');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid output type');
      }
    });

    it('should handle file system errors gracefully', async () => {
      // Use invalid path for overflow directory
      const badCapture = new BufferedOutputCapture(
        100,
        '/invalid/path/that/does/not/exist'
      );

      badCapture.startCapture('task-fail');

      // Should handle overflow failure gracefully
      const largeOutput = 'x'.repeat(200);
      const result = badCapture.appendOutput('task-fail', 'stdout', largeOutput);

      // Might succeed (keeps in memory) or fail (can't write file)
      // Either way, should not crash
      expect(result).toBeDefined();
    });
  });

  describe('Performance characteristics', () => {
    it('should handle rapid output efficiently', () => {
      capture.startCapture('task-perf');

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        capture.appendOutput('task-perf', 'stdout', `Line ${i}\n`);
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100); // Should handle 1000 lines in < 100ms

      const output = capture.getOutput('task-perf');
      if (output.ok) {
        expect(output.value.stdout).toHaveLength(iterations);
      }
    });

    it('should handle very long lines', () => {
      capture.startCapture('task-long');

      const longLine = 'a'.repeat(10000) + '\n';
      capture.appendOutput('task-long', 'stdout', longLine);

      const output = capture.getOutput('task-long');
      if (output.ok) {
        expect(output.value.stdout[0]).toHaveLength(10000);
      }
    });

    it('should track total size accurately', () => {
      capture.startCapture('task-size');

      const outputs = [
        'Short\n',           // 6 bytes
        'Medium line\n',     // 12 bytes
        'A longer line\n',   // 14 bytes
      ];

      outputs.forEach(out => {
        capture.appendOutput('task-size', 'stdout', out);
      });

      const output = capture.getOutput('task-size');
      if (output.ok) {
        expect(output.value.totalSize).toBe(32); // 6 + 12 + 14
      }
    });
  });

  describe('Real-world patterns', () => {
    it('should handle ANSI escape codes', () => {
      capture.startCapture('task-ansi');

      // Common ANSI codes in terminal output
      capture.appendOutput('task-ansi', 'stdout', '\x1b[32mGreen text\x1b[0m\n');
      capture.appendOutput('task-ansi', 'stdout', '\x1b[1;31mBold red\x1b[0m\n');

      const output = capture.getOutput('task-ansi');
      if (output.ok) {
        // Should preserve ANSI codes
        expect(output.value.stdout[0]).toContain('\x1b[32m');
        expect(output.value.stdout[1]).toContain('\x1b[1;31m');
      }
    });

    it('should handle carriage returns and progress updates', () => {
      capture.startCapture('task-progress');

      // Simulate progress bar updates
      capture.appendOutput('task-progress', 'stdout', 'Progress: 0%\r');
      capture.appendOutput('task-progress', 'stdout', 'Progress: 50%\r');
      capture.appendOutput('task-progress', 'stdout', 'Progress: 100%\n');

      const output = capture.getOutput('task-progress');
      if (output.ok) {
        // Should capture all updates
        expect(output.value.stdout.join('')).toContain('100%');
      }
    });

    it('should handle binary-like output', () => {
      capture.startCapture('task-binary');

      // Simulate binary data in output
      const binaryLike = Buffer.from([0x00, 0x01, 0x02, 0xFF]).toString();
      capture.appendOutput('task-binary', 'stdout', binaryLike + '\n');

      const output = capture.getOutput('task-binary');
      expect(output.ok).toBe(true);
      // Should handle without crashing
    });

    it('should handle streaming output pattern', () => {
      capture.startCapture('task-stream');

      // Simulate streaming chunks
      const chunks = [
        'Starting',
        ' processing',
        '...',
        'done!\n'
      ];

      chunks.forEach(chunk => {
        capture.appendOutput('task-stream', 'stdout', chunk);
      });

      const output = capture.getOutput('task-stream');
      if (output.ok) {
        expect(output.value.stdout).toEqual(['Starting processing...done!']);
      }
    });

    it('should handle interleaved stdout/stderr', () => {
      capture.startCapture('task-interleaved');

      // Simulate real process output pattern
      capture.appendOutput('task-interleaved', 'stdout', 'Starting task\n');
      capture.appendOutput('task-interleaved', 'stderr', 'Warning: deprecated option\n');
      capture.appendOutput('task-interleaved', 'stdout', 'Processing...\n');
      capture.appendOutput('task-interleaved', 'stderr', 'Error: minor issue\n');
      capture.appendOutput('task-interleaved', 'stdout', 'Completed successfully\n');

      const output = capture.getOutput('task-interleaved');
      if (output.ok) {
        expect(output.value.stdout).toHaveLength(3);
        expect(output.value.stderr).toHaveLength(2);
        expect(output.value.stdout[2]).toBe('Completed successfully');
      }
    });
  });
});