# Task Architecture - Quick Reference

> For detailed implementation details, code samples, and line-by-line references, see [TASK_ARCHITECTURE.md](./TASK_ARCHITECTURE.md)

## 1. Task Lifecycle Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        TASK LIFECYCLE WITH DEPENDENCIES                │
└──────────────────────────────────────────────────────────────────────┘

    delegate(request with dependsOn=[taskA, taskB])
                    ↓
        ┌───────────────────────────┐
        │ TaskDelegatedEvent        │
        │ - task created            │
        │ - dependsOn populated     │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ DependencyHandler         │
        │ - Validates DAG           │
        │ - Checks for cycles       │
        │ - Adds to graph           │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ TaskPersistedEvent        │
        │ - task saved to DB        │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ QueueHandler              │
        │ isBlocked(task)?          │
        ├───────────────────────────┤
        │ YES ─→ Wait               │
        │ NO  ─→ Enqueue           │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ TaskQueuedEvent           │
        │ (only if not blocked)     │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ WorkerHandler             │
        │ - Spawns process          │
        │ - Executes task           │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ Task Completes            │
        │ TaskCompleted/Failed/...  │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ DependencyHandler         │
        │ - Resolves dependencies   │
        │ - Gets dependents         │
        │ - Checks if unblocked     │
        │ → Emits TaskUnblocked     │
        └───────────────────────────┘
                    ↓
        ┌───────────────────────────┐
        │ QueueHandler              │
        │ handleTaskUnblocked       │
        │ - Enqueue unblocked task  │
        │ - Emit TaskQueued         │
        └───────────────────────────┘
                    ↓
                [Repeat]
```

## 2. Component Responsibilities

### Core Domain
- **Task Model** (`src/core/domain.ts`) - Task interface with dependsOn/dependents fields
- **DependencyGraph** (`src/core/dependency-graph.ts`) - DAG validation, cycle detection (DFS)
- **Events** (`src/core/events/events.ts`) - TaskDependency* events, TaskUnblocked

### Infrastructure
- **DependencyRepository** (`src/implementations/dependency-repository.ts`) - CRUD + cycle detection
- **Database** (`src/implementations/database.ts`) - task_dependencies table with indexes
- **TaskQueue** (`src/implementations/task-queue.ts`) - Priority min-heap (O(log n))

### Event Handlers
- **DependencyHandler** (`src/services/handlers/dependency-handler.ts`)
  - Listens: TaskDelegated, TaskCompleted, TaskFailed, TaskCancelled
  - Emits: TaskDependencyAdded, TaskDependencyResolved, TaskUnblocked

- **QueueHandler** (`src/services/handlers/queue-handler.ts`)
  - Listens: TaskPersisted, TaskUnblocked
  - Checks: isBlocked() before enqueueing
  - Emits: TaskQueued

> For detailed code samples and line numbers, see [TASK_ARCHITECTURE.md](./TASK_ARCHITECTURE.md)

## 3. Cycle Detection Example

```
Scenario: Task D wants to depend on Task A, but:
  A → B → C → D (already depends on chain)

This would create cycle: A → B → C → D → A

DependencyGraph.wouldCreateCycle('D', 'A'):
  1. Create temp graph with D → A edge
  2. Run DFS from A (the dependency)
  3. Try to reach D (the dependent)
  4. A → B → C → D ✓ Found target!
  5. Return: cycle = true
  6. Reject with ClaudineError(INVALID_OPERATION)
```

**Algorithm**: DFS-based cycle detection (O(V+E))
**Atomicity**: Run inside synchronous database transaction for TOCTOU safety

## 4. Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Cycle detection | O(V+E) | DFS on every dependency add |
| Queue insert | O(log n) | Min-heap |
| Queue remove | O(log n) | Min-heap |
| Is blocked | O(1)* | Indexed DB query |
| Get dependents | O(n) | WHERE depends_on_task_id = ? |
| Topological sort | O(V+E) | Kahn's algorithm |

*Effectively O(1) for typical dependency graphs due to indexes

## 5. Failure Scenarios

### Cycle Detection
```
Task delegates with dependsOn containing a task that depends on it
→ DependencyHandler detects cycle
→ Emits TaskDependencyFailed
→ Task creation fails with INVALID_OPERATION
```

### Task Not Found
```
Task depends on non-existent taskId
→ DependencyRepository validation fails
→ TaskDependencyFailed event
→ Task creation fails with TASK_NOT_FOUND error
```

### Dependency Fails
```
Task A depends on Task B
Task B completes with FAILED status
→ DependencyHandler resolves with 'failed'
→ Task A still gets unblocked and queued
→ User decides if Task A should run anyway
```

## 6. Database Schema

```sql
CREATE TABLE task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'pending',  -- pending|completed|failed|cancelled
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, depends_on_task_id)
);

-- Indexes for fast queries
CREATE INDEX idx_task_dependencies_task_id ON task_dependencies(task_id);
CREATE INDEX idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
CREATE INDEX idx_task_dependencies_blocked ON task_dependencies(task_id, resolution);
```

## 7. Key Events

```typescript
TaskDependencyAdded(taskId, dependsOnTaskId)
  └─ Emitted when dependency successfully added

TaskDependencyResolved(taskId, dependsOnTaskId, resolution)
  └─ resolution: 'completed' | 'failed' | 'cancelled'
  └─ Emitted when blocking task completes

TaskUnblocked(taskId, task)
  └─ Emitted when ALL dependencies resolved
  └─ Signals QueueHandler to enqueue task

TaskDependencyFailed(taskId, failedDependencyId, error)
  └─ Emitted when cycle detected or validation fails
```

## 8. Error Codes

- **INVALID_OPERATION** - Cycle detected, dependency already exists
- **TASK_NOT_FOUND** - Referenced task doesn't exist
- **SYSTEM_ERROR** - Database error, event emission failed

## 9. Testing Strategy

Key integration points to test:
1. ✅ Cycle detection (self, direct, indirect cycles)
2. ✅ Multi-dependency blocking (task waits for ALL)
3. ✅ Dependency resolution (completion, failure, cancellation)
4. ✅ Unblocking propagation (cascading unblocks)
5. ⚠️ Concurrent dependency modifications (TOCTOU protection)
6. ⚠️ Large graphs (1000+ tasks, 10000+ dependencies)

---

## See Also

- **[TASK_ARCHITECTURE.md](./TASK_ARCHITECTURE.md)** - Comprehensive analysis with code samples and line references
- **[EVENT_FLOW.md](./EVENT_FLOW.md)** - Event-driven architecture patterns
- **[../task-dependencies.md](../task-dependencies.md)** - User-facing API documentation
