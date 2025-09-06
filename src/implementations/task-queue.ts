/**
 * Priority-based task queue implementation
 * FIFO within same priority level
 */

import { TaskQueue } from '../core/interfaces.js';
import { Task, TaskId, comparePriority } from '../core/domain.js';
import { Result, ok, err } from '../core/result.js';
import { ClaudineError, ErrorCode, taskNotFound } from '../core/errors.js';

export class PriorityTaskQueue implements TaskQueue {
  private readonly tasks: Task[] = [];

  enqueue(task: Task): Result<void> {
    // Insert in priority order (P0 first, then P1, then P2)
    // Within same priority, maintain FIFO order
    const insertIndex = this.findInsertIndex(task);
    this.tasks.splice(insertIndex, 0, task);
    return ok(undefined);
  }

  dequeue(): Result<Task | null> {
    if (this.tasks.length === 0) {
      return ok(null);
    }
    
    const task = this.tasks.shift();
    return ok(task || null);
  }

  peek(): Result<Task | null> {
    if (this.tasks.length === 0) {
      return ok(null);
    }
    
    return ok(this.tasks[0]);
  }

  remove(taskId: TaskId): Result<void> {
    const index = this.tasks.findIndex(t => t.id === taskId);
    
    if (index === -1) {
      return err(taskNotFound(taskId));
    }
    
    this.tasks.splice(index, 1);
    return ok(undefined);
  }

  getAll(): Result<readonly Task[]> {
    // Return immutable copy
    return ok(Object.freeze([...this.tasks]));
  }

  contains(taskId: TaskId): boolean {
    return this.tasks.some(t => t.id === taskId);
  }

  size(): number {
    return this.tasks.length;
  }

  clear(): Result<void> {
    this.tasks.length = 0;
    return ok(undefined);
  }

  private findInsertIndex(task: Task): number {
    // Find the position to insert based on priority
    for (let i = 0; i < this.tasks.length; i++) {
      const comparison = comparePriority(task.priority, this.tasks[i].priority);
      if (comparison < 0) {
        // Higher priority, insert before this task
        return i;
      }
    }
    
    // Lower or equal priority than all, insert at end
    return this.tasks.length;
  }
}

/**
 * Simple FIFO queue (no priority)
 */
export class FIFOTaskQueue implements TaskQueue {
  private readonly tasks: Task[] = [];

  enqueue(task: Task): Result<void> {
    this.tasks.push(task);
    return ok(undefined);
  }

  dequeue(): Result<Task | null> {
    const task = this.tasks.shift();
    return ok(task || null);
  }

  peek(): Result<Task | null> {
    return ok(this.tasks[0] || null);
  }

  remove(taskId: TaskId): Result<void> {
    const index = this.tasks.findIndex(t => t.id === taskId);
    
    if (index === -1) {
      return err(taskNotFound(taskId));
    }
    
    this.tasks.splice(index, 1);
    return ok(undefined);
  }

  getAll(): Result<readonly Task[]> {
    return ok(Object.freeze([...this.tasks]));
  }

  contains(taskId: TaskId): boolean {
    return this.tasks.some(t => t.id === taskId);
  }

  size(): number {
    return this.tasks.length;
  }

  clear(): Result<void> {
    this.tasks.length = 0;
    return ok(undefined);
  }
}