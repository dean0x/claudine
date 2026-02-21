import type { Task, Worker, WorkerOptions, TaskSpecification } from '../../src/core/domain';

// Re-export test fixtures
export { NoOpProcessSpawner } from './no-op-spawner.js';

export const createMockTask = (overrides?: Partial<Task>): Task => ({
  id: 'task-test-123',
  prompt: 'test prompt',
  priority: 'P1',
  status: 'pending',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  timeout: 30000,
  maxOutputBuffer: 1024 * 1024,
  workingDirectory: '/tmp/test',
  ...overrides,
});

export const createMockWorker = (overrides?: Partial<Worker>): Worker => ({
  id: 'worker-test-123',
  taskId: 'task-test-123',
  pid: 1234,
  status: 'running',
  startedAt: Date.now(),
  lastActivityAt: Date.now(),
  cpuUsage: 0.5,
  memoryUsage: 512 * 1024 * 1024,
  ...overrides,
});

export const createMockTaskSpec = (overrides?: Partial<TaskSpecification>): TaskSpecification => ({
  prompt: 'test prompt',
  priority: 'P1',
  timeout: 30000,
  maxOutputBuffer: 1024 * 1024,
  workingDirectory: '/tmp/test',
  ...overrides,
});

export const createMockWorkerOptions = (overrides?: Partial<WorkerOptions>): WorkerOptions => ({
  taskId: 'task-test-123',
  prompt: 'test prompt',
  workingDirectory: '/tmp/test',
  timeout: 30000,
  maxOutputBuffer: 1024 * 1024,
  ...overrides,
});

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
