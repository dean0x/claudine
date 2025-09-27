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

  // Worktree control (replaces old cleanupWorktree boolean)
  readonly useWorktree: boolean;       // default: true (disabled via --no-worktree)
  readonly worktreeCleanup?: 'auto' | 'keep' | 'delete'; // default: 'auto'

  // Merge strategy fields (only applies when useWorktree is true)
  readonly mergeStrategy?: 'pr' | 'auto' | 'manual' | 'patch'; // default: 'pr', undefined when no worktree
  readonly branchName?: string;        // default: 'claudine/task-{id}'
  readonly baseBranch?: string;        // default: current branch
  readonly autoCommit: boolean;        // default: true
  readonly pushToRemote: boolean;      // default: true for PR mode
  readonly prTitle?: string;
  readonly prBody?: string;

  // Execution control
  readonly timeout?: number;
  readonly maxOutputBuffer?: number;

  // Retry tracking - populated when task is created via retry-task command
  // RETRY CHAIN DESIGN:
  // - parentTaskId: Points to the ROOT task of the entire retry chain
  //   This allows grouping all retries of the same original request
  // - retryOf: Points to the IMMEDIATE parent being retried
  //   This allows reconstructing the retry sequence
  // - retryCount: Increments with each retry (1, 2, 3...)
  //   This shows how many attempts have been made
  readonly parentTaskId?: TaskId;      // Root task ID in retry chain (original task)
  readonly retryCount?: number;        // Number in retry chain (1 = first retry, 2 = second, etc.)
  readonly retryOf?: TaskId;          // Direct parent task ID (task this is a retry of)

  // Timestamps and results
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly workerId?: WorkerId;
  readonly exitCode?: number;
  readonly duration?: number;
  readonly error?: any;
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

  // Worktree control
  readonly useWorktree?: boolean;      // default: true
  readonly worktreeCleanup?: 'auto' | 'keep' | 'delete'; // default: 'auto'

  // Merge strategy fields
  readonly mergeStrategy?: 'pr' | 'auto' | 'manual' | 'patch';
  readonly branchName?: string;
  readonly baseBranch?: string;
  readonly autoCommit?: boolean;
  readonly pushToRemote?: boolean;
  readonly prTitle?: string;
  readonly prBody?: string;

  // Execution control
  readonly timeout?: number;
  readonly maxOutputBuffer?: number;

  // Retry tracking (used internally when creating retry tasks)
  readonly parentTaskId?: TaskId;
  readonly retryCount?: number;
  readonly retryOf?: TaskId;
}

export interface TaskUpdate {
  readonly status?: TaskStatus;
  readonly workerId?: WorkerId;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly exitCode?: number;
  readonly duration?: number;
  readonly error?: any;
}

/**
 * Immutable update helper
 */
export const updateTask = (task: Task, update: TaskUpdate): Task => ({
  ...task,
  ...update,
  updatedAt: Date.now(),
});

/**
 * Create a new task
 */
export const createTask = (request: DelegateRequest): Task => Object.freeze({
  id: TaskId(`task-${crypto.randomUUID()}`),
  prompt: request.prompt,
  status: TaskStatus.QUEUED,
  priority: request.priority || Priority.P2,
  workingDirectory: request.workingDirectory,

  // Worktree configuration
  useWorktree: request.useWorktree !== false, // Default to true
  worktreeCleanup: request.worktreeCleanup !== undefined ? request.worktreeCleanup : 'auto',

  // Merge strategy configuration
  mergeStrategy: request.useWorktree === false ? undefined : (request.mergeStrategy || 'pr'),
  branchName: request.branchName,
  baseBranch: request.baseBranch,
  autoCommit: request.autoCommit !== false, // Default to true
  pushToRemote: request.pushToRemote !== false, // Default to true
  prTitle: request.prTitle,
  prBody: request.prBody,

  // Retry tracking
  parentTaskId: request.parentTaskId,
  retryCount: request.retryCount,
  retryOf: request.retryOf,

  // Execution configuration
  timeout: request.timeout,
  maxOutputBuffer: request.maxOutputBuffer,
  createdAt: Date.now(),
  updatedAt: Date.now(),
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