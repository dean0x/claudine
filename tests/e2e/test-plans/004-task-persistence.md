# E2E Test Plan: Task Persistence

## Test Metadata
- **Test ID:** E2E-004
- **Category:** Core Functionality
- **Priority:** P0
- **Estimated Duration:** 45 seconds
- **Dependencies:** SQLite3

## Test Description
Verify that tasks are properly persisted to the database and can be recovered after system restart. Tests database initialization, WAL mode, and recovery mechanisms.

## Prerequisites
```yaml
preconditions:
  - Clean database state
  - Build completed successfully
  - No running claudine processes
```

## Test Steps

### Step 1: Clean Database State
**Action:** Remove any existing database
```bash
rm -rf .claudine/claudine.db .claudine/claudine.db-wal .claudine/claudine.db-shm
```
**Expected:** Clean slate for testing
**Verify:**
- No database files exist
- .claudine directory is clean

### Step 2: Build Project
**Action:** Build the TypeScript project
```bash
npm run build
```
**Expected:** Build completes successfully
**Verify:**
- No TypeScript errors
- dist/ directory exists

### Step 3: Delegate First Task
**Action:** Create a task that will be persisted
```bash
node dist/cli.js delegate "echo 'Task 1: Persistence Test' && sleep 2" --priority P0
```
**Expected:** Task created and delegated
**Verify:**
- Task ID returned
- No errors in output

### Step 4: Verify Database Created
**Action:** Check database files and WAL mode
```bash
ls -la .claudine/claudine.db* && sqlite3 .claudine/claudine.db "PRAGMA journal_mode;" 2>/dev/null || echo "Database check failed"
```
**Expected:** Database with WAL mode
**Verify:**
- claudine.db file exists
- WAL mode is enabled (output should show "wal")

### Step 5: Check Task in Database
**Action:** Query database directly for task
```bash
sqlite3 .claudine/claudine.db "SELECT COUNT(*) FROM tasks;" 2>/dev/null || echo "0"
```
**Expected:** At least 1 task in database
**Verify:**
- Count is greater than 0
- Query executes without error

### Step 6: Delegate Second Task
**Action:** Add another task to test multiple persistence
```bash
node dist/cli.js delegate "echo 'Task 2: Multi-persistence' && date"
```
**Expected:** Second task created
**Verify:**
- Task ID returned
- Different from first task ID

### Step 7: Simulate Crash
**Action:** Kill all claudine processes abruptly
```bash
pkill -9 -f "claudine" || true
sleep 2
```
**Expected:** Processes terminated
**Verify:**
- No claudine processes running
- Database files still exist

### Step 8: Check Database Integrity
**Action:** Verify database is not corrupted
```bash
sqlite3 .claudine/claudine.db "PRAGMA integrity_check;" 2>/dev/null || echo "integrity check failed"
```
**Expected:** Database intact
**Verify:**
- Output shows "ok"
- No corruption errors

### Step 9: Query Persisted Tasks
**Action:** List all tasks from database
```bash
sqlite3 .claudine/claudine.db "SELECT id, status, priority FROM tasks ORDER BY createdAt;" 2>/dev/null || echo "Query failed"
```
**Expected:** Both tasks present
**Verify:**
- Two task records shown
- Status and priority preserved

### Step 10: Test Recovery on Restart
**Action:** Check status to trigger recovery
```bash
node dist/cli.js status
```
**Expected:** Tasks loaded from database
**Verify:**
- Both tasks shown in status
- No data loss

### Step 11: Test Transaction Rollback
**Action:** Create task with invalid data to test rollback
```bash
node dist/cli.js delegate "" 2>&1 | grep -E "error|failed|invalid" || echo "No error detected"
```
**Expected:** Transaction rolled back
**Verify:**
- Error message shown
- Database unchanged

### Step 12: Verify Final State
**Action:** Count final tasks in database
```bash
sqlite3 .claudine/claudine.db "SELECT COUNT(*) FROM tasks;" 2>/dev/null
```
**Expected:** Consistent task count
**Verify:**
- Count matches expected (2 tasks)
- Database operational

### Step 13: Cleanup
**Action:** Clean up test artifacts
```bash
rm -rf .claudine/claudine.db*
pkill -f "claudine" || true
```
**Expected:** Cleanup successful
**Verify:**
- Database removed
- No orphaned processes

## Success Criteria
- [ ] Database created with WAL mode enabled
- [ ] Tasks persist across process restarts
- [ ] Database integrity maintained after crash
- [ ] Recovery mechanism loads persisted tasks
- [ ] Transaction rollback works correctly
- [ ] No data corruption or loss
- [ ] Query performance acceptable (<100ms)

## Rollback Plan
If test fails:
1. Remove corrupted database: `rm -rf .claudine/claudine.db*`
2. Kill all processes: `pkill -9 -f claudine`
3. Check disk space: `df -h .`
4. Verify SQLite installation: `sqlite3 --version`

## Notes
- This test validates core persistence layer
- WAL mode is critical for concurrent access
- Recovery should be automatic on restart
- Database should handle 10,000+ tasks