# Release Notes - v0.3.2

**Release Date:** 2025-12-08
**Previous Version:** 0.3.1
**Release Type:** Patch (Tech debt cleanup, type safety improvements)

---

## Summary

This patch release focuses on **tech debt cleanup**, **type safety improvements**, and **dead code removal**. No new features - purely internal quality improvements.

### Highlights

- **Type Safety**: Replaced `Record<string, any>` with explicit row type interfaces
- **Configurability**: `maxChainDepth` now configurable via `DependencyHandler.create()` options
- **Defense-in-Depth**: Database CHECK constraint on `resolution` column
- **Dead Code Removal**: Removed 3 unused/deprecated methods from QueueHandler

---

## Technical Improvements

### Configurable Chain Depth Limit

The `DependencyHandler.create()` factory method now accepts an optional `options` parameter:

```typescript
const handler = await DependencyHandler.create(
  dependencyRepo,
  taskRepo,
  logger,
  eventBus,
  { maxChainDepth: 50 }  // Optional, defaults to 100
);
```

This allows tests and deployments to customize the DoS protection limit.

### Explicit Row Type Interfaces

Replaced dynamic `Record<string, any>` types with explicit interfaces:

- `DependencyRow` - Type-safe database row mapping for dependencies
- `TaskRow` - Type-safe database row mapping for tasks

This improves IDE autocomplete and catches type errors at compile time.

### Database CHECK Constraint

Added CHECK constraint on `resolution` column via migration v2:

```sql
CHECK (resolution IN ('pending', 'completed', 'failed', 'cancelled'))
```

This provides defense-in-depth validation at the database level, complementing TypeScript validation.

---

## Removed

### Dead Code Cleanup

Removed 3 unused methods from `QueueHandler`:

- `getQueueStats()` - Copied entire task array just to return count
- `getNextTask()` - Deprecated, replaced by `NextTaskQuery` event
- `requeueTask()` - Deprecated, replaced by `RequeueTask` event

These methods had no callers and were marked deprecated without a removal timeline.

---

## Documentation

### Fixed Incorrect Complexity Claim

Updated `getMaxDepth()` documentation from incorrect "O(1) cached" to accurate "O(V+E) with internal memoization".

### Architecture Documentation

Added CHECK constraint note to `docs/architecture/TASK_ARCHITECTURE.md`.

---

## Migration Guide

No breaking changes. This is a drop-in replacement for v0.3.1.

---

## Contributors

- Code review and cleanup via Claude Code `/code-review` workflow
