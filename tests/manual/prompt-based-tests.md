# Prompt-Based Test Suite for Claude Code Integration

This test suite is designed to be executed within a running Claude Code instance by providing prompts that test Claudine's MCP integration.

## Prerequisites

1. Claude Code is running and connected to Claudine MCP server
2. Claudine MCP server is configured in `~/.config/claude/mcp_servers.json`:

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

## Test Prompts

Execute these prompts one by one in Claude Code to test Claudine functionality:

### 1. Basic Task Delegation

```
Test Claudine by delegating a simple task. Use the DelegateTask tool to run: echo "Hello from Claudine task delegation test"
```

**Expected Result:**
- Task should be successfully delegated
- Should receive a task ID
- Task should execute and complete
- Output should contain "Hello from Claudine task delegation test"

### 2. Task Status Monitoring

```
After delegating the previous task, use the TaskStatus tool to check its status. Also use ListTasks to see all current tasks.
```

**Expected Result:**
- TaskStatus should return current status (pending/running/completed)
- ListTasks should show the delegated task in the list
- Task details should include creation time, status, and configuration

### 3. Priority-Based Task Management

```
Test task priorities by delegating three tasks with different priorities:
1. High priority (P0): echo "High priority task"
2. Medium priority (P1): echo "Medium priority task"
3. Low priority (P2): echo "Low priority task"

Use DelegateTask with different priority values and observe execution order.
```

**Expected Result:**
- Tasks should be executed in priority order (P0 first, then P1, then P2)
- Higher priority tasks should start before lower priority ones

### 4. Task Output Retrieval

```
Delegate a task that produces substantial output: ls -la /workspace && echo "Directory listing complete"

Then use TaskLogs to retrieve the complete output.
```

**Expected Result:**
- Task should execute successfully
- TaskLogs should return complete stdout output including directory listing
- Output should be properly formatted and include the echo message

### 5. Task Cancellation

```
Delegate a long-running task: sleep 30 && echo "This should be cancelled"

Immediately after delegation, use CancelTask to cancel it before it completes.
```

**Expected Result:**
- Task should be successfully delegated
- CancelTask should successfully cancel the running task
- Task status should change to 'cancelled'
- The echo message should not appear in logs

### 6. Error Handling

```
Test error handling by delegating a task that will fail: non_existent_command --invalid-flag

Then check the task status and logs to see how errors are handled.
```

**Expected Result:**
- Task should be delegated successfully
- Task should fail during execution
- Task status should show 'failed'
- Error output should be captured in stderr logs

### 7. Concurrent Task Execution

```
Test concurrent execution by delegating 5 tasks simultaneously:
1. echo "Task 1" && sleep 2
2. echo "Task 2" && sleep 2
3. echo "Task 3" && sleep 2
4. echo "Task 4" && sleep 2
5. echo "Task 5" && sleep 2

Monitor execution with ListTasks and observe parallel processing.
```

**Expected Result:**
- All tasks should be delegated successfully
- Multiple tasks should run concurrently (not sequentially)
- Each task should complete in approximately 2 seconds
- All tasks should complete within 3-4 seconds total (not 10 seconds)

### 8. Task Configuration Options

```
Test custom task configuration by delegating a task with specific options:
- Custom timeout: 5000ms
- Custom working directory: /tmp
- Custom output buffer size: 1048576 bytes

Task: pwd && echo "Working directory test"
```

**Expected Result:**
- Task should execute in the specified working directory (/tmp)
- Output should show "/tmp" from pwd command
- Task should respect timeout and buffer settings

### 9. Task Metrics and Health

```
Use the TaskMetrics and SystemHealth tools to check Claudine's current performance:
1. Get overall task metrics
2. Check system health and resource usage
3. Verify worker pool status
```

**Expected Result:**
- TaskMetrics should show task counts, success rates, average execution times
- SystemHealth should report CPU, memory usage, and worker status
- All metrics should be within reasonable ranges

### 10. Complex Task with File Operations

```
Test file I/O capabilities by delegating a complex task:
echo "Test content" > /tmp/claudine-test.txt && cat /tmp/claudine-test.txt && rm /tmp/claudine-test.txt && echo "File operations complete"

Verify complete execution through TaskLogs.
```

**Expected Result:**
- Task should execute all file operations successfully
- Output should show "Test content" from cat command
- Final echo should confirm completion
- No error should occur during file cleanup

## Validation Checklist

After running all test prompts, verify:

- [ ] All basic tasks execute successfully
- [ ] Task priorities are respected
- [ ] Task status updates correctly throughout lifecycle
- [ ] Output capture works for both stdout and stderr
- [ ] Task cancellation works properly
- [ ] Error handling captures and reports failures
- [ ] Concurrent execution works without conflicts
- [ ] Custom configuration options are applied
- [ ] System metrics are reported accurately
- [ ] Complex multi-step tasks execute completely

## Troubleshooting

If tests fail:

1. **MCP Connection Issues:**
   - Verify Claude Code is connected to Claudine MCP server
   - Check MCP server configuration in Claude Code settings
   - Restart Claude Code if necessary

2. **Task Execution Failures:**
   - Check Claudine server logs for errors
   - Verify Claudine has necessary permissions
   - Ensure sufficient system resources

3. **Output Capture Problems:**
   - Check task timeout settings
   - Verify output buffer sizes
   - Look for process spawning issues

4. **Resource Constraints:**
   - Check system CPU and memory usage
   - Verify worker pool is not exhausted
   - Monitor for hanging processes

## Performance Benchmarks

Expected performance ranges:

- **Task Delegation:** < 100ms response time
- **Simple Task Execution:** < 1000ms total time
- **Task Status Queries:** < 50ms response time
- **Output Retrieval:** < 200ms for typical output
- **Concurrent Tasks:** Up to 4 tasks in parallel (based on system resources)

## Integration Health Indicators

Green: ✅ All tests pass with expected performance
Yellow: ⚠️ Some tests pass but with degraded performance
Red: ❌ Test failures or significant performance issues

Document any issues found and their severity for debugging and improvement.