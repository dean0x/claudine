# Claudine Use Cases

## Example 1: Parallel API and Test Updates

**Scenario**: You're refactoring an API and need to update tests simultaneously.

**Main Claude Session**:
```
I'm refactoring the user authentication API endpoints...
```

**Delegated Task**:
```
Use DelegateTask: "Update all test files in tests/api/ to match the new authentication endpoint structure. The new endpoints are: POST /auth/login, POST /auth/logout, GET /auth/verify"
```

**Benefits**: 
- Continue working on API implementation
- Tests are updated in parallel
- No context switching needed

---

## Example 2: Documentation Generation

**Scenario**: Writing new features while documenting them.

**Main Claude Session**:
```
Implementing the new data export feature...
```

**Delegated Task**:
```
Use DelegateTask: "Generate comprehensive API documentation for the DataExportService class in src/services/export.ts. Include examples and parameter descriptions."
```

**Check Progress**:
```
Use TaskStatus to check documentation generation
Use TaskLogs to see the generated docs
```

---

## Example 3: Code Migration

**Scenario**: Migrating code patterns across the codebase.

**Delegated Task**:
```
Use DelegateTask: "Find all instances of the old Logger.log() pattern and update them to use the new structured logging with logger.info({ message, context })"
```

**Monitor**:
```
Use TaskStatus  # Check if migration is running
Use TaskLogs with tail: 50  # See recent changes
```

---

## Example 4: Dependency Updates

**Scenario**: Updating dependencies and fixing breaking changes.

**Main Claude Session**:
```
Updating the main application to use React 18...
```

**Delegated Task**:
```
Use DelegateTask: "Update all component tests to use the new React 18 testing utilities. Replace ReactDOM.render with createRoot pattern."
```

---

## Example 5: Performance Analysis

**Scenario**: Analyzing performance while fixing issues.

**Delegated Task**:
```
Use DelegateTask: "Run performance profiling on all API endpoints and create a report showing response times, memory usage, and bottlenecks"
```

**Later**:
```
Use TaskLogs to retrieve the performance report
```

---

## Example 6: Multi-file Refactoring

**Scenario**: Refactoring that touches many files.

**Main Claude Session**:
```
Refactoring the authentication module architecture...
```

**Delegated Task**:
```
Use DelegateTask: "Update all import statements in the frontend components from '@/auth/old' to '@/auth/new' and ensure no broken imports"
```

---

## Example 7: Test Suite Execution

**Scenario**: Running long test suites without blocking.

**Delegated Task**:
```
Use DelegateTask: "Run the full integration test suite and create a summary of any failures with their stack traces"
```

**Check Results**:
```
Use TaskStatus  # See if tests are done
Use TaskLogs with tail: 200  # Get test results
```

---

## Example 8: Code Generation

**Scenario**: Generating boilerplate code.

**Delegated Task**:
```
Use DelegateTask: "Generate CRUD endpoints for the Product model with full validation, error handling, and OpenAPI documentation"
```

---

## Example 9: Cleanup Tasks

**Scenario**: Cleaning up code while working on features.

**Delegated Task**:
```
Use DelegateTask: "Find and remove all unused imports, variables, and functions across the src/ directory"
```

**If Taking Too Long**:
```
Use CancelTask with reason: "Taking too long, will run overnight instead"
```

---

## Example 10: Build Verification

**Scenario**: Ensuring builds work while developing.

**Delegated Task**:
```
Use DelegateTask: "Run 'npm run build' and check for any TypeScript errors or build warnings. Summarize any issues found."
```

**Check Build Status**:
```
Use TaskStatus
Use TaskLogs  # See build output
```

---

## Best Practices

1. **Be Specific**: Give clear, detailed prompts to delegated tasks
2. **Check Status**: Periodically check TaskStatus for long-running tasks
3. **Review Logs**: Always review TaskLogs before integrating changes
4. **Cancel Stuck Tasks**: Use CancelTask if a task is taking too long
5. **One Task at a Time**: Remember MVP limitation - only one background task runs at a time

## Task Prompt Templates

### File Update Template
```
"Update all [file pattern] files to [specific change]. Ensure [validation criteria]."
```

### Analysis Template
```
"Analyze [scope] and create a report showing [metrics]. Focus on [specific areas]."
```

### Generation Template
```
"Generate [what] for [context] including [requirements]. Follow [patterns/style]."
```

### Migration Template
```
"Migrate all instances of [old pattern] to [new pattern] in [scope]. Preserve [functionality]."
```