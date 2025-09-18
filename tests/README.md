# Claudine Test Suite

This directory contains comprehensive tests for Claudine's task delegation system.

## Test Structure

```
tests/
├── unit/                    # Unit tests for individual components
│   ├── pipe.test.ts         # Functional composition utilities
│   ├── result.test.ts       # Result type and error handling
│   ├── event-bus.test.ts    # Event bus implementation
│   ├── autoscaling-manager.test.ts # Autoscaling logic
│   ├── mcp-adapter.test.ts  # MCP adapter
│   └── event-handlers.test.ts # Event handlers
├── integration/             # Integration tests
│   ├── task-delegation-simple.test.ts # Safe delegation tests
│   ├── worker-pool.test.ts  # Worker pool management (existing)
│   └── recovery.test.ts     # Task recovery (existing)
├── e2e/                     # End-to-end tests
│   └── claude-code-integration.test.ts # CLI-based E2E tests
└── manual/                  # Manual testing procedures
    └── prompt-based-tests.md # Claude Code integration tests
```

## Running Tests

### Unit Tests
```bash
npm test tests/unit/
```

### Integration Tests
```bash
npm test tests/integration/
```

### End-to-End Tests (requires built CLI)
```bash
npm run build
E2E_TESTS=true npm test tests/e2e/
```

### All Tests
```bash
npm test
```

## Test Categories

### 1. Unit Tests
- **Focus**: Individual components in isolation
- **Mocking**: Heavy use of mocks and test doubles
- **Speed**: Fast execution (< 5 seconds total)
- **Coverage**: Core utilities, business logic, individual services

### 2. Integration Tests
- **Focus**: Component interactions and workflows
- **Mocking**: Minimal mocking, uses test implementations
- **Speed**: Medium execution (< 30 seconds total)
- **Coverage**: Event flows, service coordination, data persistence

### 3. End-to-End Tests
- **Focus**: Complete system functionality via CLI
- **Mocking**: No mocking, uses real implementations
- **Speed**: Slower execution (may take minutes)
- **Coverage**: Full user workflows, CLI interface, MCP integration

### 4. Manual Tests
- **Focus**: Real Claude Code integration
- **Execution**: Human-driven testing within Claude Code
- **Purpose**: Validate MCP tools and real-world usage patterns

## Test Environment Safety

### Resource Management
Our tests are designed to avoid impacting the host system:

- **No Real Process Spawning**: Integration tests use mock process spawners
- **Isolated Databases**: Each test uses temporary SQLite files
- **Resource Monitoring**: Test resource monitors with configurable thresholds
- **Cleanup**: Automatic cleanup of test artifacts after each test

### Worktree Management
The system creates git worktrees for task isolation. Tests ensure:

- **Cleanup**: Automatic removal of test worktrees
- **Isolation**: Test worktrees in separate directories
- **Monitoring**: Prevention of worktree accumulation

## Manual Testing with Claude Code

For real-world validation, use the prompt-based tests:

1. **Setup**: Configure Claudine as an MCP server in Claude Code
2. **Execute**: Run prompts from `tests/manual/prompt-based-tests.md`
3. **Validate**: Verify expected behaviors and performance

### MCP Configuration
Add to `~/.config/claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "claudine": {
      "command": "claudine",
      "args": ["mcp", "start"]
    }
  }
}
```

## Performance Benchmarks

### Unit Tests
- **Target**: < 5 seconds total execution
- **Individual**: < 100ms per test
- **Concurrency**: All tests in parallel

### Integration Tests
- **Target**: < 30 seconds total execution
- **Individual**: < 5 seconds per test
- **Resource Usage**: Minimal system impact

### E2E Tests
- **Target**: < 5 minutes total execution
- **Individual**: < 30 seconds per test
- **System Integration**: Full CLI and MCP validation

## Test Data Management

### Temporary Files
Tests create temporary artifacts:
- **Databases**: `test-db/test-{timestamp}.db`
- **Output**: `test-output/`
- **Worktrees**: `.claudine-worktrees/test-*`

### Cleanup Strategy
- **Automatic**: `afterEach` hooks clean up test artifacts
- **Manual**: `npm run clean:test` removes all test artifacts
- **CI**: GitHub Actions includes cleanup steps

## Debugging Tests

### Verbose Output
```bash
npm test -- --reporter=verbose
```

### Specific Test Files
```bash
npm test tests/unit/pipe.test.ts
```

### Debug Mode
```bash
DEBUG=claudine:* npm test
```

### Test Coverage
```bash
npm run test:coverage
```

## Common Issues

### 1. Hanging Tests
**Cause**: Real process spawning or resource cleanup issues
**Solution**: Check for proper mocking and cleanup in `afterEach`

### 2. Resource Exhaustion
**Cause**: Accumulated worktrees or database locks
**Solution**: Run cleanup commands and restart tests

### 3. Flaky Tests
**Cause**: Race conditions in async operations
**Solution**: Add proper `await` statements and event synchronization

### 4. MCP Integration Failures
**Cause**: Claude Code not configured or not running
**Solution**: Follow MCP setup instructions and verify connection

## Contributing

When adding new tests:

1. **Follow Patterns**: Use existing test structure and naming
2. **Proper Cleanup**: Always clean up resources in `afterEach`
3. **Isolated Tests**: Each test should run independently
4. **Clear Assertions**: Use descriptive expect statements
5. **Performance**: Keep tests fast and focused

### Test Naming Convention
- **Unit**: `{component}.test.ts`
- **Integration**: `{workflow}-integration.test.ts`
- **E2E**: `{feature}-e2e.test.ts`

### Mock Strategy
- **Unit**: Mock all external dependencies
- **Integration**: Mock only I/O boundaries (file system, network)
- **E2E**: No mocking, use real implementations