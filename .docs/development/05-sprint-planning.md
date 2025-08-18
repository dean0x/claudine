# Sprint Planning Template

## Sprint Overview Template

**Sprint**: [Number]  
**Duration**: 5 days  
**Start Date**: [Date]  
**End Date**: [Date]  
**Sprint Goal**: [One sentence description]

---

## Sprint 1.1: Foundation & Core Execution

**Sprint**: 1.1  
**Duration**: Days 1-5  
**Sprint Goal**: Build working task delegation with output capture

### Day-by-Day Plan

#### Day 1 (Monday): Project Setup
**Morning (4h)**
- [ ] FOUND-001: Initialize TypeScript project (2h)
- [ ] FOUND-002: Setup MCP server scaffold (2h)

**Afternoon (4h)**
- [ ] FOUND-003: Define TypeScript types (1h)
- [ ] Manual testing: Server starts (1h)
- [ ] Setup development environment (2h)

**End of Day Checklist:**
- [ ] Project builds with `npm run dev`
- [ ] MCP server starts without errors
- [ ] Type definitions complete

#### Day 2 (Tuesday): MCP Integration
**Morning (4h)**
- [ ] Implement tool registration system (2h)
- [ ] Create DelegateTask schema (1h)
- [ ] Setup request routing (1h)

**Afternoon (4h)**
- [ ] Test with MCP Inspector (2h)
- [ ] Fix integration issues (1h)
- [ ] Document setup process (1h)

**End of Day Checklist:**
- [ ] MCP Inspector can connect
- [ ] Tool shows up in tool list
- [ ] Basic request/response working

#### Day 3 (Wednesday): Process Execution
**Morning (4h)**
- [ ] EXEC-001: Implement DelegateTask tool (2h)
- [ ] EXEC-002: Create process executor (2h)

**Afternoon (4h)**
- [ ] Test Claude Code spawning (2h)
- [ ] Debug process issues (1h)
- [ ] Implement task ID generation (1h)

**End of Day Checklist:**
- [ ] Can spawn Claude Code process
- [ ] Task ID returned to user
- [ ] Process runs to completion

#### Day 4 (Thursday): Output Capture
**Morning (4h)**
- [ ] EXEC-003: Implement output capture (2h)
- [ ] Handle stream encoding (1h)
- [ ] Buffer management (1h)

**Afternoon (4h)**
- [ ] MON-001: Implement TaskStatus tool (2h)
- [ ] MON-002: Implement TaskLogs tool (2h)

**End of Day Checklist:**
- [ ] Output captured from process
- [ ] Can retrieve task status
- [ ] Can retrieve task logs

#### Day 5 (Friday): State Management
**Morning (4h)**
- [ ] MON-003: Add task state management (2h)
- [ ] Memory cleanup logic (1h)
- [ ] Edge case handling (1h)

**Afternoon (4h)**
- [ ] Integration testing (2h)
- [ ] Bug fixes (1h)
- [ ] Sprint 1.1 demo prep (1h)

**End of Day Checklist:**
- [ ] Task lifecycle tracked properly
- [ ] No memory leaks
- [ ] Demo ready for stakeholders

### Sprint 1.1 Deliverables
1. Working MCP server
2. DelegateTask spawns Claude Code
3. TaskStatus returns state
4. TaskLogs returns output
5. Basic state management

### Sprint 1.1 Metrics
- [ ] 4 tools implemented
- [ ] 0 critical bugs
- [ ] All acceptance criteria met
- [ ] Ready for Sprint 1.2

---

## Sprint 1.2: Control & Polish

**Sprint**: 1.2  
**Duration**: Days 6-10  
**Sprint Goal**: Add task control, testing, and ship to early users

### Day-by-Day Plan

#### Day 6 (Monday): Task Control
**Morning (4h)**
- [ ] CTRL-001: Implement CancelTask tool (2h)
- [ ] CTRL-002: Handle process lifecycle (2h)

**Afternoon (4h)**
- [ ] Test cancellation scenarios (2h)
- [ ] Implement timeout (30 min default) (1h)
- [ ] Grace period logic (1h)

**End of Day Checklist:**
- [ ] Can cancel running tasks
- [ ] Processes terminate cleanly
- [ ] No zombie processes

#### Day 7 (Tuesday): Error Handling
**Morning (4h)**
- [ ] CTRL-003: Error handling (2h)
- [ ] Process crash detection (1h)
- [ ] Error message capture (1h)

**Afternoon (4h)**
- [ ] Test error scenarios (2h)
- [ ] Improve error messages (1h)
- [ ] Add logging (1h)

**End of Day Checklist:**
- [ ] Errors captured properly
- [ ] User-friendly error messages
- [ ] System recovers from crashes

#### Day 8 (Wednesday): Testing
**Morning (4h)**
- [ ] INT-002: Setup testing suite (1h)
- [ ] Write unit tests for tools (3h)

**Afternoon (4h)**
- [ ] Test process executor (2h)
- [ ] Test error cases (1h)
- [ ] Mock child_process (1h)

**End of Day Checklist:**
- [ ] Test suite running
- [ ] >80% code coverage
- [ ] All tests passing

#### Day 9 (Thursday): Integration
**Morning (4h)**
- [ ] INT-001: Claude Desktop integration (2h)
- [ ] Create configuration file (1h)
- [ ] Test all workflows (1h)

**Afternoon (4h)**
- [ ] INT-003: Test error scenarios (2h)
- [ ] Performance testing (1h)
- [ ] Fix integration bugs (1h)

**End of Day Checklist:**
- [ ] Works in Claude Desktop
- [ ] All tools functional
- [ ] Performance acceptable

#### Day 10 (Friday): Documentation & Ship
**Morning (4h)**
- [ ] DOC-001: Write README.md (2h)
- [ ] DOC-002: Create examples (2h)

**Afternoon (4h)**
- [ ] DOC-003: Release preparation (1h)
- [ ] Fresh install test (1h)
- [ ] Deploy to early users (1h)
- [ ] Sprint retrospective (1h)

**End of Day Checklist:**
- [ ] Documentation complete
- [ ] Examples working
- [ ] Deployed to users
- [ ] Feedback channel active

### Sprint 1.2 Deliverables
1. CancelTask functionality
2. Comprehensive error handling
3. Test suite with >80% coverage
4. Claude Desktop integration
5. Complete documentation
6. v0.1.0 release

### Sprint 1.2 Metrics
- [ ] All epics completed
- [ ] 0 critical bugs
- [ ] 5 early users onboarded
- [ ] Feedback mechanism active

---

## Sprint 2.1: Queue, Concurrency & CLI

**Sprint**: 2.1  
**Duration**: Days 11-15 (Week 3)  
**Sprint Goal**: Enable multi-task execution with CLI interface

### Day-by-Day Plan

#### Day 11 (Monday): Task Queue Implementation
**Morning (4h)**
- [ ] Design queue data structure (1h)
- [ ] Implement FIFO task queue (2h)
- [ ] Add queue management methods (1h)

**Afternoon (4h)**
- [ ] Integrate queue with TaskManager (2h)
- [ ] Update DelegateTask for queuing (1h)
- [ ] Test queue operations (1h)

**End of Day Checklist:**
- [ ] Queue accepts multiple tasks
- [ ] Tasks execute in order
- [ ] Queue state persists in memory

#### Day 12 (Tuesday): Concurrency Support
**Morning (4h)**
- [ ] Implement concurrent task limit (2h)
- [ ] Add resource pool management (2h)

**Afternoon (4h)**
- [ ] Update ProcessExecutor for parallel execution (2h)
- [ ] Test concurrent task execution (1h)
- [ ] Handle race conditions (1h)

**End of Day Checklist:**
- [ ] Can run 3-5 tasks concurrently
- [ ] Resource limits enforced
- [ ] No race conditions

#### Day 13 (Wednesday): CLI Interface
**Morning (4h)**
- [ ] CLI-001: Create CLI scaffold with commander.js (2h)
- [ ] CLI-002: Implement shared state management (2h)

**Afternoon (4h)**
- [ ] CLI-003: Implement core commands (delegate, status, logs, cancel) (2h)
- [ ] CLI-004: Add output formatting (table, json) (1h)
- [ ] CLI-005: Test CLI ↔ Core integration (1h)

**End of Day Checklist:**
- [ ] CLI commands working
- [ ] Shared state between CLI and MCP
- [ ] Formatted output displays correctly

#### Day 14 (Thursday): ListTasks & Polish
**Morning (4h)**
- [ ] Implement ListTasks MCP tool (2h)
- [ ] Add task history tracking (2h)

**Afternoon (4h)**
- [ ] Add resource monitoring (2h)
- [ ] Performance optimization (1h)
- [ ] Bug fixes from testing (1h)

**End of Day Checklist:**
- [ ] ListTasks shows all tasks
- [ ] History tracks last 10 tasks
- [ ] Performance acceptable

#### Day 15 (Friday): Testing & Integration
**Morning (4h)**
- [ ] Integration testing for queue (2h)
- [ ] CLI command testing (1h)
- [ ] Update documentation (1h)

**Afternoon (4h)**
- [ ] End-to-end testing (2h)
- [ ] Performance benchmarking (1h)
- [ ] Sprint retrospective (1h)

**End of Day Checklist:**
- [ ] All Phase 2 features working
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Ready for user testing

### Sprint 2.1 Deliverables
1. Task queue with FIFO processing
2. Support for 3-5 concurrent tasks
3. CLI interface with core commands
4. ListTasks tool
5. Task history (last 10)
6. Updated documentation

### Sprint 2.1 Metrics
- [ ] Queue handles 10+ tasks
- [ ] 3-5 tasks run concurrently
- [ ] CLI response time < 100ms
- [ ] No state conflicts

---

## Daily Standup Template

**Date**: [Date]  
**Day**: [X of 10]

### Yesterday
- Completed: [What was finished]
- Blockers: [Any issues encountered]

### Today
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

### Blockers
- [Current blockers if any]

### Notes
- [Any important observations]

---

## Sprint Velocity Tracking

### Task Estimation
| Task Size | Story Points | Hours |
|-----------|-------------|-------|
| XS | 1 | <1h |
| S | 2 | 1-2h |
| M | 3 | 2-4h |
| L | 5 | 4-8h |
| XL | 8 | 8h+ |

### Sprint 1.1 Capacity
- **Total Days**: 5
- **Hours per Day**: 8
- **Total Hours**: 40
- **Buffer (20%)**: 8 hours
- **Effective Hours**: 32

### Sprint 1.2 Capacity
- **Total Days**: 5
- **Hours per Day**: 8
- **Total Hours**: 40
- **Buffer (20%)**: 8 hours
- **Effective Hours**: 32

---

## Risk Register (Per Sprint)

### Sprint 1.1 Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP SDK issues | High | Have workaround ready |
| Process spawn fails | High | Test on Day 3 |
| Output capture complex | Medium | Allocate extra time |

### Sprint 1.2 Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Desktop incompatible | High | Test early on Day 8 |
| Testing takes longer | Medium | Start on Day 7 |
| Documentation unclear | Low | Get feedback Day 10 |

---

## Definition of Ready (Task Level)

Before starting a task:
- [ ] Clear acceptance criteria
- [ ] Dependencies identified
- [ ] Estimated (story points)
- [ ] Technical approach defined

## Definition of Done (Task Level)

Task is complete when:
- [ ] Code implemented
- [ ] Self-reviewed
- [ ] Tests written (if applicable)
- [ ] No TypeScript errors
- [ ] Documented (if API)

## Definition of Done (Sprint Level)

Sprint is complete when:
- [ ] All planned tasks done
- [ ] Sprint goal achieved
- [ ] Code committed to main
- [ ] Demo prepared
- [ ] Retrospective held

---

## Sprint Retrospective Template

### What Went Well
- [Positive item 1]
- [Positive item 2]

### What Could Be Improved
- [Improvement 1]
- [Improvement 2]

### Action Items
- [ ] [Specific action with owner]
- [ ] [Specific action with owner]

### Velocity Actual vs Planned
- **Planned**: X story points
- **Completed**: Y story points
- **Velocity**: Y/X * 100%

---

## Success Criteria Tracking

### Sprint 1.1 Success Metrics
- [ ] MCP server running
- [ ] Can delegate tasks
- [ ] Can retrieve output
- [ ] No critical bugs

### Sprint 1.2 Success Metrics  
- [ ] All tools working
- [ ] Tests passing
- [ ] Documentation complete
- [ ] Users can self-install

### Phase 1 Success Metrics
- [ ] Shipped in 10 days
- [ ] 5 users tried it
- [ ] Core workflow functional
- [ ] Retention signal measurable