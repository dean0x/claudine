# Claudine Development Roadmap

## Current Status: v0.3.0 ✅

**Status**: Production Ready

Claudine v0.3.0 is a fully-featured MCP server with autoscaling, persistence, task dependencies, and advanced task management. See [FEATURES.md](./FEATURES.md) for complete list of current capabilities.

---

## Future Development

### v0.2.5 - Enhanced Worktree Safety Features
**Goal**: Add safety mechanisms for worktree operations  
**Priority**: Medium - Stability and data protection

#### Features
- **Pre-execution Conflict Detection**: Analyze potential conflicts before task execution
- **Automatic Patch Backups**: Create patch files before any merge operation
- **Rollback Capability**: Restore to original state if operations fail
- **Atomic Operations**: Ensure all git operations complete or none do
- **Dry Run Mode**: Preview changes without applying them
- **Worktree Preservation**: Never lose work due to failed merges

#### Technical Implementation
```typescript
interface SafetyOptions {
  conflictCheck: boolean;
  autoBackup: boolean;
  dryRun: boolean;
  atomicOperations: boolean;
}
```

---

### v0.3.0 - Task Dependencies ✅
**Goal**: Enable complex workflows with task chaining
**Priority**: High - Most requested feature
**Status**: **COMPLETED** - Merged to main

#### Features ✅
- **Task Dependencies**: Tasks can wait for other tasks to complete
- **DAG Validation**: Cycle detection prevents dependency deadlocks
- **Automatic Unblocking**: Tasks execute when dependencies complete
- **Event-Driven Resolution**: Dependency state tracked through event system
- **Database Persistence**: Dependencies survive server restarts

#### Implementation Highlights
- **975 lines of core implementation** across 3 components
- **2,172 lines of tests** (74 tests) with 82% coverage
- **Zero new dependencies** - pure TypeScript implementation
- **O(V+E) cycle detection** using DFS algorithm
- **TOCTOU protection** via synchronous transactions
- **5 database indexes** for optimal query performance

#### Technical Implementation
```typescript
interface TaskDependency {
  id: number;
  taskId: TaskId;
  dependsOnTaskId: TaskId;
  createdAt: number;
  resolvedAt: number | null;
  resolution: 'pending' | 'completed' | 'failed' | 'cancelled';
}

interface Task {
  // ... existing fields
  dependsOn?: readonly TaskId[];
  dependents?: readonly TaskId[];
  dependencyState?: 'blocked' | 'ready' | 'none';
}
```

#### MCP Tool Support
```typescript
// DelegateTask now accepts dependsOn array
{
  "prompt": "run integration tests",
  "dependsOn": ["task-build-123", "task-db-setup-456"]
}
```

#### Architecture
- **DependencyGraph**: Pure DAG validation algorithms
- **DependencyRepository**: SQLite persistence with prepared statements
- **DependencyHandler**: Event-driven coordination
- **QueueHandler**: Dependency-aware task queueing

#### Documentation
- 572-line comprehensive feature guide (`docs/task-dependencies.md`)
- Architecture comments on all major components
- ASCII diagrams for event flows
- Troubleshooting guide with debugging queries

---

### v0.3.1 - Task Dependencies: Performance & Quality
**Goal**: Optimize task dependency system based on production feedback
**Priority**: High - Performance and maintainability improvements
**Status**: Planned post-v0.3.0

#### Performance Optimizations

**HIGH Priority**:
- **Batch Dependency Resolution** (2-4 hours)
  - Replace N+1 queries with single batch UPDATE + JOIN
  - Estimated improvement: 7-10× faster for tasks with many dependents
  - Impact: Critical for tasks with 10+ dependents

- **Multi-Dependency Transactions** (1-2 hours)
  - Wrap multiple dependency additions in single atomic transaction
  - Prevents partial state when adding multiple dependencies fails mid-way
  - Impact: Ensures consistency for complex dependency chains

- **Input Validation Limits** (30 minutes)
  - Max 100 dependencies per task (prevent DoS)
  - Max 100 dependency chain depth (prevent stack overflow)
  - Impact: Security hardening for production deployment

**MEDIUM Priority**:
- **Incremental Graph Updates** (3-4 hours)
  - Avoid O(N) findAll() query on every dependency addition
  - Maintain in-memory graph with incremental updates
  - Estimated improvement: 70-80% reduction in dependency addition latency

- **Parallel Dependency Validation** (1-2 hours)
  - Validate multiple dependencies concurrently using Promise.all()
  - Estimated improvement: 30-40% reduction in task delegation latency

- **Transitive Query Memoization** (1-2 hours)
  - Cache results of getAllDependencies() and getAllDependents()
  - Estimated improvement: 90%+ for monitoring/dashboard queries
  - Impact: Significant benefit for administrative queries

#### Architecture Refinements

**MEDIUM Priority**:
- **Remove Cycle Detection from Repository Layer** (3-4 hours)
  - Move all business logic validation to DependencyHandler
  - Repository becomes pure data access layer
  - Impact: Cleaner separation of concerns, better testability

- **Consolidate Graph Caching** (2 hours)
  - Single cache in service layer (remove repository cache)
  - Eliminates dual cache invalidation complexity
  - Impact: Simpler reasoning about cache correctness

**LOW Priority**:
- **Extract Error Handling Utilities** (3-4 hours)
  - DRY up ~150 lines of repeated error logging patterns
  - Create `logAndReturnError()` helper function
  - Impact: Maintainability improvement

- **Extract Event Emission Helpers** (2 hours)
  - DRY up ~80 lines of repeated event emission patterns
  - Add `BaseHandler.emitEvent()` with error handling
  - Impact: Reduced boilerplate in event handlers

#### Quality Improvements

**HIGH Priority**:
- **Complete JSDoc Coverage** (45 minutes)
  - Add @param tags to all public methods in dependency-graph.ts
  - Add complete JSDoc to dependency-repository.ts
  - Impact: Better IDE autocomplete and developer experience

- **Integration Test Gaps** (1 hour)
  - Add QueueHandler integration test (blocked tasks → unblocked → queued)
  - Add end-to-end multi-level dependency chain test
  - Add failed/cancelled dependency propagation tests
  - Impact: Critical production scenarios validated

**MEDIUM Priority**:
- **Database Constraints** (15 minutes + migration)
  - Add CHECK constraint for resolution enum values
  - Defense-in-depth validation at database level
  - Impact: Additional data integrity protection

#### Behavioral Clarifications

**Documentation Needed**:
- **Failed Dependency Semantics**: Document what happens when dependency fails
  - Options: Auto-fail dependents, auto-cancel dependents, or leave queued
  - Current behavior: Dependency marked "failed", dependent tasks remain blocked
  - Decision needed: Should dependents auto-fail or require manual intervention?

- **Cancelled Dependency Propagation**: Define cascade behavior
  - Should cancelling a task cascade to all dependents?
  - Or should dependents remain blocked until manually cancelled?

#### Success Metrics
- [ ] Batch resolution implemented - 10× improvement measured
- [ ] JSDoc coverage 100% for public APIs
- [ ] Integration test coverage for QueueHandler
- [ ] Performance benchmarks added to CI
- [ ] Zero reported dependency deadlocks in production
- [ ] Documentation covers failed dependency behavior

---

### v0.4.0 - Task Resumption & Scheduling
**Goal**: Production-ready workflow automation with recovery and scheduling
**Priority**: High - Critical for production reliability
**Status**: **PARTIAL** - Task Scheduling implemented; Task Resumption still in research

#### Task Resumption 🔄
Resume failed or interrupted tasks from last checkpoint, preserving conversation context and partial work.

**Features**:
- **Session Continuation**: Resume Claude tasks from failure/interruption points
- **Checkpoint Mechanism**: Automatic checkpoints every N tool calls or minutes
- **State Recovery**: Preserve conversation history, tool calls, and git state
- **Conflict Detection**: Detect external file changes during task downtime
- **Smart Restart**: Resume with context: "Previous attempt failed at step X..."

**Use Cases**:
- Long-running refactors that fail midway → Resume instead of restart
- Server crashes during task → Recover partial work automatically
- Network interruptions → Continue where left off

**Complexity**: HIGH - Research phase required
- **Unknown**: Does Claude API support session continuation?
- **Fallback**: "Retry with context injection" if full resumption not feasible
- **Timeline**: 2-3 days research + 3-4 weeks implementation (or 1 week for fallback)

**Implementation** (Tentative):
```typescript
// Resume failed task from checkpoint
const result = await taskManager.resumeTask(taskId, {
  from: 'last-checkpoint',
  preserveHistory: true,
  conflictResolution: 'fail'  // or 'merge' | 'override'
});
```

**Database**:
- New `task_sessions` table for checkpoints
- Store: conversation_history, tool_calls, git_state
- Checkpoint triggers: Every 10 tool calls, every 5 minutes, before risky operations

**Decision Gate**: Research Claude API capabilities before full implementation commitment

#### Task Scheduling ✅
Execute tasks at specific times or recurring intervals using cron-like scheduling.

**Status**: **IMPLEMENTED** - Merged in v0.4.0

**Features** (all implemented):
- **Cron Syntax**: Standard 5-field cron expressions for recurring tasks
- **One-Time Scheduling**: ISO 8601 datetime for delayed execution
- **Time Zone Support**: IANA timezone handling with DST awareness
- **Missed Run Policies**: Skip, catchup, or fail after server downtime
- **Schedule History**: Track all executions and failures
- **Concurrent Execution Prevention**: Lock-based protection against overlapping runs
- **Pause/Resume**: Schedules can be paused and resumed

**MCP Tools**: `ScheduleTask`, `ListSchedules`, `GetSchedule`, `CancelSchedule`, `PauseSchedule`, `ResumeSchedule`

**Implementation**:
```typescript
// Daily backup at 2am
await ScheduleTask({
  prompt: "Backup database to S3",
  scheduleType: "cron",
  cronExpression: "0 2 * * *",
  timezone: "America/New_York",
  missedRunPolicy: "catchup"
});

// One-time delayed execution
await ScheduleTask({
  prompt: "Deploy to production",
  scheduleType: "one_time",
  scheduledAt: "2026-02-19T08:00:00Z"
});
```

**Database**:
- `schedules` table: schedule definitions, cron/one-time config, status, timezone
- `schedule_executions` table: execution history and audit trail
- Timer-based execution: Check every minute for due tasks

#### Timeline
- **Week 1-2**: Research Task Resumption feasibility (Claude API session support)
- **Week 3-5**: Implement Task Resumption (full or fallback) OR defer if not feasible
- **Week 6**: Implement Task Scheduling
- **Total**: 6 weeks

#### Success Criteria
- [ ] Task Resumption: Can resume from checkpoint within 30 seconds (if implemented)
- [ ] Task Resumption: Fallback "retry with context" working (minimum viable)
- [ ] Task Scheduling: Tasks execute within 1 minute of scheduled time
- [ ] Task Scheduling: Recurring tasks repeat correctly
- [ ] Integration: Scheduled tasks can have dependencies

---

### v0.5.0 - Distributed Processing
**Goal**: Scale across multiple servers for enterprise deployments
**Priority**: Medium - Enterprise use cases

#### Features
- **Multi-Server Support**: Distribute tasks across multiple Claudine instances
- **Load Balancing**: Intelligent task distribution based on server resources
- **Shared State**: Centralized task queue and status tracking (Redis backend)
- **Fault Tolerance**: Handle server failures gracefully with automatic failover
- **Server Discovery**: Automatic server registration and health checks
- **Task Affinity**: Route related tasks to the same server for efficiency

#### Architecture Changes
- **Redis Backend**: Shared task queue and state management across servers
- **gRPC Communication**: High-performance inter-server communication protocol
- **Server Discovery**: Automatic server registration and health checks
- **Task Affinity**: Route related tasks to the same server

---

### v0.6.0 - Advanced Orchestration & Templates
**Goal**: Sophisticated workflow management with reusable components
**Priority**: Medium - Power user features

#### Features
- **Task Templates**: Reusable task configurations with preset parameters
- **Workflow Definitions**: YAML-based workflow specifications
- **Conditional Logic**: If/else branches in workflows
- **Loop Support**: Repeat tasks based on conditions
- **Human Approval**: Manual approval steps in workflows
- **Task Chaining DSL**: Domain-specific language for complex workflows
- **Workflow Variables**: Pass data between tasks in a workflow

#### Example Workflow
```yaml
name: "Full Deployment Pipeline"
tasks:
  - name: "run-tests"
    template: "test-suite"
    
  - name: "build-app" 
    depends-on: ["run-tests"]
    template: "docker-build"
    
  - name: "deploy-staging"
    depends-on: ["build-app"]
    template: "k8s-deploy"
    environment: "staging"
    
  - name: "manual-approval"
    type: "approval"
    depends-on: ["deploy-staging"]
    
  - name: "deploy-prod"
    depends-on: ["manual-approval"]
    template: "k8s-deploy"
    environment: "production"
```

---

### v0.7.0 - Monitoring & REST API
**Goal**: Production observability, external integrations, and multi-user support
**Priority**: Medium - Production readiness

#### Features
- **Web Dashboard**: Real-time task monitoring UI with live updates
- **REST API**: HTTP API alongside MCP protocol for non-MCP clients
- **Multi-User Support**: User authentication and task isolation
- **Metrics Collection**: Prometheus/Grafana integration
- **Alerting**: Slack/email notifications for failures
- **Performance Analytics**: Task execution trends and bottlenecks
- **Resource Optimization**: Automatic scaling recommendations
- **Audit Logging**: Complete audit trail for compliance

#### Monitoring Stack
- **Metrics**: Task completion rates, execution times, resource usage
- **Dashboards**: Grafana dashboards for operational insights
- **Alerts**: PagerDuty integration for critical failures
- **Logs**: Centralized logging with ELK stack integration
- **API Gateway**: REST endpoints with OpenAPI documentation

---

## Research & Experimentation

### Future Investigations
- **AI-Assisted Debugging**: Automatic error analysis and suggestions
- **Smart Task Splitting**: Break large tasks into smaller parallel units
- **Resource Prediction**: ML-based resource requirement forecasting
- **Auto-Recovery**: Intelligent retry strategies based on failure types

### Community Requests
- **Windows Support**: Better Windows compatibility and testing
- **Docker Integration**: Containerized task execution
- **Plugin System**: Custom task executors and integrations
- **API Gateway**: REST API for non-MCP clients

---

## Version Timeline

| Version | Status | Focus |
|---------|--------|--------|
| v0.2.0 | ✅ **Released** | Autoscaling + Persistence |
| v0.2.1 | ✅ **Released** | Event-driven + Git Worktree + GitHub PR |
| v0.2.5 | 🚧 **Planning** | Worktree Safety Features |
| v0.3.0 | ✅ **Released** | Task Dependencies (DAG validation) |
| v0.3.1 | 📋 **Planned** | Task Dependencies Optimizations |
| v0.4.0 | 🔶 **Partial** | Task Scheduling ✅ + Task Resumption (Research) |
| v0.5.0 | 💭 **Research** | Distributed Processing |
| v0.6.0 | 💭 **Research** | Advanced Orchestration + Templates |
| v0.7.0 | 💭 **Research** | Monitoring + REST API + Multi-User |

---

## Contributing to the Roadmap

### How to Request Features
1. **Create Issue**: Use GitHub issues with feature request template
2. **Community Discussion**: Discuss in GitHub Discussions
3. **Use Cases**: Provide concrete examples of how you'd use the feature
4. **Priority**: Help us understand the business impact

### How Features are Prioritized
1. **User Demand**: Number of requests and +1s
2. **Technical Complexity**: Development effort required
3. **Strategic Value**: Alignment with long-term vision
4. **Resource Availability**: Current development capacity

### Contribution Opportunities
- **Documentation**: Improve guides and examples
- **Testing**: Add test cases and integration tests
- **Bug Fixes**: Address issues in current version
- **Research**: Investigate new technologies and patterns

---

## Success Metrics

### v0.3.0 Success Criteria ✅
- [x] DAG validation with cycle detection implemented
- [x] Event-driven dependency resolution working
- [x] Database persistence with proper indexes
- [x] Comprehensive test coverage (74 tests, 2,172 lines)
- [x] 572-line feature documentation created
- [x] PR merged to main branch
- [x] All pre-merge quality checks passed

### v0.3.1 Success Criteria
- [ ] Batch dependency resolution: 10× performance improvement measured
- [ ] JSDoc coverage 100% for all public APIs
- [ ] QueueHandler integration tests added
- [ ] Performance benchmarks integrated into CI
- [ ] Zero dependency deadlocks in production after 1 month
- [ ] Failed dependency behavior documented and tested

### v0.4.0 Success Criteria
- [ ] Task Resumption: Resume from checkpoint within 30 seconds
- [ ] Task Resumption: Fallback "retry with context" works in all cases
- [ ] Task Resumption: Checkpoint overhead < 5% of task runtime
- [x] Task Scheduling: Tasks execute within 1 minute of scheduled time
- [x] Task Scheduling: Recurring tasks repeat correctly
- [x] Task Scheduling: Missed runs handled per policy (skip/catchup/fail)
- [x] Task Scheduling: Concurrent execution prevention implemented
- [ ] Integration: Scheduled tasks can have dependencies

### v0.5.0 Success Criteria
- [ ] Support 5+ distributed servers
- [ ] Cross-server task delegation < 500ms latency
- [ ] 99.9% task completion rate across servers
- [ ] Automatic failover in < 30 seconds

### Long-term Success (v1.0)
- [ ] 1000+ active users
- [ ] 99.99% uptime in production
- [ ] Sub-community of power users
- [ ] Integration with major development tools

---

## Recent Updates

**Latest Changes**:
- ✅ v0.4.0 Task Scheduling **IMPLEMENTED** - cron, one-time, pause/resume, missed run policies
- ✅ v0.3.0 Task Dependencies **RELEASED** and merged to main
- 📋 Added v0.3.1 Task Dependencies Optimizations (10 GitHub issues created: #10-#19)
- 🎯 Updated success criteria - all v0.3.0 criteria met, v0.4.0 scheduling criteria met
- 📊 Final metrics: 975 lines core code, 2,172 lines tests (82% coverage), 572-line docs
- 🔄 Consolidated planned features from docs/plans/core-features-v0.4.0.md
- 💭 **Task Resumption** remains in research phase (pending Claude API session continuation investigation)
- 🔀 Reorganized roadmap: v0.4.0 Resumption+Scheduling, v0.5.0 Distributed, v0.6.0 Orchestration, v0.7.0 Monitoring

For questions about the roadmap, please open a [GitHub Discussion](https://github.com/dean0x/claudine/discussions).