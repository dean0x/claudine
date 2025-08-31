/**
 * Core domain models
 * All types are immutable (readonly)
 */

export type TaskId = string & { readonly __brand: 'TaskId' };
export type WorkerId = string & { readonly __brand: 'WorkerId' };

export const TaskId = (id: string): TaskId => id as TaskId;
export const WorkerId = (id: string): WorkerId => id as WorkerId;

export enum Priority {
  P0 = 'P0', // Critical
  P1 = 'P1', // High
  P2 = 'P2', // Normal
}

export enum TaskStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface Task {
  readonly id: TaskId;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly workingDirectory?: string;
  readonly useWorktree: boolean;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly workerId?: WorkerId;
  readonly exitCode?: number;
}

export interface Worker {
  readonly id: WorkerId;
  readonly taskId: TaskId;
  readonly pid: number;
  readonly startedAt: number;
  readonly cpuUsage: number;
  readonly memoryUsage: number;
}

export interface SystemResources {
  readonly cpuUsage: number; // 0-100
  readonly availableMemory: number; // bytes
  readonly totalMemory: number; // bytes
  readonly loadAverage: readonly [number, number, number];
  readonly workerCount: number;
}

export interface TaskOutput {
  readonly taskId: TaskId;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  readonly totalSize: number;
}

export interface DelegateRequest {
  readonly prompt: string;
  readonly priority?: Priority;
  readonly workingDirectory?: string;
  readonly useWorktree?: boolean;
  readonly timeout?: number;
  readonly maxOutputBuffer?: number;
}

export interface TaskUpdate {
  readonly status?: TaskStatus;
  readonly workerId?: WorkerId;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly exitCode?: number;
}

/**
 * Immutable update helper
 */
export const updateTask = (task: Task, update: TaskUpdate): Task => ({
  ...task,
  ...update,
});

/**
 * Create a new task
 */
export const createTask = (request: DelegateRequest): Task => ({
  id: TaskId(crypto.randomUUID()),
  prompt: request.prompt,
  status: TaskStatus.QUEUED,
  priority: request.priority || Priority.P2,
  workingDirectory: request.workingDirectory,
  useWorktree: request.useWorktree || false,
  createdAt: Date.now(),
});

/**
 * Check if task is terminal state
 */
export const isTerminalState = (status: TaskStatus): boolean => {
  return [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(status);
};

/**
 * Check if task can be cancelled
 */
export const canCancel = (task: Task): boolean => {
  return task.status === TaskStatus.QUEUED || task.status === TaskStatus.RUNNING;
};

/**
 * Priority comparison
 */
export const comparePriority = (a: Priority, b: Priority): number => {
  const order = { [Priority.P0]: 0, [Priority.P1]: 1, [Priority.P2]: 2 };
  return order[a] - order[b];
};