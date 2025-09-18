# Integration Testing Architecture

## Principles

Integration tests should verify that **multiple components work together correctly** without spawning real external processes.

### ✅ What Integration Tests Should Do

1. **Test component interaction** - EventBus + Handlers + Repositories
2. **Test data flow** - Task → Queue → Worker Pool → Persistence
3. **Test event propagation** - Events flow correctly through the system
4. **Test error handling** - Components handle failures from other components
5. **Use dependency injection** - Real components with mocked external dependencies

### ❌ What Integration Tests Should NOT Do

1. **Spawn real processes** - No `claude` or `claudine` subprocesses
2. **Make network calls** - No real HTTP/WebSocket connections
3. **Use real file systems** - Use in-memory databases and temp directories
4. **Have long timeouts** - Should complete in seconds, not minutes

## Test Architecture

### Mock External Dependencies

```typescript
// Mock ProcessSpawner - no real process spawning
class MockProcessSpawner implements ProcessSpawner {
  async spawn(command: string[]): Promise<Result<ChildProcess, Error>> {
    return ok({
      pid: Math.floor(Math.random() * 10000),
      kill: vi.fn().mockResolvedValue(ok(undefined)),
      stdout: new MockReadableStream(),
      stderr: new MockReadableStream(),
      stdin: new MockWritableStream()
    });
  }
}

// Mock ResourceMonitor - controlled resource values
class MockResourceMonitor implements ResourceMonitor {
  constructor(private resources: { cpu: number; memory: number }) {}

  async getResources() {
    return ok(this.resources);
  }
}
```

### Test Real Component Integration

```typescript
describe('Task Delegation Integration', () => {
  let eventBus: InMemoryEventBus;
  let taskManager: TaskManagerService;
  let queueHandler: QueueHandler;
  let persistenceHandler: PersistenceHandler;

  beforeEach(() => {
    // Real components with mocked dependencies
    eventBus = new InMemoryEventBus(logger);
    taskManager = new TaskManagerService(eventBus, mockRepo, logger);
    queueHandler = new QueueHandler(mockQueue, logger);
    persistenceHandler = new PersistenceHandler(mockRepo, logger);

    // Wire up the real event system
    await queueHandler.setup(eventBus);
    await persistenceHandler.setup(eventBus);
  });

  it('should persist and queue delegated tasks', async () => {
    // Delegate task through TaskManager
    const result = await taskManager.delegate({ prompt: 'test' });

    // Verify events were emitted and handled
    expect(mockRepo.save).toHaveBeenCalled();
    expect(mockQueue.enqueue).toHaveBeenCalled();
  });
});
```

### Event Flow Testing

```typescript
describe('Event Flow Integration', () => {
  it('should complete full task lifecycle through events', async () => {
    const eventSpy = new EventSpy(eventBus);

    // Start task delegation
    await taskManager.delegate({ prompt: 'test task' });

    // Verify event sequence
    expect(eventSpy.hasEventSequence([
      'TaskDelegated',
      'TaskPersisted',
      'TaskQueued',
      'TaskStarting',
      'TaskStarted'
    ])).toBe(true);
  });
});
```

## File Structure

```
tests/integration/
├── README.md                    # This file
├── fixtures/
│   ├── mock-process-spawner.ts  # Mock external process calls
│   ├── mock-resource-monitor.ts # Mock system resources
│   ├── event-spy.ts            # Event sequence verification
│   └── test-container.ts       # DI container with mocks
├── event-flow.test.ts          # Test event propagation
├── task-lifecycle.test.ts      # Full task flow without processes
├── error-handling.test.ts      # Component error interaction
└── persistence-flow.test.ts    # Database + Queue + Events
```

## Implementation Guidelines

1. **Use in-memory SQLite** - `new Database(':memory:')`
2. **Mock ProcessSpawner** - No real `claude` processes
3. **Mock ResourceMonitor** - Controllable CPU/memory values
4. **Real EventBus** - Test actual event propagation
5. **Real Handlers** - Test component interactions
6. **Fast execution** - All tests < 5 seconds total
7. **Isolated tests** - Clean setup/teardown
8. **Deterministic** - No race conditions or randomness