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
  remove(taskId: TaskId): Result<void>;
  getAll(): Result<readonly Task[]>;
  contains(taskId: TaskId): boolean;
  size(): number;
  clear(): Result<void>;
}

/**
 * Process spawning abstraction
 */
export interface ProcessSpawner {
  spawn(
    prompt: string,
    workingDirectory: string
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
  readonly cpuThreshold: number;
  readonly memoryReserve: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
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

/**
 * Event bus for coordinating system events
 */
export interface EventBus {
  emit<T extends ClaudineEvent>(type: T['type'], payload: Omit<T, keyof BaseEvent | 'type'>): Promise<Result<void>>;
  subscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<void>;
  unsubscribe<T extends ClaudineEvent>(eventType: T['type'], handler: EventHandler<T>): Result<void>;
  subscribeAll(handler: EventHandler): Result<void>;
  unsubscribeAll(handler: EventHandler): Result<void>;
}

/**
 * Main task manager orchestrator
 */
export interface TaskManager {
  delegate(request: DelegateRequest): Promise<Result<Task>>;
  getStatus(taskId?: TaskId): Promise<Result<Task | readonly Task[]>>;
  getLogs(taskId: TaskId, tail?: number): Promise<Result<TaskOutput>>;
  cancel(taskId: TaskId, reason?: string): Promise<Result<void>>;
  /** @deprecated Use getStatus() without taskId parameter instead for async task listing */
  listTasks(): Result<readonly Task[]>;
}