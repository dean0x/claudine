# Event Flow Architecture

Claudine uses a **pure event-driven architecture** where all components communicate through a central EventBus. This document explains the event flows for common operations.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         EventBus (Central Hub)                   │
│                                                                   │
│  • Fire-and-forget: emit()                                      │
│  • Request-response: request() + respond()                      │
│  • Correlation IDs for tracking                                 │
│  • Handler profiling (warns if >100ms)                          │
└─────────────────────────────────────────────────────────────────┘
                              ▲ │
        ┌─────────────────────┘ └─────────────────────┐
        │                                              │
   ┌────▼────┐  ┌──────────┐  ┌──────────┐  ┌─────────▼──────┐
   │ Persist │  │  Queue   │  │  Worker  │  │     Output     │
   │ Handler │  │ Handler  │  │ Handler  │  │    Handler     │
   └─────────┘  └──────────┘  └──────────┘  └────────────────┘
        │            │              │               │
        ▼            ▼              ▼               ▼
   [Database]   [Task Queue]  [Worker Pool]  [Output Capture]
```

## Event Types

### Command Events (Fire-and-Forget)
- `TaskDelegated` - New task submitted
- `TaskQueued` - Task added to queue
- `TaskStarted` - Worker spawned for task
- `TaskCompleted` - Task finished successfully
- `TaskFailed` - Task execution failed
- `TaskCancelled` - Task cancelled by user
- `WorkerSpawned` - New worker process created
- `OutputCaptured` - Worker output received

### Query Events (Request-Response)
- `TaskStatusQuery` - Get task details
- `TaskLogsQuery` - Fetch task output
- `NextTaskQuery` - Dequeue next task
- `ListTasksQuery` - Get all tasks

## Common Event Flows

### 1. Task Delegation Flow

```
User/MCP Client
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. TaskManager.delegate()                                      │
│    • Validates input                                           │
│    • Creates Task object                                       │
│    • Emits: TaskDelegated                                      │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. PersistenceHandler.handleTaskDelegated()                   │
│    • Saves task to database                                    │
│    • Emits: TaskPersisted                                      │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. QueueHandler.handleTaskPersisted()                         │
│    • Adds task to priority queue                               │
│    • Emits: TaskQueued                                         │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. WorkerHandler.handleTaskQueued()                           │
│    • Checks resources (canSpawnWorker)                         │
│    • Enforces 10s spawn delay (burst protection)               │
│    • Requests: NextTaskQuery                                   │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 5. QueueHandler.handleNextTaskQuery()                         │
│    • Dequeues highest priority task                            │
│    • Responds with Task via correlation ID                     │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 6. WorkerHandler (continued)                                   │
│    • Spawns claude-code process                                │
│    • Records spawn time (for throttling)                       │
│    • Emits: WorkerSpawned + TaskStarted                        │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 7. PersistenceHandler.handleTaskStarted()                     │
│    • Updates task status to RUNNING                            │
│    • Records worker ID and start time                          │
└───────────────────────────────────────────────────────────────┘
```

### 2. Task Completion Flow

```
Worker Process (claude-code)
    │
    ▼ (process exits)
┌───────────────────────────────────────────────────────────────┐
│ 1. WorkerPool.onWorkerExit()                                  │
│    • Captures exit code                                        │
│    • Requests: TaskStatusQuery (to get full task)             │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. QueryHandler.handleTaskStatusQuery()                       │
│    • Fetches task from database                                │
│    • Responds with Task via correlation ID                     │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. WorkerHandler.onWorkerComplete()                           │
│    • Determines success/failure from exit code                 │
│    • Emits: TaskCompleted OR TaskFailed                        │
│    • Decrements worker count                                   │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. PersistenceHandler.handleTaskCompleted/Failed()            │
│    • Updates task status (COMPLETED/FAILED)                    │
│    • Records completion time and exit code                     │
└───────────────────────────────────────────────────────────────┘
```

### 3. Task Cancellation Flow

```
User Request
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. TaskManager.cancel()                                        │
│    • Validates task ID                                         │
│    • Emits: TaskCancellationRequested                          │
└───────────────────────────────────────────────────────────────┘
    │
    ├────▶ QueueHandler.handleTaskCancellation()
    │      • Removes from queue if queued
    │
    └────▶ WorkerHandler.handleTaskCancellation()
           │
           ▼
       ┌────────────────────────────────────────────┐
       │ Requests: TaskStatusQuery                   │
       │ • Gets task to find worker ID              │
       └────────────────────────────────────────────┘
           │
           ▼
       ┌────────────────────────────────────────────┐
       │ WorkerPool.kill(workerId)                   │
       │ • Sends SIGTERM to process                 │
       │ • 5s grace period, then SIGKILL            │
       └────────────────────────────────────────────┘
           │
           ▼
       ┌────────────────────────────────────────────┐
       │ Emits: TaskCancelled                        │
       └────────────────────────────────────────────┘
           │
           ▼
       ┌────────────────────────────────────────────┐
       │ PersistenceHandler.handleTaskCancelled()    │
       │ • Updates task status to CANCELLED          │
       └────────────────────────────────────────────┘
```

### 4. Recovery Flow (Server Restart)

```
Server Startup
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. RecoveryManager.recover()                                   │
│    • Emits: RecoveryStarted                                    │
│    • Queries database for non-terminal tasks                   │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. Handle QUEUED tasks                                         │
│    • Safety check: not already in queue                        │
│    • Enqueue task                                              │
│    • Emits: TaskQueued                                         │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. Handle RUNNING tasks (STALE DETECTION)                     │
│                                                                 │
│  IF task age > 30 minutes (STALE):                            │
│    • Mark as FAILED (exit code -1)                            │
│    • Log: "Marked stale crashed task as failed"              │
│                                                                 │
│  IF task age < 30 minutes (RECENT):                           │
│    • Re-queue for recovery                                     │
│    • Emits: TaskQueued                                         │
│    • Log: "Re-queued recent running task for recovery"       │
│                                                                 │
│  WHY: Prevents fork-bomb on restart from old tasks            │
│       See: RecoveryManager JSDoc for incident details          │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. WorkerHandler.handleTaskQueued()                           │
│    • Enforces 10s spawn delay between workers                 │
│    • Prevents burst spawning during recovery                   │
│    • See: WorkerHandler JSDoc for fork-bomb prevention        │
└───────────────────────────────────────────────────────────────┘
```

## Request-Response Pattern Details

The EventBus supports request-response for queries using correlation IDs:

```typescript
// 1. Requester sends event with correlation ID
const result = await eventBus.request<TaskStatusQueryEvent, Task>(
  'TaskStatusQuery',
  { taskId: 'task-123' }
);
// Internally generates correlationId: 'uuid-abc'

// 2. Handler receives event
handler(event) {
  const correlationId = event.__correlationId;
  const task = await database.find(event.taskId);

  // 3. Handler responds via correlation ID
  eventBus.respond(correlationId, task);
}

// 4. Requester receives response (or timeout after 5s)
if (result.ok) {
  console.log(result.value); // Task object
}
```

## Performance Monitoring

The EventBus automatically profiles all handlers:

- **Slow Handler Warning**: Logs warning if handler takes >100ms
- **Metrics Logged**:
  - Total duration for all handlers
  - Per-handler execution time
  - Count of slow handlers
- **Debug Logs**: Full timing data for investigation

Example output:
```
WARN: Slow event handler detected {
  eventType: 'TaskPersisted',
  handlerIndex: 2,
  duration: 250,
  threshold: 100
}

DEBUG: Event handlers completed {
  eventType: 'TaskPersisted',
  eventId: 'evt-123',
  handlerCount: 3,
  totalDuration: 267,
  slowHandlers: 1
}
```

## Critical Safeguards

### 1. Spawn Burst Protection (WorkerHandler)

**Problem**: Resource checks happen BEFORE spawn, creating race condition.

**Solution**: 50ms minimum delay between spawns.

```
Without delay:
  TaskQueued #1 → canSpawn? YES → spawn
  TaskQueued #2 → canSpawn? YES → spawn (too fast!)
  TaskQueued #3 → canSpawn? YES → spawn (fork bomb!)

With 50ms delay:
  TaskQueued #1 → canSpawn? YES → spawn → wait 50ms
  TaskQueued #2 → canSpawn? YES (sees worker #1) → spawn → wait 50ms
  TaskQueued #3 → canSpawn? NO (resources used) → backoff
```

**Code**: `src/services/handlers/worker-handler.ts:21-48`

### 2. Stale Task Detection (RecoveryManager)

**Problem**: Crashed tasks stuck in RUNNING status cause fork-bomb on restart.

**Solution**: 30-minute threshold - old tasks marked FAILED, recent tasks re-queued.

```
Server restart with 10 RUNNING tasks:

Age > 30 min (7 tasks):  MARK AS FAILED (don't re-queue)
Age < 30 min (3 tasks):  RE-QUEUE (might be legitimate)

Result: Only 3 workers spawn instead of 10
```

**Code**: `src/services/recovery-manager.ts:88-175`

### 3. Handler Profiling (EventBus)

**Problem**: Slow handlers block event processing.

**Solution**: Automatic timing with warnings for handlers >100ms.

**Code**: `src/core/events/event-bus.ts:157-211`

## Event Handler Registration

Most handlers follow this standard pattern:

```typescript
class MyHandler extends BaseEventHandler {
  async setup(eventBus: EventBus): Promise<Result<void>> {
    const subscriptions = [
      eventBus.subscribe('EventType', this.handleEvent.bind(this))
    ];

    for (const result of subscriptions) {
      if (!result.ok) return result;
    }

    return ok(undefined);
  }

  private async handleEvent(event: EventType): Promise<void> {
    await this.handleEvent(event, async (evt) => {
      // Handler logic here
      return ok(undefined);
    });
  }
}
```

**Exception: Factory Pattern for Async Initialization**

Handlers requiring async initialization (e.g., loading data from database) use factory pattern instead:

```typescript
class DependencyHandler extends BaseEventHandler {
  private constructor(/* dependencies + initialized state */) {
    super(logger, 'DependencyHandler');
  }

  static async create(
    /* dependencies */
  ): Promise<Result<DependencyHandler>> {
    // Load initial state asynchronously
    const data = await repository.loadData();
    if (!data.ok) return data;

    // Create handler with initialized state
    const handler = new DependencyHandler(/* deps + state */);

    // Subscribe to events
    await handler.subscribeToEvents();

    return ok(handler);
  }
}

// Usage in bootstrap
const handlerResult = await DependencyHandler.create(/* deps */);
if (!handlerResult.ok) return handlerResult;
const handler = handlerResult.value;
```

**Why Factory Pattern?**
- Eliminates definite assignment assertions for async-initialized fields
- Makes invalid states unrepresentable (can't use handler before initialization)
- Follows Result pattern consistently
- Prevents TOCTOU issues by loading state before handler is active

## Debugging Event Flows

Enable debug logging to see full event flow:

```bash
LOG_LEVEL=debug claudine mcp start
```

You'll see:
- Event emissions with IDs and timestamps
- Handler execution times
- Correlation IDs for request-response
- Slow handler warnings
- Full event payloads

## Architecture Benefits

1. **Loose Coupling**: Components don't know about each other
2. **Testability**: Mock EventBus for unit tests
3. **Observability**: All operations logged centrally
4. **Performance**: Automatic profiling catches slow handlers
5. **Reliability**: Request timeouts prevent hanging queries
6. **Safety**: Built-in safeguards prevent fork-bombs and race conditions

## Future Improvements

See removal criteria in:
- `WorkerHandler` spawn delay (lines 40-44)
- `RecoveryManager` stale detection (lines 101-106)

Only remove these safeguards if you implement the suggested alternatives.
