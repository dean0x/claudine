# Git Worktree Research

## Overview
Git worktrees allow you to have multiple working directories associated with a single Git repository. This enables parallel development on different branches without the overhead of multiple clones or constant branch switching.

## Core Concepts

### 1. Worktree Architecture
```
project/
├── .git/                    # Main repository (shared)
├── main-working-dir/        # Primary worktree
│   └── src/
└── worktrees/
    ├── feature-a/           # Worktree for feature-a branch
    │   ├── .git             # File pointing to main .git
    │   └── src/
    └── bugfix-b/            # Worktree for bugfix-b branch
        ├── .git             # File pointing to main .git
        └── src/
```

### 2. Basic Commands

#### Creating Worktrees
```bash
# Create worktree for existing branch
git worktree add ../feature-branch feature-branch

# Create worktree with new branch
git worktree add -b new-feature ../new-feature

# Create detached worktree (no branch)
git worktree add -d ../experiment

# Create worktree from specific commit
git worktree add ../hotfix abc123
```

#### Managing Worktrees
```bash
# List all worktrees
git worktree list

# List with more details
git worktree list --porcelain

# Remove worktree
git worktree remove ../feature-branch

# Prune stale worktree information
git worktree prune
```

### 3. Claudine Integration Strategy

#### Automated Worktree Creation
```javascript
const { exec } = require('child_process');
const path = require('path');

class WorktreeManager {
  constructor(baseRepo) {
    this.baseRepo = baseRepo;
    this.worktreesDir = path.join(baseRepo, '..', 'claudine-worktrees');
  }

  async createTaskWorktree(taskId, branch = null) {
    const worktreePath = path.join(this.worktreesDir, `task-${taskId}`);
    
    // Create worktree directory if it doesn't exist
    await this.ensureDirectory(this.worktreesDir);
    
    // Create worktree command
    const branchArg = branch ? branch : `-b task-${taskId}`;
    const cmd = `git worktree add ${worktreePath} ${branchArg}`;
    
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd: this.baseRepo }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            path: worktreePath,
            taskId,
            branch: branch || `task-${taskId}`
          });
        }
      });
    });
  }

  async removeTaskWorktree(taskId) {
    const worktreePath = path.join(this.worktreesDir, `task-${taskId}`);
    const cmd = `git worktree remove ${worktreePath}`;
    
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd: this.baseRepo }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async listWorktrees() {
    return new Promise((resolve, reject) => {
      exec('git worktree list --porcelain', { cwd: this.baseRepo }, 
        (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            const worktrees = this.parseWorktreeList(stdout);
            resolve(worktrees);
          }
        }
      );
    });
  }

  parseWorktreeList(output) {
    const worktrees = [];
    const lines = output.split('\n');
    let current = {};
    
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current);
        current = { path: line.substring(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7);
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === 'locked') {
        current.locked = true;
      }
    }
    if (current.path) worktrees.push(current);
    
    return worktrees;
  }
}
```

### 4. Clean Worktree Organization

#### Recommended Structure
```bash
# Using bare repository for cleaner organization
mkdir my-project
cd my-project

# Clone as bare repository
git clone --bare git@github.com:user/project.git .bare

# Configure git to use .bare directory
echo "gitdir: ./.bare" > .git

# Create main worktree
git worktree add main

# Create feature worktrees
git worktree add feature-1
git worktree add hotfix-prod main
```

Result:
```
my-project/
├── .bare/           # Bare repository (git data)
├── .git             # Points to .bare
├── main/            # Main branch worktree
├── feature-1/       # Feature branch worktree
└── hotfix-prod/     # Hotfix worktree
```

### 5. Benefits for Claudine

#### Parallel Execution
- Each task runs in isolated filesystem
- No interference between concurrent tasks
- Independent dependency installations
- Separate build artifacts

#### Resource Efficiency
- Single repository storage (shared .git)
- Faster than cloning
- Minimal disk overhead
- Instant branch switching

#### Clean State Management
- Each worktree maintains its own:
  - Working directory state
  - Staged changes
  - Build outputs
  - Node modules (if applicable)

### 6. Integration with Claude Code

```javascript
class ClaudineTaskExecutor {
  async executeTask(task) {
    // Create worktree for task
    const worktree = await this.worktreeManager.createTaskWorktree(task.id);
    
    // Spawn Claude Code in worktree
    const claudeProcess = spawn('claude', [
      '-p',
      '--resume', task.sessionId || '',
      task.prompt
    ], {
      cwd: worktree.path,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Capture output
    claudeProcess.stdout.on('data', (data) => {
      this.logger.info(`Task ${task.id}: ${data}`);
    });
    
    // Cleanup on completion
    claudeProcess.on('exit', async (code) => {
      if (task.cleanup) {
        await this.worktreeManager.removeTaskWorktree(task.id);
      }
    });
    
    return claudeProcess;
  }
}
```

### 7. Best Practices

1. **Use descriptive worktree names** (e.g., `task-123`, `feature-auth`)
2. **Clean up worktrees after task completion** (unless needed for review)
3. **Implement worktree locking** for critical operations
4. **Monitor worktree count** (Git has limits)
5. **Use bare repositories** for cleaner organization
6. **Regular pruning** of stale worktree entries
7. **Document worktree purpose** in branch names/commits
8. **Avoid nested worktrees**
9. **Set up .gitignore** for worktree-specific files
10. **Use consistent directory structure**

### 8. Limitations & Considerations

- **One worktree per branch** (can't checkout same branch twice)
- **Shared Git hooks** (all worktrees use same hooks)
- **Repository-wide Git config** (shared across worktrees)
- **File system limits** (max number of directories)
- **Performance impact** with many worktrees

## References
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Git Worktree Tutorial](https://git-scm.com/docs/git-worktree/2.7.4)
- [Worktree Best Practices](https://morgan.cugerone.com/blog/how-to-use-git-worktree-and-in-a-clean-way/)