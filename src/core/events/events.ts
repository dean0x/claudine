/**
 * Event type definitions for the event-driven architecture
 * All system state changes flow through these events
 */

import { Task, TaskId, Worker, WorkerId } from '../domain.js';
import { ClaudineError } from '../errors.js';

/**
 * Base event interface - all events extend this
 */
export interface BaseEvent {
  eventId: string;
  timestamp: number;
  source: string;
}

/**
 * Task lifecycle events
 */
export interface TaskDelegatedEvent extends BaseEvent {
  type: 'TaskDelegated';
  task: Task;
}

export interface TaskPersistedEvent extends BaseEvent {
  type: 'TaskPersisted';
  taskId: TaskId;
  task: Task;  // Include full task for QueueHandler
}

export interface TaskQueuedEvent extends BaseEvent {
  type: 'TaskQueued';
  taskId: TaskId;
}

export interface TaskStartingEvent extends BaseEvent {
  type: 'TaskStarting';
  taskId: TaskId;
}

export interface TaskStartedEvent extends BaseEvent {
  type: 'TaskStarted';
  taskId: TaskId;
  workerId: WorkerId;
}

export interface TaskCompletedEvent extends BaseEvent {
  type: 'TaskCompleted';
  taskId: TaskId;
  exitCode: number;
  duration: number;
}

export interface TaskFailedEvent extends BaseEvent {
  type: 'TaskFailed';
  taskId: TaskId;
  error: ClaudineError;
  exitCode?: number;
}

export interface TaskCancelledEvent extends BaseEvent {
  type: 'TaskCancelled';
  taskId: TaskId;
  reason?: string;
}

export interface TaskTimeoutEvent extends BaseEvent {
  type: 'TaskTimeout';
  taskId: TaskId;
  error: ClaudineError;
}

export interface TaskCancellationRequestedEvent extends BaseEvent {
  type: 'TaskCancellationRequested';
  taskId: TaskId;
  reason?: string;
}

export interface LogsRequestedEvent extends BaseEvent {
  type: 'LogsRequested';
  taskId: TaskId;
  tail?: number;
}

/**
 * Worker lifecycle events
 */
export interface WorkerSpawnedEvent extends BaseEvent {
  type: 'WorkerSpawned';
  worker: Worker;
  taskId: TaskId;
}

export interface WorkerKilledEvent extends BaseEvent {
  type: 'WorkerKilled';
  workerId: WorkerId;
  taskId: TaskId;
}


/**
 * Output and configuration events
 */
export interface OutputCapturedEvent extends BaseEvent {
  type: 'OutputCaptured';
  taskId: TaskId;
  outputType: 'stdout' | 'stderr';
  data: string;
}

export interface TaskConfiguredEvent extends BaseEvent {
  type: 'TaskConfigured';
  taskId: TaskId;
  config: {
    maxOutputBuffer?: number;
    timeout?: number;
  };
}

/**
 * Query events - for read operations in pure event-driven architecture
 * ARCHITECTURE: Part of pure event-driven pattern - ALL operations go through events
 */
export interface TaskStatusQueryEvent extends BaseEvent {
  type: 'TaskStatusQuery';
  taskId?: TaskId;  // If omitted, return all tasks
}

export interface TaskStatusResponseEvent extends BaseEvent {
  type: 'TaskStatusResponse';
  result: Task | readonly Task[];
}

export interface TaskLogsQueryEvent extends BaseEvent {
  type: 'TaskLogsQuery';
  taskId: TaskId;
  tail?: number;
}

export interface TaskLogsResponseEvent extends BaseEvent {
  type: 'TaskLogsResponse';
  taskId: TaskId;
  stdout: readonly string[];
  stderr: readonly string[];
  totalSize: number;
}

/**
 * Queue query events - for pure event-driven queue operations
 */
export interface NextTaskQueryEvent extends BaseEvent {
  type: 'NextTaskQuery';
}

export interface RequeueTaskEvent extends BaseEvent {
  type: 'RequeueTask';
  task: Task;
}

/**
 * Worktree query events - for pure event-driven worktree operations
 * ARCHITECTURE: Completes event-driven refactor for worktree management
 */
export interface WorktreeListQueryEvent extends BaseEvent {
  type: 'WorktreeListQuery';
  includeStale?: boolean;
  olderThanDays?: number;
}

export interface WorktreeStatusQueryEvent extends BaseEvent {
  type: 'WorktreeStatusQuery';
  taskId: TaskId;
}

export interface WorktreeCleanupRequestedEvent extends BaseEvent {
  type: 'WorktreeCleanupRequested';
  strategy?: 'safe' | 'interactive' | 'force';
  olderThanDays?: number;
  taskIds?: TaskId[];
}

/**
 * Dependency events - for task dependency management
 * ARCHITECTURE: Part of DAG-based task dependency system
 * Pattern: Event-driven dependency validation and resolution tracking
 */
export interface TaskDependencyAddedEvent extends BaseEvent {
  type: 'TaskDependencyAdded';
  taskId: TaskId;
  dependsOnTaskId: TaskId;
}

export interface TaskDependencyResolvedEvent extends BaseEvent {
  type: 'TaskDependencyResolved';
  taskId: TaskId;
  dependsOnTaskId: TaskId;
  resolution: 'completed' | 'failed' | 'cancelled';
}

export interface TaskUnblockedEvent extends BaseEvent {
  type: 'TaskUnblocked';
  taskId: TaskId;
  task: Task;  // ARCHITECTURE: Include task to prevent layer violation in QueueHandler
}

export interface TaskDependencyFailedEvent extends BaseEvent {
  type: 'TaskDependencyFailed';
  taskId: TaskId;
  failedDependencyId: TaskId;
  error: ClaudineError;
}

/**
 * System events
 */
export interface SystemResourcesUpdatedEvent extends BaseEvent {
  type: 'SystemResourcesUpdated';
  cpuPercent: number;
  memoryUsed: number;
  workerCount: number;
}

export interface RecoveryStartedEvent extends BaseEvent {
  type: 'RecoveryStarted';
}

export interface RecoveryCompletedEvent extends BaseEvent {
  type: 'RecoveryCompleted';
  tasksRecovered: number;
  tasksMarkedFailed: number;
}

/**
 * Union type of all events
 */
export type ClaudineEvent =
  // Task lifecycle events
  | TaskDelegatedEvent
  | TaskPersistedEvent
  | TaskQueuedEvent
  | TaskStartingEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | TaskTimeoutEvent
  | TaskCancellationRequestedEvent
  | LogsRequestedEvent
  // Query events (pure event-driven architecture)
  | TaskStatusQueryEvent
  | TaskStatusResponseEvent
  | TaskLogsQueryEvent
  | TaskLogsResponseEvent
  // Queue query events
  | NextTaskQueryEvent
  | RequeueTaskEvent
  // Worktree query events
  | WorktreeListQueryEvent
  | WorktreeStatusQueryEvent
  | WorktreeCleanupRequestedEvent
  // Dependency events
  | TaskDependencyAddedEvent
  | TaskDependencyResolvedEvent
  | TaskUnblockedEvent
  | TaskDependencyFailedEvent
  // Worker events
  | WorkerSpawnedEvent
  | WorkerKilledEvent
  // Output events
  | OutputCapturedEvent
  | TaskConfiguredEvent
  // System events
  | SystemResourcesUpdatedEvent
  | RecoveryStartedEvent
  | RecoveryCompletedEvent;

/**
 * Event handler function type
 */
export type EventHandler<T extends ClaudineEvent = ClaudineEvent> = (event: T) => Promise<void>;

/**
 * Helper to create events with consistent metadata
 */
export function createEvent<T extends ClaudineEvent>(
  type: T['type'], 
  payload: Omit<T, keyof BaseEvent | 'type'>,
  source = 'claudine'
): T {
  return {
    type,
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    source,
    ...payload
  } as T;
}