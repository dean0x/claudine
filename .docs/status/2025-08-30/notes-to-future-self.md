# Notes to Future Self - Claudine Task Persistence Implementation

**Last Session Date**: 2025-08-30  
**Session Context**: Implemented SQLite task persistence, fixed MCP connection issues, prepared v0.2.0 release

## 🎯 Where We Left Off

### Just Completed
- ✅ Implemented complete task persistence with SQLite database
- ✅ Fixed critical MCP connection issues (stdout/stderr separation)
- ✅ Fixed Claude CLI integration (--print flag instead of --no-interaction)
- ✅ Added recovery manager for automatic task restoration
- ✅ Created comprehensive release documentation
- ✅ Updated README with accurate information
- ✅ Created PR #2 for v0.2.0 release

### Current State
- ✅ MCP server connects reliably
- ✅ Tasks persist across restarts
- ✅ Autoscaling works with priority queue
- ✅ All documentation updated
- 📋 PR awaiting merge
- 📋 Version still at 0.1.1 (needs bump to 0.2.0 after merge)

## 🔧 Critical Technical Context

### Recent Architecture Changes

#### 1. SQLite Database Integration
Added complete persistence layer in `/workspace/claudine/src/implementations/database.ts`:
```typescript
// Platform-specific database paths
if (process.platform === 'win32') {
  return path.join(appData, 'claudine', 'claudine.db');
} else {
  return path.join(homeDir, '.claudine', 'claudine.db');
}

// WAL mode for better concurrency
this.db.pragma('journal_mode = WAL');
```

#### 2. MCP Connection Fix
Fixed in `/workspace/claudine/src/implementations/logger.ts`:
```typescript
// CRITICAL: All logs MUST go to stderr to keep stdout clean for MCP
console.error(`${color}${this.prefix} INFO:${reset} ${message}`, context || '');
```

#### 3. Claude CLI Flag Fix
Updated in `/workspace/claudine/src/implementations/process-spawner.ts`:
```typescript
// OLD (broken):
this.baseArgs = Object.freeze(['--no-interaction', '--dangerously-skip-permissions']);

// NEW (working):
this.baseArgs = Object.freeze(['--print', '--dangerously-skip-permissions']);
// Prompt passed as argument, not stdin
const args = [...this.baseArgs, prompt];
```

### Key Fix Patterns Applied

#### Dynamic Import Fix for CLI
Problem: CLI was exiting immediately when starting MCP server
```typescript
// Before (broken):
import(indexPath);

// After (working):
import(indexPath).then((module) => {
  if (module.main) {
    return module.main();
  }
});
```

#### Export Main Function
Added export to `/workspace/claudine/src/index.ts`:
```typescript
export { main };  // Allows CLI to call main() after import
```

## 📝 Immediate Next Tasks

### 1. Merge PR and Release 🔴 HIGH PRIORITY
After PR #2 is merged:
```bash
git checkout main
git pull
npm version minor  # Bump to 0.2.0
git push origin main --tags
npm publish
```

### 2. Create GitHub Release 🔴 HIGH PRIORITY  
- Go to https://github.com/dean0x/claudine/releases
- Create release from v0.2.0 tag
- Copy content from RELEASE_NOTES_v0.2.0.md
- Publish release

### 3. Monitor npm Package 🟡 MEDIUM PRIORITY
```bash
npm view claudine versions  # Verify 0.2.0 is published
npm install -g claudine@latest  # Test installation
```

## 🚨 Important Gotchas & Patterns

### Common Pitfalls

#### 1. MCP Stdout Pollution
**NEVER** write to stdout in MCP mode - it breaks JSON-RPC protocol:
- ❌ `console.log()` 
- ✅ `console.error()` or logger that uses stderr

#### 2. WAL Mode Disk I/O Errors
Some test environments don't support SQLite WAL mode. This is OK - production works fine.

#### 3. Claude CLI Flags
- `--print` is for non-interactive mode (NOT `--no-interaction`)
- Prompt must be passed as CLI argument with --print, not via stdin

### Established Patterns

#### Result Type Pattern
All business logic uses Result types:
```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

#### Dependency Injection
Everything uses the container in `/workspace/claudine/src/bootstrap.ts`:
```typescript
container.registerSingleton('service', () => new ServiceImpl(deps));
```

## 🔍 Quick Reference Commands

```bash
# Development
npm run build         # Build TypeScript
npm test             # Run tests (some fail due to WAL in test env)
npm run dev          # Development mode

# Testing MCP locally
node dist/cli.js mcp start   # Start MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/cli.js mcp start

# Release process
npm version minor    # Bump version
npm publish         # Publish to npm
git tag v0.2.0      # Create tag
git push origin v0.2.0  # Push tag
```

## 📁 Key Files to Remember

### Core Implementation
- `/workspace/claudine/src/implementations/database.ts` - SQLite database with platform paths
- `/workspace/claudine/src/implementations/task-repository.ts` - Task CRUD operations
- `/workspace/claudine/src/implementations/output-repository.ts` - Output storage with file overflow
- `/workspace/claudine/src/services/recovery-manager.ts` - Startup task recovery
- `/workspace/claudine/src/implementations/process-spawner.ts` - Claude CLI spawning

### Configuration
- `/workspace/claudine/CLAUDE.md` - Release instructions and project guidelines
- `/workspace/claudine/package.json` - Version needs bump to 0.2.0

### Documentation
- `/workspace/claudine/RELEASE_NOTES_v0.2.0.md` - Ready for GitHub release
- `/workspace/claudine/README.md` - Updated with persistence features

## 🎯 Strategic Approach for Next Session

1. **First Priority** - Check if PR #2 is merged, then execute release process
2. **Second Priority** - Monitor npm package and test global installation
3. **Third Priority** - Start planning Phase 2 features (git worktree support)

## 💡 Context for Decisions Made

### Why SQLite for Persistence?
- Zero configuration needed
- Works on all platforms
- WAL mode provides good concurrency
- Better-sqlite3 is synchronous (simpler than async)

### Why Remove MCP_MODE Flag?
- Simpler to always use stderr for logs
- No conditional logic needed
- MCP protocol always gets clean stdout

### Why Remove Scripts Folder?
- Standard npm commands are sufficient
- Reduces maintenance burden
- Less files to keep updated

## 🔮 Future Considerations

### After Current Tasks
- Phase 2: Git worktree support for isolated execution
- Phase 3: Web dashboard for monitoring
- Phase 4: Task dependencies and chaining
- Phase 5: Distributed execution

### Architecture Evolution
- Consider moving to async SQLite for better performance
- Add task result caching
- Implement task retry policies
- Add metrics collection

## 🛠️ Debugging Tips

### If MCP Connection Fails
1. Check logs aren't going to stdout: `grep console.log dist/`
2. Test with clean stdout: `node dist/cli.js mcp start 2>/dev/null`
3. Verify JSON-RPC response is clean

### If Tasks Don't Persist
1. Check database exists: `ls ~/.claudine/claudine.db`
2. Verify tables created: `sqlite3 ~/.claudine/claudine.db ".tables"`
3. Check recovery manager logs on startup

### If Claude CLI Fails
1. Verify claude is installed: `which claude`
2. Test manually: `claude --print "test"`
3. Check process spawner flags in `process-spawner.ts`

## 📌 Final Reminders

- **Always commit with Co-Authored-By**: `Co-Authored-By: Claude <noreply@anthropic.com>`
- **Version bump after merge**: Don't bump version until PR is merged to main
- **Test locally first**: Use `node dist/cli.js mcp start` for local testing
- **Keep stdout clean**: Never add console.log in MCP code path
- **Database location**: `~/.claudine/claudine.db` (Unix) or `%APPDATA%/claudine/claudine.db` (Windows)