# Refactoring Plan for SOLID Architecture

## Current Issues

### 1. Violations of SOLID Principles

#### Single Responsibility Principle (SRP) ❌
- `ClaudineServer` class does everything:
  - MCP protocol handling
  - Process spawning
  - Task management
  - Output capture
  - Git worktree management
  - History management

#### Open/Closed Principle (OCP) ❌
- Adding new tools requires modifying the main server class
- No plugin or extension mechanism

#### Liskov Substitution Principle (LSP) ⚠️
- Not applicable yet (no inheritance used)

#### Interface Segregation Principle (ISP) ❌
- No interfaces defined
- Everything is concrete implementations

#### Dependency Inversion Principle (DIP) ❌
- High-level modules depend on low-level details
- Direct process spawning instead of abstractions
- No dependency injection

### 2. Engineering Principle Violations

1. **Throws errors instead of Result types** ❌
2. **No dependency injection** ❌
3. **No composition or pipes** ❌
4. **Mutable state everywhere** ❌
5. **Uses `any` types** ❌
6. **No integration tests** ❌
7. **No resource cleanup patterns** ❌
8. **Console.log instead of structured logging** ❌
9. **Validation mixed with business logic** ❌
10. **No performance monitoring** ❌

## Proposed Architecture

### Core Modules (Following SRP)

```typescript
// 1. Result Type (Foundation)
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

// 2. Domain Models (Pure, Immutable)
interface Task {
  readonly id: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly priority: Priority;
  // ... other fields
}

// 3. Process Management (Interface)
interface ProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): Result<Process>;
}

// 4. Resource Monitoring (Interface)
interface ResourceMonitor {
  getAvailableResources(): Result<SystemResources>;
  canSpawnWorker(): Result<boolean>;
}

// 5. Task Queue (Interface)
interface TaskQueue {
  enqueue(task: Task): Result<void>;
  dequeue(): Result<Task | null>;
  peek(): Result<Task | null>;
  size(): number;
}

// 6. Task Manager (Orchestration)
class TaskManager {
  constructor(
    private readonly queue: TaskQueue,
    private readonly spawner: ProcessSpawner,
    private readonly monitor: ResourceMonitor,
    private readonly logger: Logger
  ) {}
  
  delegate(request: DelegateRequest): Result<Task> {
    return pipe(
      this.validateRequest,
      this.createTask,
      this.enqueueTask,
      this.processIfPossible
    )(request);
  }
}

// 7. Autoscaling Manager (New)
class AutoscalingManager {
  constructor(
    private readonly monitor: ResourceMonitor,
    private readonly queue: TaskQueue,
    private readonly workers: WorkerPool,
    private readonly logger: Logger
  ) {}
  
  async run(): Promise<void> {
    while (true) {
      const result = await this.scaleWorkers();
      if (!result.ok) {
        this.logger.error('Scaling failed', result.error);
      }
      await sleep(1000); // Check every second
    }
  }
  
  private scaleWorkers(): Result<void> {
    return pipe(
      this.checkResources,
      this.determineWorkerCount,
      this.adjustWorkers
    )();
  }
}

// 8. MCP Protocol Handler (Separated)
class MCPHandler {
  constructor(
    private readonly taskManager: TaskManager,
    private readonly logger: Logger
  ) {}
  
  handleRequest(request: MCPRequest): Result<MCPResponse> {
    // Route to appropriate handler
  }
}
```

### Dependency Injection Container

```typescript
// Simple DI container
class Container {
  private readonly services = new Map<string, any>();
  
  register<T>(name: string, factory: () => T): void {
    this.services.set(name, factory());
  }
  
  get<T>(name: string): T {
    return this.services.get(name);
  }
}

// Bootstrap
const container = new Container();

container.register('logger', () => new StructuredLogger());
container.register('monitor', () => new SystemResourceMonitor());
container.register('queue', () => new FIFOTaskQueue());
container.register('spawner', () => new ClaudeProcessSpawner());
container.register('workers', () => new WorkerPool(
  container.get('spawner'),
  container.get('logger')
));
container.register('taskManager', () => new TaskManager(
  container.get('queue'),
  container.get('spawner'),
  container.get('monitor'),
  container.get('logger')
));
container.register('autoscaler', () => new AutoscalingManager(
  container.get('monitor'),
  container.get('queue'),
  container.get('workers'),
  container.get('logger')
));
```

### Functional Composition with Pipes

```typescript
// Pipe utility
const pipe = <T>(...fns: Array<(arg: T) => T>) => (value: T): T =>
  fns.reduce((acc, fn) => fn(acc), value);

// Composable functions
const validateInput = (input: unknown): Result<ValidatedInput> => {
  const result = inputSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: new ValidationError(result.error) };
};

const checkResources = (input: ValidatedInput): Result<InputWithResources> => {
  const resources = resourceMonitor.getAvailableResources();
  return resources.ok
    ? { ok: true, value: { ...input, resources: resources.value } }
    : resources;
};

const spawnWorker = (input: InputWithResources): Result<RunningTask> => {
  // Spawn worker logic
};

// Usage
const processTask = pipe(
  validateInput,
  checkResources,
  spawnWorker,
  captureOutput,
  handleResult
);
```

## Implementation Steps

### Phase 1: Core Refactoring (Week 1)
1. Create Result type and utilities
2. Extract interfaces for all services
3. Implement dependency injection
4. Separate MCP handler from business logic
5. Create immutable Task model

### Phase 2: Modularization (Week 2)
1. Extract ProcessSpawner module
2. Extract ResourceMonitor module
3. Extract TaskQueue module
4. Create WorkerPool abstraction
5. Implement AutoscalingManager

### Phase 3: Functional Patterns (Week 3)
1. Implement pipe utility
2. Convert handlers to composable functions
3. Replace mutations with immutable updates
4. Add structured logging
5. Implement resource cleanup patterns

### Phase 4: Testing (Week 4)
1. Create test doubles for all interfaces
2. Write integration tests for task flow
3. Add performance benchmarks
4. Test autoscaling behavior
5. Test error handling with Result types

## Benefits After Refactoring

1. **Testability**: Can inject mocks for all dependencies
2. **Maintainability**: Each module has single responsibility
3. **Extensibility**: Easy to add new features without modifying existing code
4. **Reliability**: Result types prevent unhandled errors
5. **Performance**: Can optimize individual modules
6. **Scalability**: Clean separation enables distributed architecture
7. **Type Safety**: No any types, everything is explicit
8. **Debugging**: Structured logging with full context

## Migration Strategy

1. **Keep existing code working** while refactoring
2. **Create new modules alongside old** code
3. **Gradually migrate** functionality
4. **Maintain backward compatibility** during transition
5. **Feature flag** new implementation
6. **Test in parallel** before switching
7. **Document breaking changes** if any

## Success Metrics

- Zero `any` types in codebase
- 100% of functions return Result types
- All dependencies injected
- 90%+ test coverage
- All state immutable
- Structured JSON logging throughout
- Performance benchmarks for critical paths
- Clean separation of concerns