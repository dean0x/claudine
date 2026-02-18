/**
 * Core interfaces for dependency injection
 * All implementations should be injected, not instantiated directly
 */

import { Result } from './result.js';
import { Task, TaskId, Worker, WorkerId, SystemResources, TaskOutput, DelegateRequest, Schedule, ScheduleId, ScheduleStatus, ScheduleCreateRequest, TaskCheckpoint, ResumeTaskRequest } from './domain.js';
import { ChildProcess } from 'child_process';
import { ClaudineEvent, EventHandler, BaseEvent } from './events/events.js';

/**
 * Task queue management
 */
export interface TaskQueue {
  enqueue(task: Task): Result<void>;
  dequeue(): Result<Task | null>;
  peek(): Result<Task | null>;
  remove(taskId: TaskId): Result<boolean>;
  getAll(): Result<readonly Task[]>;
  contains(taskId: TaskId): boolean;
  size(): number;
  clear(): Result<void>;
  isEmpty(): boolean;
}

/**
 * Process spawning abstraction
 */
export interface ProcessSpawner {
  spawn(
    prompt: string,
    workingDirectory: string,
    taskId?: string
  ): Result<{ process: ChildProcess; pid: number }>;
  kill(pid: number): Result<void>;
}

/**
 * System resource monitoring
 */
export interface ResourceMonitor {
  getResources(): Promise<Result<SystemResources>>;
  canSpawnWorker(): Promise<Result<boolean>>;
  getThresholds(): {
    readonly maxCpuPercent: number;
    readonly minMemoryBytes: number;
  };
  incrementWorkerCount(): void;
  decrementWorkerCount(): void;
  /**
   * Record a spawn event for settling worker tracking
   * Call immediately after spawning to track workers during their settling period
   * (before they appear in system metrics like load average)
   */
  recordSpawn(): void;
}

/**
 * Worker pool management
 */
export interface WorkerPool {
  spawn(task: Task): Promise<Result<Worker>>;
  kill(workerId: WorkerId): Promise<Result<void>>;
  killAll(): Promise<Result<void>>;
  getWorker(workerId: WorkerId): Result<Worker | null>;
  getWorkers(): Result<readonly Worker[]>;
  getWorkerCount(): number;
  getWorkerForTask(taskId: TaskId): Result<Worker | null>;
}

/**
 * Task output management
 */
export interface OutputCapture {
  capture(taskId: TaskId, type: 'stdout' | 'stderr', data: string): Result<void>;
  getOutput(taskId: TaskId, tail?: number): Result<TaskOutput>;
  clear(taskId: TaskId): Result<void>;
}

/**
 * Task persistence (for Phase 2)
 */
export interface TaskRepository {
  save(task: Task): Promise<Result<void>>;
  update(taskId: TaskId, update: Partial<Task>): Promise<Result<void>>;
  findById(taskId: TaskId): Promise<Result<Task | null>>;
  /**
   * Find tasks with optional pagination
   *
   * All implementations MUST use DEFAULT_LIMIT = 100 when limit is not specified.
   * This ensures consistent behavior across implementations.
   *
   * @param limit Maximum results to return (default: 100, max recommended: 1000)
   * @param offset Skip first N results (default: 0)
   * @returns Paginated task list ordered by created_at DESC
   */
  findAll(limit?: number, offset?: number): Promise<Result<readonly Task[]>>;
  /**
   * Find all tasks without pagination limit
   * ARCHITECTURE: Use only when you genuinely need ALL tasks (e.g., graph initialization)
   * For user-facing queries, use findAll() with pagination instead
   * @returns All tasks ordered by created_at DESC
   */
  findAllUnbounded(): Promise<Result<readonly Task[]>>;
  /**
   * Count total tasks in repository
   * @returns Total task count (useful for pagination UI)
   */
  count(): Promise<Result<number>>;
  /**
   * Find tasks by status (returns all matching tasks - NOT paginated)
   * NOTE: Unlike findAll(), this method has no pagination limit.
   * For large datasets, consider using findAll() with application-level filtering.
   * @param status Task status to filter by
   * @returns All tasks matching the status
   */
  findByStatus(status: string): Promise<Result<readonly Task[]>>;
  delete(taskId: TaskId): Promise<Result<void>>;
  cleanupOldTasks(olderThanMs: number): Promise<Result<number>>;
  transaction<T>(fn: (repo: TaskRepository) => Promise<Result<T>>): Promise<Result<T>>;
}

/**
 * Task dependency tracking and resolution
 * ARCHITECTURE: Pure Result pattern, no exceptions
 * Pattern: Repository pattern for dependency DAG management
 * Rationale: Enables cycle detection, dependency queries, state tracking
 */
export interface TaskDependency {
  readonly id: number;
  readonly taskId: TaskId;
  readonly dependsOnTaskId: TaskId;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
  readonly resolution: 'pending' | 'completed' | 'failed' | 'cancelled';
}

export interface DependencyRepository {
  /**
   * Add a dependency relationship between tasks
   * @returns Error if dependency would create a cycle
   */
  addDependency(taskId: TaskId, dependsOnTaskId: TaskId): Promise<Result<TaskDependency>>;

  /**
   * Add multiple dependencies atomically in a single transaction
   * All dependencies succeed or all fail together
   * @returns Error if any dependency would create a cycle or if validation fails
   */
  addDependencies(taskId: TaskId, dependsOn: readonly TaskId[]): Promise<Result<readonly TaskDependency[]>>;

  /**
   * Get all tasks that the given task depends on (blocking tasks)
   */
  getDependencies(taskId: TaskId): Promise<Result<readonly TaskDependency[]>>;

  /**
   * Get all tasks that depend on the given task (blocked tasks)
   */
  getDependents(taskId: TaskId): Promise<Result<readonly TaskDependency[]>>;

  /**
   * Mark a dependency as resolved with given resolution state
   * @returns Result<void> - Success or error. Use resolveDependenciesBatch() if you need the count of resolved dependencies.
   */
  resolveDependency(taskId: TaskId, dependsOnTaskId: TaskId, resolution: 'completed' | 'failed' | 'cancelled'): Promise<Result<void>>;

  /**
   * Batch resolve all dependencies that depend on a completed task
   * PERFORMANCE: Single UPDATE query instead of N+1 queries (7-10× faster)
   * @param dependsOnTaskId The task that completed/failed/cancelled
   * @param resolution The resolution state to apply to all dependents
   * @returns Result<number> - Count of dependencies resolved (useful for logging and metrics)
   */
  resolveDependenciesBatch(dependsOnTaskId: TaskId, resolution: 'completed' | 'failed' | 'cancelled'): Promise<Result<number>>;

  /**
   * Get all unresolved dependencies for a task
   */
  getUnresolvedDependencies(taskId: TaskId): Promise<Result<readonly TaskDependency[]>>;

  /**
   * Check if a task has any unresolved dependencies (is blocked)
   */
  isBlocked(taskId: TaskId): Promise<Result<boolean>>;

  /**
   * Get dependencies with optional pagination
   *
   * All implementations MUST use DEFAULT_LIMIT = 100 when limit is not specified.
   * This ensures consistent behavior across implementations.
   *
   * @param limit Maximum results to return (default: 100, max recommended: 1000)
   * @param offset Skip first N results (default: 0)
   * @returns Paginated dependencies ordered by created_at DESC
   */
  findAll(limit?: number, offset?: number): Promise<Result<readonly TaskDependency[]>>;

  /**
   * Get all dependencies without pagination limit
   * ARCHITECTURE: Use only for graph initialization (DependencyHandler.create())
   * For user queries, use findAll() with pagination instead
   * @returns All dependencies ordered by created_at DESC
   */
  findAllUnbounded(): Promise<Result<readonly TaskDependency[]>>;

  /**
   * Count total dependencies in repository
   * @returns Total dependency count
   */
  count(): Promise<Result<number>>;

  /**
   * Remove all dependencies for a task (on task deletion)
   */
  deleteDependencies(taskId: TaskId): Promise<Result<void>>;
}

/**
 * Schedule execution history record
 * ARCHITECTURE: Tracks individual executions of a schedule for audit/debugging
 * Pattern: Immutable record of each trigger attempt and outcome
 */
export interface ScheduleExecution {
  readonly id: number;
  readonly scheduleId: ScheduleId;
  readonly taskId?: TaskId;               // ID of created task (if execution succeeded in creating one)
  readonly scheduledFor: number;          // Epoch ms - when execution was scheduled to run
  readonly executedAt?: number;           // Epoch ms - when execution actually started
  readonly status: 'pending' | 'triggered' | 'completed' | 'failed' | 'missed' | 'skipped';
  readonly errorMessage?: string;         // Error details if status is 'failed' or 'missed'
  readonly createdAt: number;
}

/**
 * Schedule persistence and query interface
 * ARCHITECTURE: Pure Result pattern, no exceptions
 * Pattern: Repository pattern for schedule management
 * Rationale: Enables schedule CRUD, status tracking, due schedule queries
 */
export interface ScheduleRepository {
  /**
   * Save a new schedule
   */
  save(schedule: Schedule): Promise<Result<void>>;

  /**
   * Update an existing schedule
   */
  update(id: ScheduleId, update: Partial<Schedule>): Promise<Result<void>>;

  /**
   * Find schedule by ID
   */
  findById(id: ScheduleId): Promise<Result<Schedule | null>>;

  /**
   * Find schedules with optional pagination
   *
   * All implementations MUST use DEFAULT_LIMIT = 100 when limit is not specified.
   * This ensures consistent behavior across implementations.
   *
   * @param limit Maximum results to return (default: 100, max recommended: 1000)
   * @param offset Skip first N results (default: 0)
   * @returns Paginated schedule list ordered by created_at DESC
   */
  findAll(limit?: number, offset?: number): Promise<Result<readonly Schedule[]>>;

  /**
   * Find schedules by status with optional pagination
   *
   * All implementations MUST use DEFAULT_LIMIT = 100 when limit is not specified.
   * This ensures consistent behavior across implementations.
   *
   * @param status Schedule status to filter by
   * @param limit Maximum results to return (default: 100, max recommended: 1000)
   * @param offset Skip first N results (default: 0)
   * @returns Paginated schedule list matching status, ordered by created_at DESC
   */
  findByStatus(status: ScheduleStatus, limit?: number, offset?: number): Promise<Result<readonly Schedule[]>>;

  /**
   * Find schedules that are due to execute (nextRunAt <= beforeTime)
   * ARCHITECTURE: Critical for scheduler tick - finds schedules ready to trigger
   * @param beforeTime Epoch ms - find schedules with nextRunAt before this time
   * @returns Schedules due for execution ordered by nextRunAt ASC
   */
  findDue(beforeTime: number): Promise<Result<readonly Schedule[]>>;

  /**
   * Delete a schedule
   */
  delete(id: ScheduleId): Promise<Result<void>>;

  /**
   * Count total schedules
   */
  count(): Promise<Result<number>>;

  /**
   * Record a schedule execution attempt
   * @param execution Execution record without ID (ID auto-generated)
   * @returns Created execution record with ID
   */
  recordExecution(execution: Omit<ScheduleExecution, 'id'>): Promise<Result<ScheduleExecution>>;

  /**
   * Get execution history for a schedule
   * @param scheduleId Schedule to get history for
   * @param limit Maximum records to return (default: 100)
   * @returns Execution history ordered by scheduledFor DESC
   */
  getExecutionHistory(scheduleId: ScheduleId, limit?: number): Promise<Result<readonly ScheduleExecution[]>>;
}

/**
 * Structured logging
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

/**
 * Configuration
 */
export interface Config {
  readonly maxOutputBuffer: number;
  readonly taskTimeout: number;
  readonly cpuCoresReserved: number; // Number of CPU cores to keep free
  readonly memoryReserve: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly maxListenersPerEvent?: number; // Configurable EventBus limit
  readonly maxTotalSubscriptions?: number; // Configurable EventBus limit
}

/**
 * Event emitter for task events
 */
export interface TaskEventEmitter {
  on(event: 'task:queued', listener: (task: Task) => void): void;
  on(event: 'task:started', listener: (task: Task) => void): void;
  on(event: 'task:completed', listener: (task: Task) => void): void;
  on(event: 'task:failed', listener: (task: Task, error: Error) => void): void;
  on(event: 'task:cancelled', listener: (task: Task) => void): void;
  on(event: 'worker:spawned', listener: (worker: Worker) => void): void;
  on(event: 'worker:killed', listener: (worker: Worker) => void): void;
  
  emit(event: string, ...args: any[]): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

// EventBus interface has been moved to src/core/events/event-bus.ts
// Import it from there:
// import { EventBus } from './events/event-bus.js';

/**
 * Main task manager orchestrator
 */
export interface TaskManager {
  delegate(request: DelegateRequest): Promise<Result<Task>>;
  getStatus(taskId?: TaskId): Promise<Result<Task | readonly Task[]>>;
  getLogs(taskId: TaskId, tail?: number): Promise<Result<TaskOutput>>;
  cancel(taskId: TaskId, reason?: string): Promise<Result<void>>;
  retry(taskId: TaskId): Promise<Result<Task>>;
  resume(request: ResumeTaskRequest): Promise<Result<Task>>;

  // Worktree management methods (event-driven)
  listWorktrees(includeStale?: boolean, olderThanDays?: number): Promise<Result<readonly WorktreeStatus[]>>;
  getWorktreeStatus(taskId: TaskId): Promise<Result<WorktreeStatus>>;
  cleanupWorktrees(strategy?: 'safe' | 'interactive' | 'force', olderThanDays?: number, taskIds?: TaskId[]): Promise<Result<WorktreeCleanupResult>>;
}

/**
 * Git worktree management for isolated task execution
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
}

export interface WorktreeStatus {
  taskId: string;
  path: string;
  branch: string;
  baseBranch: string;
  ageInDays: number;
  hasUnpushedChanges: boolean;
  safeToRemove: boolean;
  exists: boolean;
}

export interface WorktreeManagerConfig {
  maxWorktreeAgeDays: number;        // Default: 7
  requireSafetyCheck: boolean;       // Default: true
  allowForceRemoval: boolean;        // Default: false
}

export interface CompletionResult {
  action: 'pr_created' | 'merged' | 'branch_pushed' | 'patch_created';
  prUrl?: string;
  patchPath?: string;
  branch?: string;
}

/**
 * Manages git worktrees for isolated task execution
 */
export interface WorktreeManager {
  /**
   * Creates a new worktree with a named branch for task isolation
   * @param task The task requiring a worktree
   * @returns Worktree information including path and branch name
   */
  createWorktree(task: Task): Promise<Result<WorktreeInfo>>;

  /**
   * Completes a task by executing the configured merge strategy
   * @param task The task to complete
   * @param info Worktree information from createWorktree
   * @returns Result of the merge strategy execution
   */
  completeTask(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>>;

  /**
   * Removes a worktree and cleans up associated resources
   * @param taskId ID of the task whose worktree should be removed
   * @param force Skip safety checks if true
   * @returns Success or error result
   */
  removeWorktree(taskId: TaskId, force?: boolean): Promise<Result<void>>;

  /**
   * Get status information for all worktrees
   * @returns Array of worktree status information
   */
  getWorktreeStatuses(): Promise<Result<WorktreeStatus[]>>;

  /**
   * Get status information for a specific worktree
   * @param taskId Task ID to get status for
   * @returns Worktree status information
   */
  getWorktreeStatus(taskId: TaskId): Promise<Result<WorktreeStatus>>;

  /**
   * Cleans up all active worktrees
   * @returns Success or error result
   */
  cleanup(): Promise<Result<void>>;
}

/**
 * Result type for worktree cleanup operations
 */
export interface WorktreeCleanupResult {
  success: boolean;
  summary: {
    total: number;
    cleaned: number;
    kept: number;
    protected: number;
  };
  details: Array<{
    taskId: string;
    action: 'cleaned' | 'kept' | 'protected';
    reason: string;
    path: string;
    ageInDays: number;
  }>;
  warnings?: string[];
}

/**
 * Schedule management service
 * ARCHITECTURE: Extracted from MCP adapter for CLI reuse
 * Pattern: Service layer with DI, Result types, event emission
 */
export interface ScheduleService {
  createSchedule(request: ScheduleCreateRequest): Promise<Result<Schedule>>;
  listSchedules(status?: ScheduleStatus, limit?: number, offset?: number): Promise<Result<readonly Schedule[]>>;
  getSchedule(scheduleId: ScheduleId, includeHistory?: boolean, historyLimit?: number): Promise<Result<{ schedule: Schedule; history?: readonly ScheduleExecution[] }>>;
  cancelSchedule(scheduleId: ScheduleId, reason?: string): Promise<Result<void>>;
  pauseSchedule(scheduleId: ScheduleId): Promise<Result<void>>;
  resumeSchedule(scheduleId: ScheduleId): Promise<Result<void>>;
}

/**
 * Checkpoint persistence for task resumption
 * ARCHITECTURE: Stores task state snapshots for "smart retry" enrichment
 * Pattern: Repository pattern following ScheduleRepository conventions
 */
export interface CheckpointRepository {
  save(checkpoint: Omit<TaskCheckpoint, 'id'>): Promise<Result<TaskCheckpoint>>;
  findLatest(taskId: TaskId): Promise<Result<TaskCheckpoint | null>>;
  findAll(taskId: TaskId, limit?: number): Promise<Result<readonly TaskCheckpoint[]>>;
  deleteByTask(taskId: TaskId): Promise<Result<void>>;
}