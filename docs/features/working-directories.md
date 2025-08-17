# Working Directory Management

Claudine supports flexible working directory management for delegated tasks, allowing you to control where files are created and modified.

## Features

### 1. Default Behavior
If no working directory is specified, tasks execute in the current working directory where the Claudine server is running.

```
Use DelegateTask to run: Create test.py
Result: Creates test.py in current directory
```

### 2. Custom Working Directory
Specify an absolute path where the task should execute:

```
Use DelegateTask with:
- prompt: Create a Python project structure
- workingDirectory: /home/user/projects/new-project
```

Features:
- Must be an absolute path
- Directory is created if it doesn't exist
- All file operations happen in this directory
- Path is shown in TaskStatus output

### 3. Git Worktrees (Isolated Execution)
For true isolation, use git worktrees to run tasks in a separate working tree:

```
Use DelegateTask with:
- prompt: Refactor all Python files to use type hints
- useWorktree: true
```

Features:
- Creates a git worktree in `.claudine-worktrees/<task-id>/`
- Complete isolation from main working directory
- Based on current branch
- Automatically cleaned up when task completes
- Requires being in a git repository

## Usage Examples

### Example 1: Organize Output Files
```json
{
  "prompt": "Generate API documentation",
  "workingDirectory": "/workspace/claudine/task-outputs/docs"
}
```
Result: All generated docs go to `task-outputs/docs/`

### Example 2: Test in Isolation
```json
{
  "prompt": "Run experimental refactoring",
  "useWorktree": true
}
```
Result: Changes made in isolated worktree, main code untouched

### Example 3: Project-Specific Tasks
```json
{
  "prompt": "Initialize a new React project",
  "workingDirectory": "/home/user/projects/my-react-app"
}
```
Result: React project created in specified directory

## Directory Structure

```
claudine/
├── task-outputs/          # Recommended for task outputs
│   ├── task-1/
│   ├── task-2/
│   └── ...
├── .claudine-worktrees/   # Git worktrees (auto-managed)
│   ├── <task-id-1>/
│   ├── <task-id-2>/
│   └── ...
└── ... (your code)
```

## Best Practices

1. **Use task-outputs/ for general tasks**
   ```json
   {
     "workingDirectory": "/workspace/claudine/task-outputs/my-task"
   }
   ```

2. **Use worktrees for experimental changes**
   ```json
   {
     "useWorktree": true
   }
   ```

3. **Use absolute paths for clarity**
   ```json
   {
     "workingDirectory": "/absolute/path/to/directory"
   }
   ```

## API Reference

### DelegateTask Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | The task to execute |
| `workingDirectory` | string | No | Current directory | Absolute path for task execution |
| `useWorktree` | boolean | No | false | Create git worktree for isolation |

### TaskStatus Response

Now includes:
- `workingDirectory`: The directory where task is executing
- `worktreePath`: Path to git worktree (if created)

## Limitations

1. **Worktrees require git repository**
   - Only works if Claudine is running in a git repo
   - Falls back to workingDirectory if specified

2. **Absolute paths only**
   - workingDirectory must be absolute path
   - Relative paths will be rejected

3. **Cleanup**
   - Worktrees are automatically cleaned up
   - Custom directories persist after task completion

## Error Handling

- **Invalid path**: Returns error if path is not absolute
- **Git not available**: Falls back to regular directory if worktree requested
- **Permission denied**: Task fails if directory cannot be created

## Future Enhancements

- Relative path support with resolution
- Template directories for common tasks
- Automatic output organization by date/type
- Worktree branch selection
- Directory size limits