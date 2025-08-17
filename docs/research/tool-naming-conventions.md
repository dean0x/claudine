# Claudine Tool Naming Conventions

## Claude Code Native Tools Reference

Based on research, Claude Code's native tools follow a **PascalCase** naming convention (capitalizing the first letter of each word). Here are the identified native tools:

### Core File Operations
- `Read` - Reads file contents
- `Write` - Writes new files
- `Edit` - Edits existing files
- `MultiEdit` - Multiple edits in a single operation
- `View` - Views file contents

### System Operations
- `Bash` - Executes bash commands
- `LS` - Lists directory contents
- `Grep` - Searches for patterns in files

### Workflow Tools
- `TodoWrite` - Manages todo lists
- `ExitPlanMode` - Exits planning mode

### Naming Pattern Analysis
1. **PascalCase**: First letter of each word is capitalized
2. **Action-Oriented**: Tools are named as verbs or action phrases
3. **Descriptive**: Names clearly indicate the tool's function
4. **Concise**: Generally 1-2 words, avoiding unnecessary prefixes

## Claudine Tool Naming Strategy

To complement Claude Code's tools and maintain consistency, Claudine adopts the following naming conventions:

### Naming Principles
1. **Use PascalCase** - Match Claude Code's convention
2. **Be Descriptive** - Clear indication of functionality
3. **Avoid Conflicts** - Don't overlap with native tool names
4. **Action-First** - Start with a verb when possible
5. **Domain Context** - Include "Task" to indicate delegation context
6. **Consistency** - All primary tools include "Task" for clarity

### Claudine Tools

| Tool Name | Description | Previous Name |
|-----------|-------------|---------------|
| `DelegateTask` | Delegate a task to a background Claude Code instance | `claudine.spawn` |
| `TaskStatus` | Get status of delegated tasks | `claudine.status` |
| `TaskLogs` | Retrieve execution logs from delegated tasks | `claudine.logs` |
| `CancelTask` | Cancel a running delegated task | `claudine.cancel` |
| `SuspendTask` | Suspend a running delegated task | (new) |
| `ResumeTask` | Resume a suspended delegated task | (new) |
| `ListTasks` | List all delegated tasks with status | (new) |
| `TaskMetrics` | Get resource metrics for a delegated task | (new) |

### Tool Invocation Examples

```typescript
// Delegate a new task
DelegateTask({
  prompt: "Implement user authentication",
  priority: "P1",
  useWorktree: true
})

// Check task status
TaskStatus({ taskId: "abc-123" })

// Get all running tasks
ListTasks({ filter: "running" })

// Cancel with reason
CancelTask({ 
  taskId: "abc-123",
  reason: "Requirements changed"
})

// View task logs
TaskLogs({
  taskId: "abc-123",
  tail: 50
})
```

## Integration Benefits

### Consistency
- Claudine tools follow the same naming pattern as Claude Code
- Users familiar with Claude Code will find Claudine intuitive
- Reduces cognitive load when switching between tools

### Clarity
- Tool names immediately convey their purpose
- "Task" prefix/suffix indicates delegation context
- No ambiguity with native Claude Code operations

### Discoverability
- PascalCase tools are easily identifiable in code
- Autocomplete works well with consistent naming
- Related tools grouped by naming pattern (Task*)

## Future Considerations

### Potential Additional Tools
- `DelegateMultipleTasks` - Delegate multiple tasks in batch
- `TaskDependencies` - Manage task dependencies
- `UpdateTaskPriority` - Adjust task priority dynamically
- `CheckpointTask` - Create task checkpoint manually
- `TaskHistory` - View historical task executions
- `CloneTask` - Duplicate a task configuration

### Namespace Alternative
If tools grow significantly, consider optional namespacing:
- `Task.Delegate`
- `Task.Status`
- `Task.Cancel`
- etc.

This would group all task-related tools while maintaining the PascalCase convention.

## Implementation Notes

1. **MCP Registration**: Tools are registered with their PascalCase names
2. **Documentation**: All tools should have clear, concise descriptions
3. **Error Messages**: Use tool names consistently in error messages
4. **Logging**: Log tool invocations with their proper names
5. **Backwards Compatibility**: Consider aliases for migration period

## References
- Claude Code native tools observed through research
- MCP tool registration patterns
- Industry standards for CLI tool naming (PascalCase for commands)