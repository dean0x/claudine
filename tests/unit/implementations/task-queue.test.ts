import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityTaskQueue } from '../../../src/implementations/task-queue';
import { Priority, TaskStatus, TaskId, createTask } from '../../../src/core/domain';
import type { Task } from '../../../src/core/domain';
import { TEST_COUNTS, TIMEOUTS } from '../../constants';
import { TaskFactory } from '../../fixtures/factories';

describe('PriorityTaskQueue - REAL Queue Operations', () => {
  let queue: PriorityTaskQueue;

  beforeEach(() => {
    queue = new PriorityTaskQueue();
  });

  describe('Basic queue operations', () => {
    it('should start empty', () => {
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should enqueue and dequeue a single task', () => {
      const task = createTask({
        prompt: 'test task',
        priority: Priority.P1,
      });

      const enqueueResult = queue.enqueue(task);
      expect(enqueueResult.ok).toBe(true);
      expect(queue.size()).toBe(1);
      expect(queue.isEmpty()).toBe(false);

      const dequeueResult = queue.dequeue();
      expect(dequeueResult.ok).toBe(true);
      if (dequeueResult.ok && dequeueResult.value) {
        expect(dequeueResult.value.id).toBe(task.id);
        expect(dequeueResult.value.prompt).toBe('test task');
      }

      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return null when dequeuing from empty queue', () => {
      const result = queue.dequeue();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }

      // Additional validations for empty queue state
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
      expect(queue.peek().ok).toBe(true);
      if (queue.peek().ok) {
        expect(queue.peek().value).toBeNull();
      }

      // More comprehensive state validation
      const getAllResult = queue.getAll();
      expect(getAllResult.ok).toBe(true);
      if (getAllResult.ok) {
        expect(getAllResult.value).toEqual([]);
        expect(getAllResult.value.length).toBe(0);
      }

      // Verify contains returns false for any ID
      expect(queue.contains(TaskId('non-existent'))).toBe(false);
      expect(queue.contains(TaskId('task-123'))).toBe(false);

      // Multiple dequeues should still return null
      const secondResult = queue.dequeue();
      expect(secondResult.ok).toBe(true);
      if (secondResult.ok) {
        expect(secondResult.value).toBeNull();
      }
    });

    it('should handle multiple enqueue operations', () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createTask({
          prompt: `task ${i}`,
          priority: Priority.P1,
        }),
      );

      tasks.forEach((task) => {
        const result = queue.enqueue(task);
        expect(result.ok).toBe(true);
      });

      expect(queue.size()).toBe(5);
      expect(queue.isEmpty()).toBe(false);
      expect(queue.size()).toBeGreaterThan(0);

      // Verify queue state after enqueueing
      const peekResult = queue.peek();
      expect(peekResult.ok).toBe(true);
      expect(peekResult).toBeDefined();
      expect(peekResult).toHaveProperty('ok');
      if (peekResult.ok && peekResult.value) {
        expect(peekResult.value.priority).toBe(Priority.P1);
        expect(peekResult.value.prompt).toBe('task 0');
        expect(peekResult.value.status).toBe(TaskStatus.QUEUED);
        expect(peekResult.value.id).toMatch(/^task-/);
        expect(typeof peekResult.value.id).toBe('string');
      }

      // Dequeue all and verify
      const dequeued = [];
      let dequeueCount = 0;
      while (!queue.isEmpty()) {
        const result = queue.dequeue();
        expect(result.ok).toBe(true);
        if (result.ok && result.value) {
          dequeueCount++;
          dequeued.push(result.value);
        }
      }

      expect(dequeued).toHaveLength(5);
      expect(dequeued.map((t) => t.prompt)).toEqual(tasks.map((t) => t.prompt));
    });
  });

  describe('Priority ordering', () => {
    it('should dequeue P0 tasks before P1 and P2', () => {
      const p2Task = new TaskFactory().withPrompt('low priority').withPriority(Priority.P2).build();
      const p0Task = new TaskFactory().withPrompt('high priority').withPriority(Priority.P0).build();
      const p1Task = new TaskFactory().withPrompt('normal priority').withPriority(Priority.P1).build();

      // Enqueue in mixed order
      queue.enqueue(p2Task);
      queue.enqueue(p0Task);
      queue.enqueue(p1Task);

      // Should dequeue in priority order: P0, P1, P2
      const first = queue.dequeue();
      expect(first.ok && first.value?.priority).toBe(Priority.P0);

      const second = queue.dequeue();
      expect(second.ok && second.value?.priority).toBe(Priority.P1);

      const third = queue.dequeue();
      expect(third.ok && third.value?.priority).toBe(Priority.P2);
    });

    it('should maintain FIFO order within same priority', () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createTask({
          prompt: `P1 task ${i}`,
          priority: Priority.P1,
        }),
      );

      tasks.forEach((task) => queue.enqueue(task));

      const dequeued = [];
      while (!queue.isEmpty()) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          dequeued.push(result.value.prompt);
        }
      }

      // Should maintain insertion order for same priority
      expect(dequeued).toEqual(['P1 task 0', 'P1 task 1', 'P1 task 2', 'P1 task 3', 'P1 task 4']);
    });

    it('should handle complex priority scenarios', () => {
      // Create tasks with mixed priorities
      const tasks = [
        createTask({ prompt: 'P2-1', priority: Priority.P2 }),
        createTask({ prompt: 'P0-1', priority: Priority.P0 }),
        createTask({ prompt: 'P1-1', priority: Priority.P1 }),
        createTask({ prompt: 'P2-2', priority: Priority.P2 }),
        createTask({ prompt: 'P0-2', priority: Priority.P0 }),
        createTask({ prompt: 'P1-2', priority: Priority.P1 }),
        createTask({ prompt: 'P0-3', priority: Priority.P0 }),
      ];

      tasks.forEach((task) => queue.enqueue(task));

      const dequeued = [];
      while (!queue.isEmpty()) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          dequeued.push(result.value.prompt);
        }
      }

      // Expected order: All P0s (FIFO), then P1s (FIFO), then P2s (FIFO)
      expect(dequeued).toEqual([
        'P0-1',
        'P0-2',
        'P0-3', // P0 tasks in order
        'P1-1',
        'P1-2', // P1 tasks in order
        'P2-1',
        'P2-2', // P2 tasks in order
      ]);
    });
  });

  describe('Queue peeking', () => {
    it('should peek without removing', () => {
      const task = createTask({
        prompt: 'peek test',
        priority: Priority.P1,
      });

      queue.enqueue(task);

      const peekResult = queue.peek();
      expect(peekResult.ok).toBe(true);
      if (peekResult.ok && peekResult.value) {
        expect(peekResult.value.id).toBe(task.id);
      }

      // Queue size should remain unchanged
      expect(queue.size()).toBe(1);

      // Can still dequeue the same task
      const dequeueResult = queue.dequeue();
      if (dequeueResult.ok && dequeueResult.value) {
        expect(dequeueResult.value.id).toBe(task.id);
      }
      expect(queue.size()).toBe(0);
    });

    it('should peek highest priority task', () => {
      queue.enqueue(createTask({ prompt: 'P2', priority: Priority.P2 }));
      queue.enqueue(createTask({ prompt: 'P0', priority: Priority.P0 }));
      queue.enqueue(createTask({ prompt: 'P1', priority: Priority.P1 }));

      const peekResult = queue.peek();
      if (peekResult.ok && peekResult.value) {
        expect(peekResult.value.priority).toBe(Priority.P0);
        expect(peekResult.value.prompt).toBe('P0');
      }
    });

    it('should return null when peeking empty queue', () => {
      const result = queue.peek();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe('Task removal', () => {
    it('should remove specific task by ID', () => {
      const task1 = createTask({ prompt: 'task 1', priority: Priority.P1 });
      const task2 = createTask({ prompt: 'task 2', priority: Priority.P1 });
      const task3 = createTask({ prompt: 'task 3', priority: Priority.P1 });

      queue.enqueue(task1);
      queue.enqueue(task2);
      queue.enqueue(task3);

      expect(queue.size()).toBe(3);

      const removeResult = queue.remove(task2.id);
      expect(removeResult.ok).toBe(true);
      if (removeResult.ok) {
        expect(removeResult.value).toBe(true);
      }

      expect(queue.size()).toBe(2);

      // Verify task2 is gone
      const remaining = [];
      while (!queue.isEmpty()) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          remaining.push(result.value.id);
        }
      }

      expect(remaining).toEqual([task1.id, task3.id]);
    });

    it('should return false when removing non-existent task', () => {
      const task = createTask({ prompt: 'test', priority: Priority.P1 });
      queue.enqueue(task);

      const result = queue.remove('non-existent-id');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }

      expect(queue.size()).toBe(1); // Original task still there
    });

    it('should handle removing from different priority queues', () => {
      const p0Task = createTask({ prompt: 'P0', priority: Priority.P0 });
      const p1Task = createTask({ prompt: 'P1', priority: Priority.P1 });
      const p2Task = createTask({ prompt: 'P2', priority: Priority.P2 });

      queue.enqueue(p0Task);
      queue.enqueue(p1Task);
      queue.enqueue(p2Task);

      // Remove middle priority
      const result = queue.remove(p1Task.id);
      expect(result.ok && result.value).toBe(true);

      const remaining = [];
      while (!queue.isEmpty()) {
        const dequeueResult = queue.dequeue();
        if (dequeueResult.ok && dequeueResult.value) {
          remaining.push(dequeueResult.value.priority);
        }
      }

      expect(remaining).toEqual([Priority.P0, Priority.P2]);
    });
  });

  describe('Queue contains check', () => {
    it('should check if task exists', () => {
      const task = createTask({ prompt: 'test', priority: Priority.P1 });

      expect(queue.contains(task.id)).toBe(false);

      queue.enqueue(task);
      expect(queue.contains(task.id)).toBe(true);

      queue.remove(task.id);
      expect(queue.contains(task.id)).toBe(false);
    });

    it('should work across different priorities', () => {
      const tasks = [
        createTask({ prompt: 'P0', priority: Priority.P0 }),
        createTask({ prompt: 'P1', priority: Priority.P1 }),
        createTask({ prompt: 'P2', priority: Priority.P2 }),
      ];

      tasks.forEach((task) => queue.enqueue(task));

      tasks.forEach((task) => {
        expect(queue.contains(task.id)).toBe(true);
      });

      expect(queue.contains('non-existent')).toBe(false);
    });
  });

  describe('Get all tasks', () => {
    it('should return all tasks in priority order', () => {
      const tasks = [
        createTask({ prompt: 'P2-1', priority: Priority.P2 }),
        createTask({ prompt: 'P0-1', priority: Priority.P0 }),
        createTask({ prompt: 'P1-1', priority: Priority.P1 }),
        createTask({ prompt: 'P2-2', priority: Priority.P2 }),
        createTask({ prompt: 'P0-2', priority: Priority.P0 }),
      ];

      tasks.forEach((task) => queue.enqueue(task));

      const allResult = queue.getAll();
      expect(allResult.ok).toBe(true);

      if (allResult.ok) {
        const all = allResult.value;
        expect(all).toHaveLength(5);

        // Should be in priority order
        expect(all[0].priority).toBe(Priority.P0);
        expect(all[1].priority).toBe(Priority.P0);
        expect(all[2].priority).toBe(Priority.P1);
        expect(all[3].priority).toBe(Priority.P2);
        expect(all[4].priority).toBe(Priority.P2);

        // Within same priority, should maintain FIFO
        expect(all[0].prompt).toBe('P0-1');
        expect(all[1].prompt).toBe('P0-2');
        expect(all[3].prompt).toBe('P2-1');
        expect(all[4].prompt).toBe('P2-2');
      }
    });

    it('should return empty array for empty queue', () => {
      const result = queue.getAll();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('should not modify queue when getting all', () => {
      const task = createTask({ prompt: 'test', priority: Priority.P1 });
      queue.enqueue(task);

      const before = queue.size();
      queue.getAll();
      const after = queue.size();

      expect(before).toBe(after);
      expect(queue.contains(task.id)).toBe(true);
    });
  });

  describe('Clear queue', () => {
    it('should remove all tasks', () => {
      for (let i = 0; i < 10; i++) {
        queue.enqueue(
          createTask({
            prompt: `task ${i}`,
            priority: [Priority.P0, Priority.P1, Priority.P2][i % 3],
          }),
        );
      }

      expect(queue.size()).toBe(10);

      const result = queue.clear();
      expect(result.ok).toBe(true);
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });

    it('should handle clearing empty queue', () => {
      const result = queue.clear();
      expect(result.ok).toBe(true);
      expect(queue.size()).toBe(0);
    });
  });

  describe('Edge cases and error conditions', () => {
    it('should handle duplicate task IDs gracefully', () => {
      const task = createTask({ prompt: 'test', priority: Priority.P1 });

      const first = queue.enqueue(task);
      expect(first.ok).toBe(true);

      // Enqueuing same task again should fail or be handled
      const second = queue.enqueue(task);
      // Implementation might allow duplicates or reject them
      // Test actual behavior
      expect(second.ok).toBe(true); // If allows duplicates

      // Size should reflect actual behavior
      expect(queue.size()).toBe(2); // If duplicates allowed
    });

    it('should maintain consistency under rapid operations', () => {
      const operations = TEST_COUNTS.STRESS_TEST;
      let enqueued = 0;
      let dequeued = 0;

      // Perform random operations
      for (let i = 0; i < operations; i++) {
        if (Math.random() > 0.3 || queue.isEmpty()) {
          // 70% chance to enqueue (or always if empty)
          queue.enqueue(
            createTask({
              prompt: `task ${i}`,
              priority: [Priority.P0, Priority.P1, Priority.P2][i % 3],
            }),
          );
          enqueued++;
        } else {
          // 30% chance to dequeue
          const result = queue.dequeue();
          if (result.ok && result.value) {
            dequeued++;
          }
        }
      }

      // Queue size should match enqueued - dequeued
      expect(queue.size()).toBe(enqueued - dequeued);

      // Dequeue remaining
      let remaining = 0;
      while (!queue.isEmpty()) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          remaining++;
        }
      }

      expect(remaining).toBe(enqueued - dequeued);
    });

    it('should handle queue up to max size limit', () => {
      // SECURITY: Queue has max size of 1000 for DoS protection
      const maxQueueSize = 1000;
      const start = performance.now();

      // Enqueue up to max capacity
      for (let i = 0; i < maxQueueSize; i++) {
        const result = queue.enqueue(
          createTask({
            prompt: `task ${i}`,
            priority: [Priority.P0, Priority.P1, Priority.P2][i % 3],
          }),
        );
        expect(result.ok).toBe(true);
      }

      const enqueueTime = performance.now() - start;
      expect(queue.size()).toBe(maxQueueSize);
      expect(enqueueTime).toBeLessThan(1000); // Should be fast for 1k items

      // Verify priority ordering still works (sample check, not full dequeue)
      let lastPriority = Priority.P0;
      const priorityOrder = [Priority.P0, Priority.P1, Priority.P2];
      const samplesToCheck = 100; // Only check first 100 to reduce memory pressure

      for (let i = 0; i < samplesToCheck && !queue.isEmpty(); i++) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          const lastIndex = priorityOrder.indexOf(lastPriority);
          const currentIndex = priorityOrder.indexOf(result.value.priority);
          expect(currentIndex).toBeGreaterThanOrEqual(lastIndex);
          lastPriority = result.value.priority;
        }
      }

      // Clear remaining items without checking (to free memory)
      while (!queue.isEmpty()) {
        queue.dequeue();
      }
    });

    it('should reject tasks when queue is full (DoS protection)', () => {
      // Fill queue to max capacity
      const maxQueueSize = 1000;
      for (let i = 0; i < maxQueueSize; i++) {
        const result = queue.enqueue(createTask({ prompt: `task ${i}` }));
        expect(result.ok).toBe(true);
      }

      // Try to add one more - should be rejected
      const overflowResult = queue.enqueue(createTask({ prompt: 'overflow task' }));
      expect(overflowResult.ok).toBe(false);
      if (!overflowResult.ok) {
        expect(overflowResult.error.code).toBe('RESOURCE_EXHAUSTED');
        expect(overflowResult.error.message).toContain('Queue is full');
      }

      // Queue size should remain at max
      expect(queue.size()).toBe(maxQueueSize);
    });

    it('should handle tasks with same timestamp correctly', () => {
      // Create tasks at exact same time
      const now = Date.now();
      const tasks = [
        { ...createTask({ prompt: 'A', priority: Priority.P1 }), createdAt: now },
        { ...createTask({ prompt: 'B', priority: Priority.P1 }), createdAt: now },
        { ...createTask({ prompt: 'C', priority: Priority.P1 }), createdAt: now },
      ];

      tasks.forEach((task) => queue.enqueue(task));

      const dequeued = [];
      while (!queue.isEmpty()) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          dequeued.push(result.value.prompt);
        }
      }

      // Should maintain insertion order when timestamps are equal
      expect(dequeued).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle task lifecycle transitions', () => {
      // Simulate real task flow
      const task = createTask({
        prompt: 'process data',
        priority: Priority.P1,
      });

      // Task created and queued
      queue.enqueue(task);
      expect(queue.contains(task.id)).toBe(true);

      // Worker picks up task
      const dequeued = queue.dequeue();
      expect(dequeued.ok && dequeued.value?.id).toBe(task.id);
      expect(queue.contains(task.id)).toBe(false);

      // If task fails, it might be re-queued
      const retriedTask = {
        ...task,
        attempts: task.attempts + 1,
        status: TaskStatus.QUEUED,
      };

      queue.enqueue(retriedTask);
      expect(queue.contains(task.id)).toBe(true);
    });

    it('should handle priority escalation', () => {
      // Task starts as P2
      const task = createTask({
        prompt: 'background job',
        priority: Priority.P2,
      });

      queue.enqueue(task);

      // Simulate priority escalation
      const removed = queue.remove(task.id);
      expect(removed.ok && removed.value).toBe(true);

      const escalatedTask = {
        ...task,
        priority: Priority.P0, // Escalated to P0
      };

      queue.enqueue(escalatedTask);

      // Add more tasks
      queue.enqueue(createTask({ prompt: 'P1 task', priority: Priority.P1 }));
      queue.enqueue(createTask({ prompt: 'P2 task', priority: Priority.P2 }));

      // Escalated task should come out first
      const next = queue.dequeue();
      expect(next.ok && next.value?.id).toBe(task.id);
      expect(next.ok && next.value?.priority).toBe(Priority.P0);
    });

    it('should handle batch operations efficiently', () => {
      // Simulate batch task submission
      const batchSize = 100;
      const batches = 5;

      for (let batch = 0; batch < batches; batch++) {
        const tasks = Array.from({ length: batchSize }, (_, i) =>
          createTask({
            prompt: `batch-${batch}-task-${i}`,
            priority: batch === 0 ? Priority.P0 : Priority.P1, // First batch is urgent
          }),
        );

        tasks.forEach((task) => queue.enqueue(task));
      }

      expect(queue.size()).toBe(batchSize * batches);

      // First batch should come out first (P0 priority)
      for (let i = 0; i < batchSize; i++) {
        const result = queue.dequeue();
        if (result.ok && result.value) {
          expect(result.value.prompt).toContain('batch-0');
        }
      }
    });
  });
});
