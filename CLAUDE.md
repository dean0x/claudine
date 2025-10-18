# CLAUDE.md

This file provides project-specific guidance for Claude Code when working on Claudine.

## Project Overview

Claudine is an MCP (Model Context Protocol) server that enables task delegation to background Claude Code instances. It uses event-driven architecture with autoscaling workers, task dependencies (DAG-based), and SQLite persistence.

**Core Concept**: Transform a dedicated server into an AI powerhouse - orchestrate multiple Claude Code instances through one main session for parallel development across repositories.

## Quick Start

```bash
# Install and build
npm install
npm run build

# Run MCP server
claudine mcp start
# or: node dist/cli.js mcp start

# Development mode (auto-reload)
npm run dev

# Test
npm test                    # All tests (sequential, safe)
npm run test:unit           # Unit tests only
npm run test:coverage       # With coverage
```

## Architecture Notes

**Event-Driven System**: All components communicate via EventBus - no direct state management.

**Key Pattern**: Events flow through specialized handlers:
- `DependencyHandler` → manages task dependencies and DAG validation
- `QueueHandler` → dependency-aware task queueing
- `WorkerHandler` → worker lifecycle
- `PersistenceHandler` → database operations

See `docs/architecture/` for implementation details.

## Task Dependencies (v0.3.0+)

Tasks can depend on other tasks using the `dependsOn` field:
- DAG validation prevents cycles (A→B→A)
- Tasks block until dependencies complete
- Cycle detection uses DFS algorithm in `DependencyGraph`
- TOCTOU protection via synchronous SQLite transactions

See `docs/TASK-DEPENDENCIES.md` for usage patterns.

## Release Process

### Pre-Release Checklist

1. **Update version** in `package.json`:
   ```bash
   npm version patch --no-git-tag-version  # 0.3.0 → 0.3.1
   npm version minor --no-git-tag-version  # 0.3.0 → 0.4.0
   npm version major --no-git-tag-version  # 0.3.0 → 1.0.0
   ```

2. **Create release notes** (REQUIRED):
   ```bash
   # Must match version in package.json
   touch docs/releases/RELEASE_NOTES_v0.3.1.md

   # Include: features, bug fixes, breaking changes, migration notes
   ```

3. **Test everything**:
   ```bash
   npm run build
   npm test
   ```

### Release Workflow

1. **Create PR**:
   ```bash
   git add package.json docs/releases/RELEASE_NOTES_v*.md
   git commit -m "chore: prepare v0.3.1 release"
   git push origin feature/your-branch
   gh pr create --title "Release v0.3.1" --body "See docs/releases/RELEASE_NOTES_v0.3.1.md"
   ```

2. **Merge to main** - CI automatically:
   - Validates release notes exist
   - Publishes to npm (`claudine@{version}`)
   - Creates git tag (`v{version}`)
   - Creates GitHub release

**CI will FAIL if** `docs/releases/RELEASE_NOTES_v{version}.md` is missing.

### Emergency Release

If CI fails:
```bash
# Manual tag creation
git tag v{version} && git push origin v{version}

# Manual GitHub release
gh release create v{version} --notes-file docs/releases/RELEASE_NOTES_v{version}.md
```

## Project-Specific Guidelines

### Testing

- **Never run full test suite in parallel** - causes memory exhaustion
- Use `npm test` (sequential) or specific test commands
- Worker handler tests require >6GB memory (skipped in CI)

### Database

- SQLite with WAL mode for concurrent access
- All mutations go through event handlers (PersistenceHandler, DependencyHandler)
- Use synchronous transactions for TOCTOU protection (cycle detection)

### Dependencies

When adding task dependencies:
- Always validate DAG (use `DependencyGraph.wouldCreateCycle()`)
- Use synchronous `db.transaction()` for atomicity
- Emit `TaskDependencyAdded`, `TaskUnblocked` events

### MCP Tools

All tools use PascalCase: `DelegateTask`, `TaskStatus`, `TaskLogs`, `CancelTask`

## File Locations

Quick reference for common operations:

| Component | File |
|-----------|------|
| Task lifecycle | `src/core/domain.ts` |
| Event definitions | `src/core/events/events.ts` |
| Dependency graph | `src/core/dependency-graph.ts` |
| Task repository | `src/implementations/task-repository.ts` |
| Dependency repository | `src/implementations/dependency-repository.ts` |
| Event handlers | `src/services/handlers/` |
| MCP adapter | `src/adapters/mcp-adapter.ts` |
| CLI | `src/cli.ts` |

## Documentation Structure

- `README.md` - User-facing quick start
- `docs/FEATURES.md` - Complete feature list
- `docs/TASK-DEPENDENCIES.md` - Task dependencies API
- `docs/architecture/` - Architecture documentation
- `docs/releases/` - Release notes by version
- `docs/ROADMAP.md` - Future plans

---

**Note**: General engineering principles (Result types, DI, immutability, etc.) are defined in your global `~/.claude/CLAUDE.md`. This file contains only Claudine-specific guidance.
