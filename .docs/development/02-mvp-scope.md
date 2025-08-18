# MVP Scope: The Painful Workflow

## The Pain Point We're Solving

**Current Pain**: When working on a complex project with Claude Code, users need to manually manage multiple terminal windows/tabs to run parallel tasks, losing context and coordination between related work.

**Specific Scenario**: "I need Claude to refactor the backend API while simultaneously updating the frontend to match, but I have to manually coordinate these changes across multiple Claude Code sessions."

## MVP User Story

> As a developer using Claude Code,  
> I want to delegate a secondary task to run in the background,  
> So that I can continue working on my primary task without context switching.

## The Thin Vertical Slice

### Single Workflow: Parallel Development

```
User: "DelegateTask: Update all API tests to match the new schema while I continue refactoring the API endpoints"

Claudine: 
1. Spawns background Claude Code instance
2. Delegates the test update task
3. Returns control to user immediately
4. User continues with API refactoring
5. User can check status: "TaskStatus"
6. Background task completes
7. User reviews logs: "TaskLogs"
```

## MVP Features (Phase 1)

### Core Functionality
✅ **DelegateTask** - Delegate one task at a time
✅ **TaskStatus** - Check if task is running/completed
✅ **TaskLogs** - View task output
✅ **CancelTask** - Stop a running task

### Constraints (Keep it Simple)
- ❌ No task queue (one task at a time)
- ❌ No priorities (first come, first served)
- ❌ No dependencies (tasks run independently)
- ❌ No worktrees (use current directory)
- ❌ No resume/suspend (only cancel)
- ❌ No resource monitoring (trust the system)

## Technical Implementation (MVP)

### Minimal Viable Architecture
```typescript
class ClaudineMVP {
  private currentTask: Task | null = null;
  
  async delegateTask(prompt: string): Promise<string> {
    if (this.currentTask?.status === 'running') {
      throw new Error('Task already running. Cancel it first.');
    }
    
    const taskId = generateId();
    const child = spawn('claude', ['-p', prompt]);
    
    this.currentTask = {
      id: taskId,
      process: child,
      status: 'running',
      output: []
    };
    
    // Capture output
    child.stdout.on('data', (data) => {
      this.currentTask.output.push(data.toString());
    });
    
    child.on('exit', () => {
      this.currentTask.status = 'completed';
    });
    
    return taskId;
  }
}
```

## User Journey (MVP)

### Happy Path
1. User working on main task in Claude Code
2. Realizes they need parallel work done
3. Uses `DelegateTask` to spawn background task
4. Continues with main work
5. Periodically checks `TaskStatus`
6. Reviews output with `TaskLogs`
7. Integrates results

### Error Handling
- Task fails: User sees error in TaskLogs
- Task hangs: User can CancelTask
- System busy: Clear error message

## Success Metrics

### Retention Signal (Primary)
- **Target**: 30% of users who try it use it again within a week
- **Measure**: Unique users calling DelegateTask multiple times

### Usage Metrics (Secondary)
- Tasks delegated per user per day
- Task completion rate
- Average task duration
- Cancel rate

### Quality Metrics
- Error rate < 5%
- Response time < 500ms for status checks
- Successful task completion > 80%

## What We're NOT Building (MVP)

### Explicitly Out of Scope
1. **Complex Scheduling**: No priorities, queues, or dependencies
2. **Resource Management**: No CPU/memory monitoring
3. **Persistence**: Tasks don't survive server restart
4. **Recovery**: No checkpoint/resume
5. **Multi-tenancy**: Single user only
6. **UI**: MCP tools only (CLI interface coming in Phase 2)

### Why These Exclusions?
- Reduce complexity by 80%
- Ship in days, not weeks
- Get real user feedback fast
- Iterate based on actual usage

## Development Effort Estimate

### Week 1: Foundation
- Day 1-2: Project setup, MCP server scaffold
- Day 3-4: DelegateTask implementation
- Day 5: TaskStatus and TaskLogs

### Week 2: Polish & Ship
- Day 1-2: Error handling, testing
- Day 3: Claude Desktop integration
- Day 4: Documentation
- Day 5: Ship to early users

**Total: 10 days to production**

## Validation Questions

Before building, validate with 5 potential users:

1. "Would you use a tool that lets you delegate secondary tasks to background Claude Code instances?"
2. "What's the most painful coordination problem you have with Claude Code today?"
3. "How many parallel tasks do you typically need?"
4. "How important is task persistence across sessions?"

## Go/No-Go Criteria

### Build if:
- ✅ 3+ users express strong interest
- ✅ Can implement in < 2 weeks
- ✅ Claude Desktop supports our approach

### Don't build if:
- ❌ Users prefer manual coordination
- ❌ Technical blockers discovered
- ❌ Better solution already exists

## Next Steps

1. **Validate**: Quick user interviews (2 days)
2. **Prototype**: Bare minimum POC (1 day)
3. **Build**: MVP implementation (10 days)
4. **Ship**: Deploy to early adopters
5. **Measure**: Track retention signal
6. **Iterate**: Based on feedback

## Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Users don't see value | High | Medium | Validate before building |
| Technical complexity | High | Low | Start simple, iterate |
| Claude Code changes | High | Low | Use stable CLI features |
| Poor performance | Medium | Medium | Monitor and optimize |

## Definition of Done (MVP)

- [ ] DelegateTask successfully spawns Claude Code
- [ ] Output captured and retrievable
- [ ] Can check task status
- [ ] Can cancel running task
- [ ] Works with Claude Desktop
- [ ] Basic error handling
- [ ] README with setup instructions
- [ ] 5 manual test cases pass