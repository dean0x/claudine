# Guide: Writing Effective "Notes to Future Self"

## Purpose
"Notes to Future Self" documents serve as a bridge between work sessions, preserving critical context, decisions, and technical details that would otherwise be lost. They enable smooth continuation of work after breaks and help others understand the project state.

## When to Write These Notes
- At the end of a significant work session
- Before taking a break longer than a day
- After completing a major milestone
- When solving complex problems
- After making architectural decisions
- When leaving work in an incomplete state

## Document Structure

### 1. Header Section
```markdown
# Notes to Future Self - [Project Name] [Specific Context]

**Last Session Date**: [Date]  
**Session Context**: [Brief description of what was worked on]
```

### 2. 🎯 Where We Left Off
Document the immediate state with two subsections:

#### Just Completed
- List specific tasks/fixes completed in this session
- Include task/ticket numbers if applicable
- Note any major accomplishments

#### Current State
- Use checkmarks (✅) for completed items
- Use clipboard (📋) for pending items
- Provide a snapshot of overall project health

### 3. 🔧 Critical Technical Context
This is the most important section. Include:

#### Recent Architecture Changes
- Major refactoring completed
- Pattern changes (e.g., direct usage to dependency injection)
- Breaking changes that affect other parts

#### Key Fix Patterns Applied
- Include code snippets of important fixes
- Explain WHY the fix was needed
- Show before/after if helpful

#### Infrastructure Changes
- Build system updates
- Test framework changes
- Deployment configuration
- Development environment setup

### 4. 📝 Immediate Next Tasks
Prioritize and categorize:

```markdown
### 1. [Task Name] 🔴 HIGH PRIORITY
[Description and specific steps]

### 2. [Task Name] 🟡 MEDIUM PRIORITY
[Description and specific steps]

### 3. [Task Name] 🟢 LOW PRIORITY
[Description and specific steps]
```

Include:
- Specific commands to run
- Files to focus on
- Known issues to address
- Expected outcomes

### 5. 🚨 Important Gotchas & Patterns
Document tricky aspects:

#### Common Pitfalls
- Things that broke during development
- Non-obvious requirements
- Order dependencies
- Configuration quirks

#### Established Patterns
- Code patterns that must be followed
- Naming conventions
- Architecture decisions
- Testing approaches

### 6. 🔍 Quick Reference Commands
Provide copy-paste ready commands:

```bash
# Essential commands with descriptions
pnpm test              # Run all tests
pnpm test [file]       # Run specific test
pnpm build            # Build project
pnpm dev              # Development mode
```

### 7. 📁 Key Files to Remember
Organize by purpose:

```markdown
### Core Implementation
- `/path/to/file` - Description of what it does

### Test Files
- `/path/to/test` - What it tests

### Configuration
- `/path/to/config` - What it configures
```

### 8. 🎯 Strategic Approach for Next Session
Provide a roadmap:

1. **First Priority** - What to tackle immediately
2. **Second Priority** - What comes next
3. **Third Priority** - Nice to have

Include reasoning for the ordering.

### 9. 💡 Context for Decisions Made
Explain the "why" behind choices:

#### Why [Decision]?
- Business reason
- Technical reason
- Trade-offs considered
- Alternatives rejected and why

### 10. 🔮 Future Considerations
Think ahead:

#### After Current Tasks
- Natural next steps
- Feature ideas
- Optimization opportunities

#### Architecture Evolution
- Scalability considerations
- Potential refactoring
- Technical debt to address

### 11. 🛠️ Debugging Tips
Preemptive troubleshooting:

#### If [Common Issue]
1. First thing to check
2. Second thing to check
3. Common fix

### 12. 📌 Final Reminders
Project-specific reminders:
- Tool preferences (e.g., pnpm vs npm)
- Style guides
- Team conventions
- Important constraints

## Best Practices

### DO:
- **Be specific**: Include exact file paths, function names, line numbers
- **Show code**: Include snippets for complex fixes or patterns
- **Explain why**: Context is more valuable than what
- **Use examples**: Concrete examples beat abstract descriptions
- **Think chronologically**: What would you want to know when returning?
- **Include commands**: Make it easy to get started again
- **Document surprises**: Anything non-obvious or unexpected
- **Add visual markers**: Use emojis/icons for quick scanning

### DON'T:
- **Be vague**: "Fixed some tests" → "Fixed storage service validation in job status transitions"
- **Skip context**: "Changed the pattern" → "Changed from direct service usage to Effect's Layer pattern because..."
- **Assume memory**: Document even "obvious" things
- **Overload sections**: Keep each section focused
- **Use jargon without explanation**: Define project-specific terms

## Examples of Good vs Bad Notes

### ❌ Bad:
"Fixed the bug in storage. Tests pass now. Work on TypeScript next."

### ✅ Good:
"Fixed storage service validation bug where job status transitions were not being validated, causing invalid state transitions (e.g., completed → running). Added validation rules in `/src/storage/service.ts:234` using an invalidTransitions map. This fixed 12 failing tests. All 123 tests now pass."

### ❌ Bad:
"Remember to update the config"

### ✅ Good:
"Update `/src/config/schema.ts` to add the new `retryPolicy` field to TaskConfigSchema. This is needed for Task 17 (retry mechanism). Example:
```typescript
retryPolicy: z.object({
  maxAttempts: z.number().min(1).max(10),
  backoffMs: z.number().min(100)
}).optional()
```"

## Template

```markdown
# Notes to Future Self - [Project] [Context]

**Last Session Date**: [Date]  
**Session Context**: [What was worked on]

## 🎯 Where We Left Off

### Just Completed
- [Specific accomplishment]

### Current State
- ✅ [Completed item]
- 📋 [Pending item]

## 🔧 Critical Technical Context

### Recent [Changes/Fixes/Updates]
[Details with code examples]

## 📝 Immediate Next Tasks

### 1. [Task] 🔴 HIGH PRIORITY
[Steps and details]

## 🚨 Important Gotchas & Patterns

### [Pattern/Gotcha Name]
[Explanation with examples]

## 🔍 Quick Reference Commands

```bash
# [Command description]
[command]
```

## 📁 Key Files to Remember

### [Category]
- `[file path]` - [description]

## 🎯 Strategic Approach for Next Session

1. [First step with reasoning]

## 💡 Context for Decisions Made

### Why [Decision]?
[Reasoning]

## 🔮 Future Considerations

### After Current Tasks
- [Future work]

## 🛠️ Debugging Tips

### If [Issue]
1. [Solution step]

## 📌 Final Reminders
- [Project-specific reminder]
```

## Status Update File Organization

To maintain consistency across status updates, follow these conventions:

### Directory Structure
```
docs/
└── status/
    ├── YYYY-MM-DD/                    # Date-based directories
    │   ├── notes-to-future-self.md    # Personal continuation notes
    │   ├── project-status-summary.md  # Formal project status
    │   └── [specific-feature].md      # Feature-specific updates
    └── guides/
        └── writing-notes-to-future-self.md  # This guide
```

### File Naming Conventions

1. **Date Directories**: Use `YYYY-MM-DD` format (e.g., `2025-08-01`)
2. **Standard Files**:
   - `notes-to-future-self.md` - Personal technical notes for continuation
   - `project-status-summary.md` - Formal project status report
   - Feature-specific files use kebab-case (e.g., `claude-cli-integration-fix.md`)

### Content Standards by File Type

#### notes-to-future-self.md
- Personal and technical focus
- Informal tone acceptable
- Heavy on code snippets and commands
- Forward-looking (what to do next)
- Includes gotchas and debugging tips

#### project-status-summary.md
- Professional and comprehensive
- Metrics-driven (tasks completed, tests passing)
- Executive summary format
- Progress tracking
- Risk assessment
- Suitable for stakeholders

#### Feature-specific updates (e.g., bug-fix-name.md)
- Focused on single feature/fix
- Problem → Solution format
- Technical decisions documented
- Includes:
  - Executive Summary
  - Problem Statement
  - Solution Details
  - Files Modified
  - Testing Results
  - Next Steps

### Consistency Checklist

When creating status updates, ensure:

- [ ] Date directory follows YYYY-MM-DD format
- [ ] File names use correct conventions
- [ ] Each file type contains appropriate content
- [ ] Cross-references use relative paths
- [ ] Code snippets include file paths and line numbers
- [ ] Metrics are consistent with previous reports
- [ ] Task numbering continues from previous updates

### Example Status Update Creation

```bash
# Create new status update directory
mkdir -p docs/status/2025-08-15

# Create standard files
touch docs/status/2025-08-15/notes-to-future-self.md
touch docs/status/2025-08-15/project-status-summary.md

# For specific features/fixes
touch docs/status/2025-08-15/authentication-refactor.md
```

## Final Tips

1. **Be your own technical writer**: Explain as if to a colleague
2. **Include emotional context**: "This was tricky because..." helps future you understand difficulty
3. **Update as you go**: Don't let notes become stale
4. **Review before starting**: Always read your last notes before resuming work
5. **Maintain file consistency**: Follow the organization standards above

Remember: Your future self (or teammate) will thank you for every bit of context you provide today!