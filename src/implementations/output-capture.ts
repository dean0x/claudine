/**
 * Output capture implementation
 * Manages stdout/stderr for tasks with size limits
 */

import { OutputCapture } from '../core/interfaces.js';
import { TaskId, TaskOutput } from '../core/domain.js';
import { Result, ok, err } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

interface OutputBuffer {
  stdout: string[];
  stderr: string[];
  totalSize: number;
}

export class BufferedOutputCapture implements OutputCapture {
  private readonly buffers = new Map<TaskId, OutputBuffer>();
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 10 * 1024 * 1024) { // 10MB default
    this.maxBufferSize = maxBufferSize;
  }

  capture(taskId: TaskId, type: 'stdout' | 'stderr', data: string): Result<void> {
    let buffer = this.buffers.get(taskId);
    
    if (!buffer) {
      buffer = {
        stdout: [],
        stderr: [],
        totalSize: 0,
      };
      this.buffers.set(taskId, buffer);
    }

    const dataSize = Buffer.byteLength(data, 'utf8');
    
    // Check if adding this would exceed the limit
    if (buffer.totalSize + dataSize > this.maxBufferSize) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Output buffer limit exceeded for task ${taskId}`,
        { currentSize: buffer.totalSize, maxSize: this.maxBufferSize }
      ));
    }

    // Add to appropriate buffer
    if (type === 'stdout') {
      buffer.stdout.push(data);
    } else {
      buffer.stderr.push(data);
    }
    
    buffer.totalSize += dataSize;
    
    return ok(undefined);
  }

  getOutput(taskId: TaskId, tail?: number): Result<TaskOutput> {
    const buffer = this.buffers.get(taskId);
    
    if (!buffer) {
      // Return empty output if not found
      return ok({
        taskId,
        stdout: Object.freeze([]),
        stderr: Object.freeze([]),
        totalSize: 0,
      });
    }

    let stdout = buffer.stdout;
    let stderr = buffer.stderr;

    // Apply tail if specified
    if (tail !== undefined && tail > 0) {
      stdout = stdout.slice(-tail);
      stderr = stderr.slice(-tail);
    }

    return ok({
      taskId,
      stdout: Object.freeze([...stdout]),
      stderr: Object.freeze([...stderr]),
      totalSize: buffer.totalSize,
    });
  }

  clear(taskId: TaskId): Result<void> {
    this.buffers.delete(taskId);
    return ok(undefined);
  }

  // Helper to get buffer size
  getBufferSize(taskId: TaskId): number {
    const buffer = this.buffers.get(taskId);
    return buffer?.totalSize || 0;
  }

  // Helper to clear old buffers
  clearOldBuffers(keepCount = 10): void {
    if (this.buffers.size <= keepCount) {
      return;
    }

    // Get task IDs sorted by insertion order (Map maintains insertion order)
    const taskIds = Array.from(this.buffers.keys());
    const toRemove = taskIds.slice(0, taskIds.length - keepCount);
    
    for (const taskId of toRemove) {
      this.buffers.delete(taskId);
    }
  }
}

/**
 * Test implementation that stores output in memory
 */
export class TestOutputCapture implements OutputCapture {
  private readonly outputs = new Map<TaskId, { stdout: string[]; stderr: string[] }>();

  capture(taskId: TaskId, type: 'stdout' | 'stderr', data: string): Result<void> {
    let output = this.outputs.get(taskId);
    
    if (!output) {
      output = { stdout: [], stderr: [] };
      this.outputs.set(taskId, output);
    }

    if (type === 'stdout') {
      output.stdout.push(data);
    } else {
      output.stderr.push(data);
    }

    return ok(undefined);
  }

  getOutput(taskId: TaskId, tail?: number): Result<TaskOutput> {
    const output = this.outputs.get(taskId);
    
    if (!output) {
      return ok({
        taskId,
        stdout: Object.freeze([]),
        stderr: Object.freeze([]),
        totalSize: 0,
      });
    }

    let stdout = output.stdout;
    let stderr = output.stderr;

    if (tail !== undefined && tail > 0) {
      stdout = stdout.slice(-tail);
      stderr = stderr.slice(-tail);
    }

    const totalSize = stdout.join('').length + stderr.join('').length;

    return ok({
      taskId,
      stdout: Object.freeze([...stdout]),
      stderr: Object.freeze([...stderr]),
      totalSize,
    });
  }

  clear(taskId: TaskId): Result<void> {
    this.outputs.delete(taskId);
    return ok(undefined);
  }

  // Test helper
  addOutput(taskId: TaskId, stdout: string, stderr = ''): void {
    this.capture(taskId, 'stdout', stdout);
    if (stderr) {
      this.capture(taskId, 'stderr', stderr);
    }
  }
}