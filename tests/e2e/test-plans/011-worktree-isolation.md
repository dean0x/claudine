# E2E Test Plan: Worktree Isolation

## Test Metadata
- **Test ID:** E2E-011
- **Category:** Worktree Management
- **Priority:** P1
- **Estimated Duration:** 45 seconds
- **Dependencies:** Git repository

## Test Description
Verify git worktree creation with custom branches, task execution in isolated worktree, and cleanup based on strategy (auto/keep/delete).

## Prerequisites
```yaml
preconditions:
  - Git repository initialized
  - Clean git status
  - Build completed successfully
```

## Test Steps

### Step 1: Ensure Git Repository
**Action:** Verify git repository exists
```bash
git status || git init
git config user.email "test@delegate.ai" || true
git config user.name "Delegate Test" || true
```
**Expected:** Git repository ready
**Verify:**
- Git status works
- User configured

### Step 2: Clean Worktree State
**Action:** Remove any existing worktrees
```bash
rm -rf .worktrees/
git worktree prune
git worktree list
```
**Expected:** Only main worktree exists
**Verify:**
- No additional worktrees
- Clean state

### Step 3: Build Project
**Action:** Build the TypeScript project
```bash
npm run build
```
**Expected:** Build completes successfully
**Verify:**
- No TypeScript errors
- dist/ directory exists

### Step 4: Create Task with Worktree
**Action:** Delegate task with worktree enabled
```bash
node dist/cli.js delegate "echo 'Testing in worktree' > test-file.txt && cat test-file.txt" --branch test-worktree-1
```
**Expected:** Task with worktree created
**Verify:**
- Task ID returned
- Branch name mentioned

### Step 5: Verify Worktree Created
**Action:** Check worktree was created
```bash
sleep 2
git worktree list | grep -v "bare"
ls -la .worktrees/ 2>/dev/null || echo "No worktrees directory yet"
```
**Expected:** New worktree exists
**Verify:**
- Worktree listed
- Directory created

### Step 6: Check Branch Created
**Action:** Verify branch exists
```bash
git branch -a | grep test-worktree-1 || echo "Branch not found"
```
**Expected:** Branch created
**Verify:**
- Branch test-worktree-1 exists
- Branch is local

### Step 7: Verify Isolation
**Action:** Confirm main directory unchanged
```bash
ls test-file.txt 2>/dev/null && echo "❌ File leaked to main" || echo "✓ Main directory isolated"
```
**Expected:** File not in main
**Verify:**
- test-file.txt not in main directory
- Isolation working

### Step 8: Test Keep Strategy
**Action:** Create task with keep-worktree
```bash
node dist/cli.js delegate "echo 'Keep strategy test' > keep-test.txt" --branch test-keep --keep-worktree
```
**Expected:** Task with keep strategy
**Verify:**
- Task ID returned
- Keep strategy noted

### Step 9: Wait and Verify Kept
**Action:** Verify worktree remains after completion
```bash
sleep 5
git worktree list | grep test-keep && echo "✓ Worktree kept" || echo "❌ Worktree removed"
ls .worktrees/*/keep-test.txt 2>/dev/null && echo "✓ File exists in worktree" || echo "⚠ File not found"
```
**Expected:** Worktree persists
**Verify:**
- Worktree still exists
- Files preserved

### Step 10: Test Delete Strategy
**Action:** Create task with delete-worktree
```bash
node dist/cli.js delegate "echo 'Delete strategy test' > delete-test.txt" --branch test-delete --delete-worktree
```
**Expected:** Task with delete strategy
**Verify:**
- Task ID returned
- Delete strategy noted

### Step 11: Verify Deletion
**Action:** Confirm worktree removed after completion
```bash
sleep 5
git worktree list | grep test-delete && echo "❌ Worktree not deleted" || echo "✓ Worktree deleted"
```
**Expected:** Worktree removed
**Verify:**
- Worktree not in list
- Cleanup worked

### Step 12: Test Multiple Concurrent Worktrees
**Action:** Create multiple worktrees simultaneously
```bash
for i in 1 2 3; do
  node dist/cli.js delegate "echo 'Concurrent worktree $i' > concurrent-$i.txt" --branch concurrent-$i &
done
wait
```
**Expected:** Multiple worktrees created
**Verify:**
- 3 task IDs returned
- No conflicts

### Step 13: Verify Concurrent Isolation
**Action:** Check all worktrees are separate
```bash
sleep 3
git worktree list | grep -c concurrent || echo "0"
ls -la .worktrees/
```
**Expected:** 3+ concurrent worktrees
**Verify:**
- Multiple worktrees exist
- Each in separate directory

### Step 14: Test Base Branch
**Action:** Create worktree from specific base
```bash
# Create a test branch first
git checkout -b test-base 2>/dev/null || git checkout test-base
echo "Base branch content" > base-file.txt
git add base-file.txt 2>/dev/null && git commit -m "Base commit" 2>/dev/null || true
git checkout main 2>/dev/null || git checkout master

# Create task from test-base
node dist/cli.js delegate "ls base-file.txt && echo 'From base' >> base-file.txt" --branch from-base --base test-base
```
**Expected:** Worktree from test-base
**Verify:**
- Task created
- Base branch specified

### Step 15: Verify Base Branch Content
**Action:** Check worktree has base content
```bash
sleep 3
cat .worktrees/*/base-file.txt 2>/dev/null | grep "Base branch content" && echo "✓ Base content present" || echo "❌ Base content missing"
```
**Expected:** Base file exists
**Verify:**
- base-file.txt exists
- Contains base content

### Step 16: Cleanup
**Action:** Clean up all test artifacts
```bash
# Remove all worktrees
git worktree list | grep -v "bare" | tail -n +2 | awk '{print $1}' | xargs -r git worktree remove --force 2>/dev/null || true
git worktree prune
# Clean branches
git branch -D test-worktree-1 test-keep test-delete concurrent-1 concurrent-2 concurrent-3 from-base test-base 2>/dev/null || true
# Clean directories
rm -rf .worktrees/ .delegate/
pkill -f "delegate" || true
```
**Expected:** Cleanup successful
**Verify:**
- Worktrees removed
- Branches deleted

## Success Criteria
- [ ] Worktrees created with custom branches
- [ ] Tasks execute in isolated environment
- [ ] Keep strategy preserves worktree
- [ ] Delete strategy removes worktree
- [ ] Auto strategy works correctly
- [ ] Multiple concurrent worktrees work
- [ ] Base branch specification works
- [ ] No file leakage to main directory

## Rollback Plan
If test fails:
1. Force remove worktrees: `git worktree remove --force`
2. Prune worktrees: `git worktree prune`
3. Clean branches: `git branch -D test-*`
4. Remove directories: `rm -rf .worktrees/`

## Notes
- Worktrees provide complete isolation
- Each worktree gets its own branch
- Cleanup strategies: auto, keep, delete
- Default strategy is auto (keeps on success, deletes on failure)