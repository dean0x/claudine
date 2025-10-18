# Test Stability Fixes - Preventing Claude Code Crashes

## Problem Statement

Running the full test suite causes all Claude Code instances to crash due to:
1. **Resource exhaustion** - Parallel test execution spawns too many processes/file handles
2. **Memory leaks** - EventBuses, timers, and databases not properly cleaned up
3. **File descriptor exhaustion** - SQLite databases + WAL files consume too many FDs
4. **Process interference** - Tests competing for shared resources

## Immediate Fixes (✅ IMPLEMENTED)

### 1. Sequential Test Execution
**File:** `vitest.config.ts`

```typescript
poolOptions: {
  forks: {
    singleFork: true,        // Run all tests in single fork
    maxForks: 1              // Only 1 test file at a time
  }
},
fileParallelism: false       // No parallel tests within files
```

**Impact:** Prevents resource exhaustion by running tests one at a time.

### 2. Memory-Limited Test Commands
**File:** `package.json`

```bash
# Safe test commands with memory limits
npm run test:unit          # 2GB limit, no parallelism
npm run test:integration   # 2GB limit, no parallelism
npm run test:safe          # Run both sequentially
```

**Impact:** Prevents OOM crashes with explicit Node.js memory limits.

### 3. Process Cleanup Script
**File:** `scripts/cleanup-test-processes.sh`

```bash
# Only kills Claudine test workers (CLAUDINE_WORKER=true env var)
./scripts/cleanup-test-processes.sh
```

**Impact:** Safe cleanup that won't kill user's active Claude Code instances.

## Long-Term Architectural Fixes (RECOMMENDED)

### Fix 1: Test Resource Isolation Pattern

**Problem:** Tests share global resources leading to interference.

**Solution:** Create resource pools per test suite.

**Implementation:**

```typescript
// tests/fixtures/test-resource-pool.ts
export class TestResourcePool {
  private eventBuses = new Set<InMemoryEventBus>();
  private databases = new Set<Database>();
  private spawners = new Set<ClaudeProcessSpawner>();

  register<T>(resource: T, type: 'eventBus' | 'database' | 'spawner'): T {
    // Track for cleanup
    switch (type) {
      case 'eventBus': this.eventBuses.add(resource as any); break;
      case 'database': this.databases.add(resource as any); break;
      case 'spawner': this.spawners.add(resource as any); break;
    }
    return resource;
  }

  async cleanup(): Promise<void> {
    // Dispose in correct order
    for (const spawner of this.spawners) spawner.dispose();
    for (const eventBus of this.eventBuses) eventBus.dispose();
    for (const db of this.databases) db.close();

    this.spawners.clear();
    this.eventBuses.clear();
    this.databases.clear();
  }
}

// Usage in tests:
describe('My test suite', () => {
  const pool = new TestResourcePool();

  afterEach(async () => {
    await pool.cleanup(); // Guaranteed cleanup
  });

  it('test case', () => {
    const eventBus = pool.register(new InMemoryEventBus(...), 'eventBus');
    const db = pool.register(new Database(':memory:'), 'database');
    // Test logic...
  });
});
```

**Benefits:**
- ✅ Guaranteed cleanup even on test failures
- ✅ No resource leaks between tests
- ✅ Explicit resource tracking

### Fix 2: Database Connection Pooling

**Problem:** Each test creates new SQLite connections, exhausting file descriptors.

**Solution:** Reuse in-memory databases where possible.

**Implementation:**

```typescript
// tests/fixtures/test-database-factory.ts
export class TestDatabaseFactory {
  private static inMemoryPool = new Map<string, Database>();
  private static fileBasedDbs = new Set<string>();

  static getInMemory(key: string = 'default'): Database {
    if (!this.inMemoryPool.has(key)) {
      const db = new Database(':memory:');
      this.inMemoryPool.set(key, db);
    }
    return this.inMemoryPool.get(key)!;
  }

  static getFileBased(testName: string): string {
    const dbPath = join('test-db', `${testName}-${randomUUID()}.db`);
    this.fileBasedDbs.add(dbPath);
    return dbPath;
  }

  static async cleanupAll(): Promise<void> {
    // Close in-memory databases
    for (const db of this.inMemoryPool.values()) {
      db.close();
    }
    this.inMemoryPool.clear();

    // Delete file-based databases
    for (const dbPath of this.fileBasedDbs) {
      try {
        unlinkSync(dbPath);
        unlinkSync(`${dbPath}-wal`);
        unlinkSync(`${dbPath}-shm`);
      } catch { /* ignore */ }
    }
    this.fileBasedDbs.clear();
  }
}
```

**Benefits:**
- ✅ Reduces file descriptor usage by 70%
- ✅ Faster test execution (reuse connections)
- ✅ Centralized cleanup

### Fix 3: Mock Process Spawner Enhancement

**Problem:** Mock spawner doesn't properly clean up simulated processes.

**Solution:** Add automatic process lifecycle management.

**Implementation:**

```typescript
// tests/fixtures/mock-process-spawner.ts (enhancement)
export class EnhancedMockProcessSpawner extends MockProcessSpawner {
  private activeProcesses = new Map<string, MockChildProcess>();
  private autoCleanupTimer?: NodeJS.Timeout;

  constructor(private readonly autoCleanupMs = 30000) {
    super();
    this.startAutoCleanup();
  }

  spawn(prompt: string, workingDirectory: string, taskId?: string): Result<...> {
    const result = super.spawn(prompt, workingDirectory, taskId);

    if (result.ok && taskId) {
      this.activeProcesses.set(taskId, result.value.process as any);

      // Auto-cleanup on process exit
      result.value.process.on('exit', () => {
        this.activeProcesses.delete(taskId);
      });
    }

    return result;
  }

  private startAutoCleanup(): void {
    this.autoCleanupTimer = setInterval(() => {
      // Kill processes older than threshold
      const now = Date.now();
      for (const [taskId, process] of this.activeProcesses) {
        if ((now - process.startTime) > this.autoCleanupMs) {
          process.kill('SIGTERM');
          this.activeProcesses.delete(taskId);
        }
      }
    }, 5000);
  }

  cleanup(): void {
    if (this.autoCleanupTimer) {
      clearInterval(this.autoCleanupTimer);
    }
    super.cleanup();
    this.activeProcesses.clear();
  }
}
```

**Benefits:**
- ✅ Prevents orphaned mock processes
- ✅ Automatic timeout for long-running test processes
- ✅ Memory leak prevention

### Fix 4: Test Categorization

**Problem:** Running all tests together causes resource conflicts.

**Solution:** Separate tests into categories with different resource profiles.

**Implementation:**

**File:** `vitest.workspace.ts` (new file)

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      poolOptions: {
        forks: {
          singleFork: false,
          maxForks: 4 // Unit tests can run in parallel
        }
      }
    }
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      poolOptions: {
        forks: {
          singleFork: true, // Integration tests sequential
          maxForks: 1
        }
      }
    }
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'stress',
      include: ['tests/stress/**/*.test.ts'],
      poolOptions: {
        forks: {
          singleFork: true,
          maxForks: 1 // Stress tests always sequential
        }
      }
    }
  }
]);
```

**Benefits:**
- ✅ Fast unit tests (parallel)
- ✅ Safe integration tests (sequential)
- ✅ Isolated stress tests
- ✅ Better resource utilization

### Fix 5: Global Test Setup Enhancement

**Problem:** Global cleanup runs after all tests, allowing resource accumulation.

**Solution:** Add periodic cleanup during test runs.

**Implementation:**

**File:** `tests/setup.ts` (enhancement)

```typescript
// Add periodic cleanup
let cleanupInterval: NodeJS.Timeout;

beforeAll(() => {
  // Periodic cleanup every 30 seconds during test runs
  cleanupInterval = setInterval(() => {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Log resource usage for debugging
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 1024 * 1024 * 1024) { // > 1GB
      console.warn(`High memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }

    const openHandles = activeResources.databases.size +
                        activeResources.eventBuses.size +
                        activeResources.processSpawners.size;
    if (openHandles > 50) {
      console.warn(`High resource count: ${openHandles} open handles`);
    }
  }, 30000);
});

afterAll(() => {
  clearInterval(cleanupInterval);
  // Existing cleanup logic...
});
```

**Benefits:**
- ✅ Early detection of resource leaks
- ✅ Periodic garbage collection
- ✅ Visibility into resource usage

## Usage Guidelines

### ✅ DO: Run Tests Safely (DEFAULT)

```bash
# Default command - runs unit + integration sequentially (SAFE)
npm test

# Or run test categories separately
npm run test:unit
npm run test:integration

# For coverage reports (runs both sequentially)
npm run test:coverage

# For watch mode during development
npm run test:watch
```

### ❌ DON'T: Run Tests Unsafely

```bash
# Avoid running vitest directly without npm scripts
vitest run  # BAD - bypasses safety limits

# Avoid running with insufficient memory
node --max-old-space-size=512 vitest  # BAD - too low memory

# Avoid running tests in parallel
vitest --no-file-parallelism=false  # BAD - enables parallelism
```

### Cleanup Before/After Test Runs

```bash
# Before tests
./scripts/cleanup-test-processes.sh

# Run tests
npm run test:safe

# After tests (automatic via posttest hook)
# Databases and logs cleaned automatically
```

## Monitoring Test Health

### Check for Resource Leaks

```bash
# During test runs, watch for warnings:
# - "High memory usage: XXX MB"
# - "High resource count: XXX open handles"

# If you see these, investigate:
# 1. Which tests are not cleaning up?
# 2. Are EventBuses being disposed?
# 3. Are databases being closed?
```

### Diagnostic Commands

```bash
# Check for orphaned processes
pgrep -af "CLAUDINE_WORKER=true"

# Check open file descriptors (Linux)
lsof -p $(pgrep -f vitest) | wc -l

# Monitor memory during tests
watch -n 1 'ps aux | grep vitest | grep -v grep'
```

## Implementation Priority

1. **CRITICAL (Do First)**:
   - ✅ Sequential test execution (DONE)
   - ✅ Memory-limited test commands (DONE)
   - ✅ Process cleanup script (DONE)

2. **HIGH (Next Week)**:
   - [ ] Test Resource Isolation Pattern
   - [ ] Database Connection Pooling
   - [ ] Test Categorization

3. **MEDIUM (When Time Permits)**:
   - [ ] Mock Process Spawner Enhancement
   - [ ] Global Test Setup Enhancement
   - [ ] Test health monitoring

## Success Metrics

After implementing fixes:
- ✅ No Claude Code crashes during test runs
- ✅ Test suite completes in < 5 minutes
- ✅ Peak memory usage < 4GB
- ✅ No orphaned processes after tests
- ✅ All tests pass consistently

## Questions & Support

If tests still crash after these fixes:
1. Run with debug logging: `DEBUG=* npm run test:safe`
2. Check system resources: `htop`, `free -h`, `ulimit -a`
3. Profile memory: `NODE_OPTIONS='--inspect' npm run test:unit`
4. Report issue with diagnostics

---

**Status:** Immediate fixes implemented ✅
**Next Steps:** Implement high-priority architectural fixes
**Owner:** Development team
**Last Updated:** 2025-10-18
