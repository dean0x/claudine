# Adaptive Resource Management for Claudine

## Philosophy
Rather than imposing hard limits that might interrupt legitimate long-running tasks, Claudine uses adaptive resource management that monitors, warns, and only intervenes when necessary to protect system stability.

## Key Principles

### 1. Observability Over Enforcement
- Monitor what tasks are doing
- Track resource usage patterns
- Provide visibility to users
- Alert on anomalies

### 2. User Control
- Users can cancel tasks at any time
- Users decide how to handle warnings
- No automatic task termination without user consent
- Configurable monitoring thresholds

### 3. Intelligent Monitoring

#### Heartbeat Monitoring
Instead of hard timeouts, monitor task activity:
- Track stdout/stderr output as signs of life
- Detect stalls (no output for extended periods)
- Emit notifications rather than killing tasks
- Allow tasks to run indefinitely if they're making progress

#### Resource-Based Monitoring
Monitor actual resource consumption:
- Memory usage (RSS, VSZ)
- CPU utilization
- File descriptor count
- Disk I/O patterns

#### Progress Tracking
For tasks that report progress:
- Track completion percentage
- Monitor phase transitions
- Estimate time remaining
- Detect stuck phases

## Implementation Strategy

### Soft vs Hard Limits

```typescript
interface ResourceLimits {
  // Soft limits trigger warnings
  soft: {
    maxConcurrent: 10,        // Warn when exceeded
    memoryPerTask: '2GB',     // Warn on high memory
    stallThreshold: 300000,   // Warn after 5 min inactivity
  },
  
  // Hard limits prevent system failure
  hard: {
    maxConcurrent: 50,        // Absolute maximum
    criticalMemory: '4GB',    // System protection threshold
    maxFileDescriptors: 1000, // OS limit protection
  }
}
```

### Monitoring Levels

1. **Passive Monitoring** (Default)
   - Collect metrics
   - Log activity
   - No interventions

2. **Active Monitoring**
   - Emit warnings on thresholds
   - Send notifications to user
   - Suggest actions

3. **Protective Mode**
   - Suspend tasks on critical thresholds
   - Create checkpoints before intervention
   - Allow manual resume

### Event-Driven Architecture

```typescript
// Events emitted by monitoring system
interface MonitoringEvents {
  'task:active': { taskId, stream, data }
  'task:stalled': { taskId, stalledFor, lastActivity }
  'task:high-memory': { taskId, usage, threshold }
  'task:critical-memory': { taskId, usage }
  'task:progress': { taskId, percent, phase }
  'task:checkpoint': { taskId, sessionId, timestamp }
}
```

## Adaptive Strategies

### 1. Dynamic Concurrency
Adjust concurrent task limit based on:
- Available system memory
- Current CPU load
- Active task resource usage
- Historical patterns

### 2. Smart Scheduling
- Pause low-priority tasks when resources are constrained
- Resume tasks when resources become available
- Queue tasks intelligently based on resource requirements

### 3. Checkpoint & Resume
For long-running tasks:
- Automatic checkpointing at intervals
- Session preservation (Claude Code's --resume)
- Suspend/resume capability (SIGSTOP/SIGCONT)
- Worktree state preservation

### 4. Resource Negotiation
Tasks can negotiate resources:
```typescript
interface TaskResourceRequest {
  minMemory?: string;      // Minimum required
  preferredMemory?: string; // Optimal performance
  canCheckpoint?: boolean;  // Supports suspend/resume
  priority?: 'P0' | 'P1' | 'P2';
}
```

## User Interaction Model

### Notifications
Users receive notifications for:
- Task stalls (with option to continue/cancel)
- High resource usage (with usage details)
- Queue congestion (with wait time estimates)
- Checkpoint creation (for recovery)

### Controls
Users can:
- Cancel any task: `CancelTask(taskId, reason?)`
- Suspend/resume tasks: `SuspendTask(taskId)` / `ResumeTask(taskId)`
- View task status: `TaskStatus(taskId?)`
- Get metrics: `TaskMetrics(taskId)`
- List all tasks: `ListTasks(filter?)`
- View logs: `TaskLogs(taskId, tail?)`

### Transparency
Provide clear visibility into:
- Why a task is queued
- Current resource usage
- Estimated completion time
- Available system resources

## Configuration Examples

### Minimal Restrictions (Development)
```json
{
  "monitoring": {
    "enabled": true,
    "level": "passive"
  },
  "limits": {
    "softMaxConcurrent": 20,
    "hardMaxConcurrent": 100,
    "defaultTimeout": null
  }
}
```

### Balanced (Default)
```json
{
  "monitoring": {
    "enabled": true,
    "level": "active",
    "stallThreshold": 300000,
    "checkpointInterval": 600000
  },
  "limits": {
    "softMaxConcurrent": 10,
    "hardMaxConcurrent": 50,
    "maxMemoryPerTask": "2GB",
    "defaultTimeout": null
  }
}
```

### Conservative (Production)
```json
{
  "monitoring": {
    "enabled": true,
    "level": "protective",
    "stallThreshold": 180000,
    "checkpointInterval": 300000
  },
  "limits": {
    "softMaxConcurrent": 5,
    "hardMaxConcurrent": 20,
    "maxMemoryPerTask": "1GB",
    "criticalMemory": "3GB",
    "defaultTimeout": 3600000
  }
}
```

## Benefits

1. **No Artificial Interruptions**: Long-running tasks can complete
2. **System Protection**: Prevents resource exhaustion
3. **User Empowerment**: Users control their tasks
4. **Graceful Degradation**: System adapts to load
5. **Recovery Options**: Checkpoints enable task resumption
6. **Transparency**: Clear feedback on system state

## Edge Cases Handled

1. **Memory Leak**: Detected via growing memory usage, user notified
2. **Infinite Loop**: Detected via CPU usage without output, user warned
3. **Deadlock**: Detected via complete stall, checkpoint created
4. **Resource Spike**: Temporary suspension, automatic resume
5. **System Overload**: Queue management, priority scheduling

## Future Enhancements

1. **Machine Learning**: Predict resource needs based on task patterns
2. **Cost Optimization**: Consider API costs in scheduling
3. **Distributed Execution**: Offload to other machines when local resources constrained
4. **Resource Reservation**: Pre-allocate resources for critical tasks
5. **Historical Analysis**: Learn from past task executions to improve predictions