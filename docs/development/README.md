# Development Documentation

## Overview
This directory contains all development planning and execution documents for Claudine's implementation. These documents guide us from concept to shipping a thin vertical MVP in 2 weeks.

## Document Structure

### Planning Documents (Read in Order)

1. **[01-tech-stack.md](./01-tech-stack.md)** - Technology decisions and rationale
   - TypeScript chosen over Python
   - Minimal dependencies for MVP
   - Simple architecture decisions

2. **[02-mvp-scope.md](./02-mvp-scope.md)** - MVP definition and painful workflow
   - Single task delegation focus
   - User story and success criteria
   - What we're NOT building

3. **[03-development-roadmap.md](./03-development-roadmap.md)** - Phased development plan
   - 5 phases from MVP to production
   - Go/no-go decision points
   - Resource requirements

4. **[04-phase1-epics.md](./04-phase1-epics.md)** - Detailed Phase 1 breakdown
   - 6 epics with user stories
   - Task decomposition (FOUND, EXEC, MON, CTRL, INT, DOC)
   - Dependencies and sizing

5. **[05-sprint-planning.md](./05-sprint-planning.md)** - Sprint execution templates
   - Day-by-day plan for 2 weeks
   - Sprint 1.1 (Days 1-5): Foundation & Core
   - Sprint 1.2 (Days 6-10): Control & Polish

6. **[06-success-metrics.md](./06-success-metrics.md)** - KPIs and measurement
   - North Star: 30% retention rate
   - Business, Product, and System metrics
   - Implementation and tracking plan

7. **[07-task-tracker.md](./07-task-tracker.md)** - Current sprint task tracking
   - Live task status
   - Blockers and notes
   - Daily progress

## Quick Start Guide

### For Project Managers
1. Read [02-mvp-scope.md](./02-mvp-scope.md) for what we're building
2. Check [03-development-roadmap.md](./03-development-roadmap.md) for timeline
3. Monitor [07-task-tracker.md](./07-task-tracker.md) for daily progress

### For Developers
1. Review [01-tech-stack.md](./01-tech-stack.md) for technical setup
2. Study [04-phase1-epics.md](./04-phase1-epics.md) for task details
3. Follow [05-sprint-planning.md](./05-sprint-planning.md) day-by-day

### For Stakeholders
1. Focus on [02-mvp-scope.md](./02-mvp-scope.md) for value proposition
2. Review [06-success-metrics.md](./06-success-metrics.md) for success criteria
3. Track progress in [07-task-tracker.md](./07-task-tracker.md)

## Key Decisions Made

### Scope Decisions
- **MVP Focus**: Single task delegation only
- **No Queue**: One task at a time
- **No Persistence**: Tasks don't survive restart
- **Simple Tools**: Just 4 tools (Delegate, Status, Logs, Cancel)

### Technical Decisions  
- **Language**: TypeScript
- **Architecture**: Simple process pool
- **State**: In-memory with JSON backup
- **Integration**: Direct Claude Desktop via MCP

### Timeline Decisions
- **Phase 1**: 2 weeks to MVP
- **Sprint Length**: 5 days each
- **Daily Commitment**: 8 hours/day
- **Buffer**: 20% for unknowns

## Success Criteria

### MVP Success (End of Phase 1)
✅ Ships in 2 weeks  
✅ 5 users try it  
✅ 30% retention rate  
✅ Core workflow functional  

### Phase 1 Deliverables
1. Working MCP server
2. Four functional tools
3. Claude Desktop integration
4. Basic documentation
5. 5 early users onboarded

## Current Status

**Phase**: 1 (MVP)  
**Sprint**: Planning Complete  
**Next Step**: Begin Sprint 1.1 implementation  

## Development Workflow

### Daily Routine
1. Check [07-task-tracker.md](./07-task-tracker.md)
2. Update task status
3. Work on assigned tasks
4. Update progress notes
5. Flag blockers immediately

### Sprint Routine
1. Monday: Sprint planning
2. Daily: Standup (self)
3. Friday: Demo & retrospective
4. Update metrics dashboard

### Communication
- **Progress**: Update task tracker daily
- **Blockers**: Document immediately
- **Decisions**: Record in relevant doc
- **Metrics**: Track in metrics file

## Risk Management

### Top Risks (Phase 1)
1. **Technical**: Claude Code spawn issues
2. **Timeline**: 2-week deadline aggressive
3. **Adoption**: Users might not see value
4. **Quality**: Rushing might cause bugs

### Mitigations
1. Test spawning Day 3
2. Scope brutally minimal
3. Validate with users first
4. Automated testing from Day 7

## File Organization

```
docs/development/
├── README.md               # This file
├── 01-tech-stack.md        # Technology decisions
├── 02-mvp-scope.md         # MVP definition
├── 03-development-roadmap.md # Phased plan
├── 04-phase1-epics.md      # Epic breakdown
├── 05-sprint-planning.md   # Sprint details
├── 06-success-metrics.md   # KPIs
└── 07-task-tracker.md      # Live tracking
```

## Next Actions

### Immediate (Before Development)
1. [ ] Validate MVP concept with 5 users
2. [ ] Setup development environment
3. [ ] Create GitHub repository
4. [ ] Initialize TypeScript project

### Sprint 1.1 Start
1. [ ] Begin FOUND-001 tasks
2. [ ] Setup daily tracking
3. [ ] Configure test environment
4. [ ] Start metrics collection

## Questions to Answer

Before starting:
1. Do we have Claude Code CLI access?
2. Is Claude Desktop configured?
3. Are 5 early users identified?
4. Is feedback channel ready?

## Appendix

### Terminology
- **Epic**: Large feature area (2-3 days)
- **Task**: Specific implementation (1-4 hours)
- **Sprint**: 5-day development cycle
- **Phase**: 2-week milestone

### Tools Naming (Final)
- `DelegateTask`: Spawn background task
- `TaskStatus`: Check task state
- `TaskLogs`: Retrieve output
- `CancelTask`: Stop execution

### Metrics to Track
- Retention rate (primary)
- Task success rate
- User satisfaction
- System reliability