/**
 * Core interfaces for dependency injection
 * All implementations should be injected, not instantiated directly
 */

import { Result } from './result.js';
import { Task, TaskId, Worker, WorkerId, SystemResources, TaskOutput, DelegateRequest } from './domain.js';
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
  findAll(): Promise<Result<readonly Task[]>>;
  findByStatus(status: string): Promise<Result<readonly Task[]>>;
  delete(taskId: TaskId): Promise<Result<void>>;
  cleanupOldTasks(olderThanMs: number): Promise<Result<number>>;
  transaction<T>(fn: (repo: TaskRepository) => Promise<Result<T>>): Promise<Result<T>>;
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
  /** @deprecated Use getStatus() without taskId parameter instead for async task listing */
  listTasks(): Result<readonly Task[]>;

  // Worktree management methods
  listWorktrees(includeStale?: boolean, olderThanDays?: number): Promise<Result<readonly any[]>>;
  getWorktreeStatus(taskId: TaskId): Promise<Result<any>>;
  cleanupWorktrees(strategy?: 'safe' | 'interactive' | 'force', olderThanDays?: number, taskIds?: TaskId[]): Promise<Result<any>>;
}

/**
 * Git worktree management for isolated task execution
 */
// Re-export from the actual implementation
export type { WorktreeManager, WorktreeInfo, CompletionResult, WorktreeStatus, WorktreeManagerConfig } from '../services/worktree-manager.js';

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