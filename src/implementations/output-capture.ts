/**
 * Output capture implementation
 * Manages stdout/stderr for tasks with size limits
 */

import { OutputCapture } from '../core/interfaces.js';
import { EventBus } from '../core/events/event-bus.js';
import { TaskId, TaskOutput } from '../core/domain.js';
import { Result, ok, err } from '../core/result.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

interface OutputBuffer {
  stdout: string[];
  stderr: string[];
  totalSize: number;
}

export interface TaskConfig {
  maxOutputBuffer: number;
}

export class BufferedOutputCapture implements OutputCapture {
  private readonly buffers = new Map<TaskId, OutputBuffer>();
  private readonly taskConfigs = new Map<TaskId, TaskConfig>();
  private readonly maxBufferSize: number;
  private readonly eventBus?: EventBus;

  constructor(maxBufferSize = 10 * 1024 * 1024, eventBus?: EventBus) { // 10MB default
    this.maxBufferSize = maxBufferSize;
    this.eventBus = eventBus;
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
    
    // Get the applicable buffer limit (per-task or global)
    const taskConfig = this.taskConfigs.get(taskId);
    const bufferLimit = taskConfig?.maxOutputBuffer !== undefined ? taskConfig.maxOutputBuffer : this.maxBufferSize;
    
    // Check if adding this would exceed the limit
    if (buffer.totalSize + dataSize > bufferLimit) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Output buffer limit exceeded for task ${taskId}`,
        { currentSize: buffer.totalSize, maxSize: bufferLimit }
      ));
    }

    // Add to appropriate buffer
    if (type === 'stdout') {
      buffer.stdout.push(data);
    } else {
      buffer.stderr.push(data);
    }
    
    buffer.totalSize += dataSize;

    // Emit OutputCaptured event if eventBus is available
    if (this.eventBus) {
      this.eventBus.emit('OutputCaptured', {
        taskId,
        outputType: type,
        data
      }).catch(() => {
        // Log error but don't fail the capture operation
        // EventBus errors shouldn't break output capture
      });
    }
    
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
    this.taskConfigs.delete(taskId);
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

  // Per-task configuration methods
  configureTask(taskId: TaskId, config: TaskConfig): Result<void> {
    this.taskConfigs.set(taskId, config);
    return ok(undefined);
  }

  cleanup(taskId: TaskId): Result<void> {
    this.buffers.delete(taskId);
    this.taskConfigs.delete(taskId);
    return ok(undefined);
  }
}

/**
 * Test implementation that stores output in memory
 */
export class TestOutputCapture implements OutputCapture {
  private readonly outputs = new Map<TaskId, { stdout: string[]; stderr: string[] }>();
  private readonly taskConfigs = new Map<TaskId, TaskConfig>();

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
    this.taskConfigs.delete(taskId);
    return ok(undefined);
  }

  // Per-task configuration methods
  configureTask(taskId: TaskId, config: TaskConfig): Result<void> {
    this.taskConfigs.set(taskId, config);
    return ok(undefined);
  }

  cleanup(taskId: TaskId): Result<void> {
    this.outputs.delete(taskId);
    this.taskConfigs.delete(taskId);
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