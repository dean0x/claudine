# Real Unit Tests Approach

## The Problem with Our Old Tests

Our old test suite was **testing mocks, not code**:
- 376 mock calls across the test suite
- Testing that mocks get called with correct arguments
- Would pass even if the actual implementation was completely broken
- No confidence when refactoring

## Our New Approach: REAL Unit Tests

### Principles

1. **Test Behavior, Not Implementation**
   - Don't test that `spawn` was called
   - Test that the task actually executes

2. **No Unnecessary Mocks**
   - Use real implementations where possible
   - Only mock external dependencies (file system, network)
   - Use in-memory databases instead of mocked repositories

3. **Test at the Right Level**
   - Unit tests: Test single functions/classes with real behavior
   - Integration tests: Test components working together
   - E2E tests: Test complete user journeys (sparingly)

### Examples of Real Tests

#### ❌ BAD: Mock-heavy test
```typescript
it('should spawn process', () => {
  const mockSpawn = vi.fn().mockReturnValue({ pid: 123 });
  spawner.spawn('test');
  expect(mockSpawn).toHaveBeenCalledWith('claude', ['test']);
});
// This tests that our mock works, not that processes spawn
```

#### ✅ GOOD: Behavior test
```typescript
it('should execute task and capture output', async () => {
  const result = await taskManager.delegate({
    prompt: 'echo "hello"'
  });

  const logs = await taskManager.getTaskLogs(result.value.id);
  expect(logs.value.stdout).toContain('hello');
});
// This tests that tasks actually execute
```

## Test Categories We're Building

### 1. Pure Functions (No I/O)
- `core/result.ts` - Result type operations
- `core/pipe.ts` - Function composition
- `core/domain.ts` - Domain models and business rules
- `core/errors.ts` - Error creation

**Approach**: Test actual behavior with real inputs/outputs

### 2. Stateful Components
- `implementations/task-queue.ts` - Priority queue operations
- `implementations/output-capture.ts` - Buffer management
- `core/events/event-bus.ts` - Pub/sub mechanics

**Approach**: Test state changes and side effects directly

### 3. Database Operations
- `implementations/database.ts` - SQLite operations
- `implementations/task-repository.ts` - Task persistence

**Approach**: Use in-memory SQLite, test real SQL queries

### 4. External Integrations
- `implementations/process-spawner.ts` - Process spawning
- `implementations/resource-monitor.ts` - System monitoring

**Approach**: Minimal mocking of OS calls, test logic around them

## Quality Metrics for Our Tests

A good test should:
1. **Fail when the implementation breaks**
2. **Pass when behavior is correct** (regardless of implementation)
3. **Be fast enough to run frequently** (<100ms per test)
4. **Be deterministic** (no flaky tests)
5. **Be readable** (test name explains what and why)

## Test Coverage Goals

Not just line coverage, but **behavior coverage**:
- All happy paths
- All error conditions
- All edge cases
- All business rules

## Current Progress

### Completed
- ✅ `core/result.ts` - Full behavior tests for Result type
- ✅ `core/pipe.ts` - Real function composition tests
- ✅ `core/domain.ts` - Domain model behavior tests

### In Progress
- `core/errors.ts` - Error behavior tests
- `implementations/database.ts` - Real SQLite tests
- `implementations/task-queue.ts` - Queue operation tests

### Benefits Already Seen

1. **Found actual bugs** - Tests revealed incorrect error handling
2. **Better documentation** - Tests show how to use components
3. **Refactoring confidence** - Can change implementation safely
4. **No false positives** - Tests fail for real problems

## Next Steps

1. Complete unit tests for all core components
2. Add integration tests for critical paths
3. Add minimal E2E tests for smoke testing
4. Set up mutation testing to verify test quality
5. Establish test coverage requirements in CI/CD

## Key Takeaway

**We're not testing that our mocks work. We're testing that our CODE works.**

Every test should answer: "Does this component do what it's supposed to do?"
Not: "Does this component call the right mock functions?"