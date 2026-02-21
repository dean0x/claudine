import { randomUUID } from 'crypto';
import { Task, TaskPriority, TaskStatus, WorkerInfo, WorkerStatus } from '@/core/domain';

export function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: randomUUID(),
    prompt: 'Test task prompt',
    status: 'queued' as TaskStatus,
    priority: 'P1' as TaskPriority,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workingDirectory: '/tmp/test',
    timeout: 30000,
    maxOutputBuffer: 1024 * 1024,
    useWorktree: false,
    worktreeCleanup: 'auto',
    mergeStrategy: 'manual',
    baseBranch: 'main',
    autoCommit: false,
    pushToRemote: false,
    ...overrides,
  };
}

export function createMockWorkerInfo(overrides?: Partial<WorkerInfo>): WorkerInfo {
  return {
    id: randomUUID(),
    taskId: randomUUID(),
    status: 'idle' as WorkerStatus,
    pid: 12345,
    startedAt: Date.now(),
    cpuUsage: 10,
    memoryUsage: 100 * 1024 * 1024, // 100MB
    ...overrides,
  };
}

export function createTaskBatch(count: number, overrides?: Partial<Task>): Task[] {
  return Array.from({ length: count }, (_, i) =>
    createMockTask({
      prompt: `Test task ${i + 1}`,
      ...overrides,
    }),
  );
}

export function createWorkerBatch(count: number, overrides?: Partial<WorkerInfo>): WorkerInfo[] {
  return Array.from({ length: count }, (_, i) =>
    createMockWorkerInfo({
      pid: 10000 + i,
      ...overrides,
    }),
  );
}

export const MOCK_CLAUDE_OUTPUT = `
Starting task execution...
Processing request...
✓ Task completed successfully
`;

export const MOCK_ERROR_OUTPUT = `
Error: Task execution failed
  at processTask (task-processor.ts:123)
  at async Worker.run (worker.ts:45)
`;

export function createMockEnvironment() {
  return {
    NODE_ENV: 'test',
    CLAUDE_EXECUTABLE: 'claude',
    MAX_WORKERS: '2',
    MAX_QUEUE_SIZE: '10',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'error',
  };
}
