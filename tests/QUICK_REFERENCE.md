# Test Quick Reference Guide

## 🚀 Writing a New Test - Copy This Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskFactory, WorkerFactory } from '../fixtures/factories';
import { TestEventBus, TestLogger, TestRepository } from '../fixtures/test-doubles';
import { TIMEOUTS, ERROR_MESSAGES, BUFFER_SIZES } from '../constants';

describe('ComponentName - What It Does', () => {
  let component: YourComponent;
  let eventBus: TestEventBus;
  let logger: TestLogger;
  let repository: TestRepository;

  beforeEach(() => {
    eventBus = new TestEventBus();
    logger = new TestLogger();
    repository = new TestRepository();
    component = new YourComponent(eventBus, repository, logger);
  });

  afterEach(() => {
    eventBus.dispose();
    logger.clear();
    repository.clear();
  });

  describe('Normal Operations', () => {
    it('should perform expected behavior when conditions are met', async () => {
      // Arrange - Use factories
      const task = new TaskFactory()
        .withPrompt('test prompt')
        .withPriority('P0')
        .build();

      // Act
      const result = await component.process(task);

      // Assert - 3-5 assertions
      expect(result.ok).toBe(true);
      expect(result.value.status).toBe('completed');
      expect(eventBus.hasEmitted('ProcessComplete')).toBe(true);
      expect(logger.hasLog('info', 'Processing complete')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle database failure gracefully', async () => {
      // Arrange
      repository.setSaveError(new Error(ERROR_MESSAGES.DATABASE_LOCKED));
      const task = new TaskFactory().build();

      // Act
      const result = await component.process(task);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error.message).toContain('database');
      expect(logger.hasLog('error', 'Failed to save')).toBe(true);
      expect(eventBus.hasEmitted('ProcessFailed')).toBe(true);
    });
  });
});
```

## 📦 Common Test Patterns

### Creating Test Data

```typescript
// Single task
const task = new TaskFactory()
  .withPrompt('echo hello')
  .withPriority('P0')
  .withTimeout(TIMEOUTS.MEDIUM)
  .build();

// Multiple tasks
const tasks = new TaskFactory().buildMany(5, (factory, i) => {
  factory.withId(`task-${i}`).withPriority(i === 0 ? 'P0' : 'P1');
});

// Completed task
const completedTask = new TaskFactory().completed(0).build();

// Failed task
const failedTask = new TaskFactory().failed('Error message').build();

// Running task
const runningTask = new TaskFactory().running('worker-123').build();
```

### Using Test Doubles

```typescript
// EventBus tracking
const eventBus = new TestEventBus();
await component.process(task);
expect(eventBus.hasEmitted('TaskProcessed')).toBe(true);
expect(eventBus.getEventCount('TaskProcessed')).toBe(1);
const events = eventBus.getEmittedEvents();

// Logger verification
const logger = new TestLogger();
component.doWork();
expect(logger.hasLog('error', 'Failed')).toBe(true);
expect(logger.getLogsByLevel('error')).toHaveLength(1);

// Repository with errors
const repository = new TestRepository();
repository.setSaveError(new Error('Connection lost'));
const result = await repository.save(task);
expect(result.ok).toBe(false);

// Process spawner control
const spawner = new TestProcessSpawner();
spawner.setSpawnError(new Error('spawn ETIMEDOUT'));
spawner.simulateOutput('worker-1', 'stdout', 'Output data');
spawner.simulateExit('worker-1', 0);
```

### Testing Async Operations

```typescript
// Wait for events
await eventBus.emit('TestEvent', data);
await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SHORT));

// Concurrent operations
const results = await Promise.allSettled(
  tasks.map(task => component.process(task))
);
expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(tasks.length);

// Retry with backoff
const retryWithBackoff = async (fn: Function, maxAttempts = 3) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await new Promise(r => setTimeout(r, TIMEOUTS.SHORT * Math.pow(2, i)));
    }
  }
};
```

## 📋 Checklist Before Committing

```bash
# Run this checklist
echo "=== Test Quality Checklist ==="

# 1. No console spying
! grep -r "spyOn(console" tests/ --include="*.test.ts" && echo "✅ No console spying" || echo "❌ Remove console spying"

# 2. No magic numbers
! grep -r "\b(1000|5000|10000)\b" tests/ --include="*.test.ts" && echo "✅ No magic numbers" || echo "❌ Use constants"

# 3. No 'as any'
! grep -r "as any" tests/ --include="*.test.ts" && echo "✅ No 'as any'" || echo "❌ Remove 'as any'"

# 4. No inline objects (check for common patterns)
! grep -r "{ *id: ['\"]task-" tests/ --include="*.test.ts" && echo "✅ Using factories" || echo "⚠️ Check for inline objects"

# 5. Using test doubles
grep -r "TestEventBus\|TestLogger\|TestRepository" tests/ --include="*.test.ts" > /dev/null && echo "✅ Using test doubles" || echo "❌ Use test doubles"

# 6. Run tests
npm test && echo "✅ Tests pass" || echo "❌ Fix failing tests"
```

## 🎯 Quick Fixes for Common Issues

### Replace Inline Object → Use Factory
```typescript
// ❌ BAD
const task = {
  id: 'task-123',
  prompt: 'test',
  status: 'pending'
};

// ✅ GOOD
const task = new TaskFactory()
  .withId('task-123')
  .withPrompt('test')
  .build();
```

### Replace Mock → Use Test Double
```typescript
// ❌ BAD
const mockEmit = vi.fn().mockResolvedValue({ ok: true });

// ✅ GOOD
const eventBus = new TestEventBus();
// eventBus.hasEmitted() for assertions
```

### Replace Magic Number → Use Constant
```typescript
// ❌ BAD
await sleep(1000);
const buffer = Buffer.alloc(10485760);

// ✅ GOOD
await sleep(TIMEOUTS.MEDIUM);
const buffer = Buffer.alloc(BUFFER_SIZES.MEDIUM);
```

### Add Missing Assertions
```typescript
// ❌ BAD - Only 1 assertion
expect(result.ok).toBe(true);

// ✅ GOOD - 3-5 assertions
expect(result.ok).toBe(true);
expect(result.value.status).toBe('completed');
expect(eventBus.hasEmitted('TaskCompleted')).toBe(true);
expect(repository.hasTask(task.id)).toBe(true);
```

## 🔗 Resources

- [Full Standards](./TEST_STANDARDS.md) - Complete guidelines
- [Test Factories](./fixtures/factories.ts) - All available factories
- [Test Doubles](./fixtures/test-doubles.ts) - All test doubles
- [Constants](./constants.ts) - All test constants
- [Examples](./unit/error-scenarios/) - Well-written test examples