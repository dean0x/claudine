# Dedicated Server Architecture

## Core Philosophy

Claudine is designed to run on **dedicated servers** with ample resources, not constrained cloud environments. This fundamentally changes our approach to resource management.

## Key Design Principles

### 1. Autoscaling by Default
- **No artificial worker limits** - spawn as many Claude Code instances as the system can handle
- **Dynamic resource monitoring** - continuously check available CPU and memory
- **Queue-based load management** - process tasks from queue as resources become available
- **No configuration needed** - autoscaling works out of the box

### 2. Resource-Based Scaling

```typescript
// Autoscaling logic
while (hasAvailableResources() && !taskQueue.isEmpty()) {
  const task = taskQueue.dequeue();
  spawnWorker(task);
}
```

**Resource thresholds**:
- Keep 20% CPU headroom for system stability
- Keep 1GB RAM available for OS operations
- Monitor but don't limit file descriptors
- No hard worker count limits

### 3. Queue Management
- **FIFO by default** - first in, first out
- **Priority support** - P0 tasks jump the queue
- **No queue size limit** - limited only by available memory
- **Persistent queue** - survives server restarts (Phase 2)

## Why This Approach?

### Traditional (Conservative) Approach ❌
- Fixed worker limits (e.g., 3-5 workers)
- Configuration required for different environments
- Underutilizes available resources
- Requires manual tuning

### Claudine (Dedicated Server) Approach ✅
- Automatic scaling based on actual resources
- No configuration needed
- Maximizes throughput
- Self-optimizing

## Expected Performance

On a typical dedicated server (32 cores, 64GB RAM):
- **10-20 concurrent Claude Code instances** under normal load
- **30-40 instances** for lightweight tasks
- **5-10 instances** for memory-intensive tasks
- **Automatic adjustment** based on task characteristics

## Implementation Details

### Resource Monitoring
```typescript
interface SystemResources {
  cpuUsage: number;      // 0-100%
  availableMemory: number; // bytes
  loadAverage: number[];   // 1, 5, 15 minute averages
  
  canSpawnWorker(): boolean {
    return cpuUsage < 80 && availableMemory > 1_000_000_000;
  }
}
```

### Worker Lifecycle
1. **Spawn**: Create new Claude Code process when resources available
2. **Execute**: Run task with full system access
3. **Monitor**: Track resource usage per worker
4. **Complete**: Clean up and check queue for next task
5. **Scale**: Continuously adjust worker count based on load

### Queue Behavior
- Tasks queued when no resources available
- Queue processed as soon as resources free up
- No artificial delays or throttling
- Backpressure handled naturally by resource limits

## Deployment Recommendations

### Minimum Requirements
- **CPU**: 8+ cores
- **RAM**: 16GB+
- **Disk**: 100GB+ SSD
- **OS**: Linux (Ubuntu 22.04+ recommended)

### Recommended Setup
- **CPU**: 32+ cores
- **RAM**: 64GB+
- **Disk**: 500GB+ NVMe SSD
- **Network**: 1Gbps+
- **OS**: Dedicated Linux server

### Monitoring
- Use system metrics (htop, iostat)
- Monitor via Claudine's metrics endpoint
- Set up alerts for resource exhaustion
- Track queue depth over time

## Comparison to Cloud Services

| Aspect | Cloud Service | Claudine |
|--------|--------------|----------|
| Worker Limits | Fixed (3-5) | Dynamic (unlimited) |
| Configuration | Required | None |
| Cost Model | Per-worker pricing | Fixed server cost |
| Scaling | Manual or stepped | Continuous |
| Resource Usage | Conservative | Maximized |
| Target User | Casual users | Power users/teams |

## Future Enhancements

### Phase 1 (Current Focus)
- Basic autoscaling implementation
- Resource monitoring
- Queue management
- No configuration needed

### Phase 2
- Persistent queue
- Historical metrics
- Resource prediction
- Task profiling

### Phase 3
- Cluster support (multiple servers)
- Distributed queue
- Cross-server load balancing
- Failover support

## FAQ

**Q: What if the server runs out of resources?**
A: Tasks queue automatically and process when resources are available.

**Q: Can I limit workers if needed?**
A: Yes, via environment variable, but it's not recommended.

**Q: How does it handle different task types?**
A: Autoscaling adapts - fewer workers for heavy tasks, more for light ones.

**Q: What about cloud deployments?**
A: Works fine, but you're not getting the full benefit. Consider a dedicated server.