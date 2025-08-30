## Implementation Plan: Phase 1 - Task Persistence

### Overview
Add SQLite-based persistence to ensure tasks survive server restarts and enable crash recovery. Persistence is enabled by default with automatic platform-appropriate data directory selection. Since this is a pristine project, we'll implement persistence as the primary storage mechanism from the start.

### Step-by-Step Implementation Plan

#### 1. **Add SQLite Dependency** (10 mins)
- Install `better-sqlite3` and `@types/better-sqlite3`
- Update package.json dependencies

#### 2. **Create Database Schema** (30 mins)
Create `src/implementations/database.ts`:
- Database initialization with SQLite
- Schema creation with migrations
- Tables: `tasks`, `task_output`, `task_metrics`
- Indexes for performance

#### 3. **Implement TaskRepository Interface** (45 mins)
Create `src/implementations/task-repository.ts`:
- `SQLiteTaskRepository` class implementing `TaskRepository` interface
- Methods: save, update, findById, findAll, findByStatus, delete
- Use prepared statements for performance
- Handle serialization of complex types (Priority, TaskStatus)

#### 4. **Implement OutputRepository** (30 mins)
Create `src/implementations/output-repository.ts`:
- Persist task output to database
- Handle large outputs with file fallback
- Methods: save, append, get, delete

#### 5. **Update TaskManager for Persistence** (45 mins)
Modify `src/services/task-manager.ts`:
- Add required `TaskRepository` dependency
- Persist tasks on creation, update, and status changes
- Keep in-memory cache for performance
- Replace in-memory Map with database-backed operations

#### 6. **Add Recovery Logic** (45 mins)
Create `src/services/recovery-manager.ts`:
- Load tasks from database on startup
- Re-queue QUEUED tasks
- Mark RUNNING tasks as FAILED (crashed)
- Restore output buffers

#### 7. **Update Bootstrap** (20 mins)
Modify `src/bootstrap.ts`:
- Register database and repositories
- Initialize database on startup
- Initialize recovery on startup
- Add graceful shutdown for clean state

#### 8. **Add Tests** (1 hour)
Create test files:
- `tests/unit/task-repository.test.ts`
- `tests/unit/recovery-manager.test.ts`
- `tests/integration/persistence.test.ts`

#### 9. **Update Configuration** (10 mins)
- Database path auto-determined based on platform:
  - Linux/Mac: `~/.claudine/claudine.db`
  - Windows: `%APPDATA%/claudine/claudine.db`
- Optional `CLAUDINE_DATA_DIR` env var for override
- Configure SQLite settings (WAL mode, etc.)

#### 10. **Documentation** (20 mins)
- Update README with persistence feature details
- Document automatic database location:
  - Linux/Mac: `~/.claudine/`
  - Windows: `%APPDATA%\claudine\`
- Add troubleshooting section for database issues
- Note that persistence is enabled by default (no configuration needed)

### File Structure
```
src/
├── implementations/
│   ├── database.ts          # NEW: Database initialization
│   ├── task-repository.ts   # NEW: Task persistence
│   └── output-repository.ts # NEW: Output persistence
├── services/
│   ├── task-manager.ts      # MODIFIED: Add persistence
│   └── recovery-manager.ts  # NEW: Startup recovery
├── bootstrap.ts              # MODIFIED: Register new services
└── core/
    └── interfaces.ts         # EXISTING: TaskRepository interface
```

### Key Implementation Details

#### Database Schema (SQLite)
```sql
-- Main tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  working_directory TEXT,
  use_worktree INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  worker_id TEXT,
  exit_code INTEGER,
  dependencies TEXT -- JSON array
);

-- Task output table
CREATE TABLE IF NOT EXISTS task_output (
  task_id TEXT PRIMARY KEY,
  stdout TEXT,
  stderr TEXT,
  total_size INTEGER,
  file_path TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
```

#### Data Directory Logic
```typescript
function getDataDirectory(): string {
  // Allow override via environment variable
  if (process.env.CLAUDINE_DATA_DIR) {
    return process.env.CLAUDINE_DATA_DIR;
  }
  
  // Platform-specific defaults
  const homeDir = os.homedir();
  
  if (process.platform === 'win32') {
    // Windows: %APPDATA%/claudine
    return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'claudine');
  } else {
    // Linux/Mac: ~/.claudine
    return path.join(homeDir, '.claudine');
  }
}
```

#### Key Classes
1. **SQLiteTaskRepository**: Implements CRUD operations with Result types
2. **RecoveryManager**: Handles startup recovery and crash resilience
3. **Enhanced TaskManagerService**: Now with built-in persistence

### Testing Strategy
- Unit tests for repository operations
- Integration tests for recovery scenarios
- Performance tests for large task volumes
- Crash simulation tests

### Success Criteria
- ✅ Tasks persist across server restarts
- ✅ No data loss on unexpected shutdown
- ✅ Recovery completes in < 5 seconds with 1000 tasks
- ✅ Database operations are performant (< 10ms for single operations)
- ✅ No performance degradation for normal operations

### Risk Mitigation
- Use WAL mode for better concurrency
- Implement proper transaction handling
- Add retry logic for database operations
- Handle database corruption gracefully

### Estimated Time: 4-5 hours total (reduced due to no migration needs)

Ready to proceed with implementation?