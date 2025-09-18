# Claudine Integration Test Scenarios

## Test Execution Instructions

This document defines test scenarios for Claudine that should be executed by a Claude Code instance.

### How to Run:
1. A Claude Code instance reads this document
2. Executes each scenario via CLI first
3. Records results in TEST_RESULTS.json
4. Re-runs same scenarios via MCP
5. Compares CLI vs MCP results

### Test Runner Requirements:
- Must have `claudine` CLI available
- Must have MCP server configuration
- Must be able to spawn real Claude Code processes
- Must have write access to TEST_RESULTS.json

## Test Scenarios

| ID | Category | Test Name | Priority | CLI Command | Expected Behavior | Validation |
|----|----------|-----------|----------|-------------|-------------------|------------|
| T001 | Basic | Echo Test | P0 | `claudine delegate "echo 'Hello World'"` | Task completes successfully | - Exit code: 0<br>- Output contains "Hello World"<br>- Task status: COMPLETED |
| T002 | Basic | Simple Calculation | P0 | `claudine delegate "python3 -c 'print(2+2)'"` | Executes Python calculation | - Output contains "4"<br>- Task status: COMPLETED |
| T003 | Error | Invalid Command | P0 | `claudine delegate "nonexistentcommand123"` | Task fails gracefully | - Task status: FAILED<br>- Error logged<br>- No system crash |
| T004 | Timeout | Long Running Task | P1 | `claudine delegate "sleep 65" --timeout 60000` | Task times out after 60s | - Task status: TIMEOUT<br>- Duration ~60 seconds<br>- Worker killed |
| T005 | Priority | Priority Ordering | P0 | See multi-command sequence | P0 tasks execute before P1/P2 | - P0 tasks complete first<br>- Queue ordering maintained |
| T006 | Concurrent | Parallel Tasks | P1 | Submit 5 tasks rapidly | Multiple workers spawn | - Multiple workers active<br>- Tasks complete concurrently |
| T007 | File | File Creation | P1 | `claudine delegate "echo 'test' > /tmp/claudine_test.txt"` | Creates file successfully | - File exists at path<br>- Content matches |
| T008 | Complex | Multi-step Task | P1 | `claudine delegate "cd /tmp && ls -la && pwd"` | Executes multiple commands | - All commands execute<br>- Output from each command |
| T009 | Recovery | Task Retry | P2 | Force failure then retry | Task retries on failure | - Attempts increment<br>- Eventually succeeds or max retries |
| T010 | Cancel | Task Cancellation | P1 | Start long task, then cancel | Task cancels cleanly | - Status: CANCELLED<br>- Worker terminated<br>- Resources cleaned |

## Multi-Command Test Sequences

### Priority Ordering Test (T005)
```bash
# Submit tasks with different priorities
claudine delegate "echo 'P2 task'" --priority P2 &
claudine delegate "echo 'P0 task'" --priority P0 &
claudine delegate "echo 'P1 task'" --priority P1 &
sleep 2
claudine status

# Expected: P0 completes first, then P1, then P2
```

### Concurrent Tasks Test (T006)
```bash
# Submit multiple tasks rapidly
for i in {1..5}; do
  claudine delegate "sleep 2 && echo 'Task $i complete'" &
done
sleep 1
claudine status

# Expected: Multiple workers shown as RUNNING
```

### Task Cancellation Test (T010)
```bash
# Start a long-running task
TASK_ID=$(claudine delegate "sleep 300" | grep -oP 'task-[\w-]+')
sleep 2
claudine cancel $TASK_ID "Test cancellation"
claudine status $TASK_ID

# Expected: Status changes to CANCELLED
```

## Validation Criteria

Each test must validate:
1. **Exit Code**: Command returns expected code
2. **Task Status**: Final status matches expected
3. **Output**: Logs contain expected content
4. **Timing**: Operations complete within expected timeframe
5. **Resources**: No resource leaks, workers cleaned up

## Test Result Schema

Results should be recorded in `TEST_RESULTS.json`:

```json
{
  "testRun": {
    "id": "run-<timestamp>",
    "startTime": "2024-01-15T10:00:00Z",
    "endTime": "2024-01-15T10:15:00Z",
    "environment": "cli|mcp"
  },
  "scenarios": [
    {
      "id": "T001",
      "name": "Echo Test",
      "status": "PASSED|FAILED",
      "executionTime": 1234,
      "cliResult": {
        "passed": true,
        "taskId": "task-xxx",
        "exitCode": 0,
        "output": "...",
        "errors": []
      },
      "mcpResult": {
        "passed": true,
        "taskId": "task-yyy",
        "response": {},
        "errors": []
      },
      "validation": {
        "exitCode": "✓",
        "output": "✓",
        "status": "✓",
        "timing": "✓"
      }
    }
  ],
  "summary": {
    "totalTests": 10,
    "passed": 8,
    "failed": 2,
    "cliPassRate": 0.8,
    "mcpPassRate": 0.8
  }
}
```

## Notes for Test Runner

1. **Clean State**: Each test should start with clean state
2. **Timeouts**: Apply reasonable timeouts to prevent hanging
3. **Logging**: Capture all logs for debugging failures
4. **Idempotency**: Tests should be repeatable
5. **Resource Cleanup**: Ensure all workers/files cleaned up

## Test Frequency

- **On Commit**: Run T001-T004 (basic tests)
- **Hourly**: Run T001-T008 (most tests)
- **Daily**: Run all tests including stress tests
- **Before Release**: Full suite multiple times

## Known Issues / Skip List

| Test ID | Skip Reason | Date Added |
|---------|-------------|------------|
| - | - | - |

---

*Last Updated: 2024-01-15*
*Next Review: Test scenarios should be reviewed weekly*