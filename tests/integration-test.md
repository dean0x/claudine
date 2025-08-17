# Claudine Integration Test Checklist

## Prerequisites
- [ ] Claudine built (`npm run build`)
- [ ] MCP config updated (`./setup-mcp.sh`)
- [ ] New Claude Code session started

## Test Sequence

### 1. Verify Tools Available
In Claude Code, ask:
```
What MCP tools do you have available?
```

Expected: Should list DelegateTask, TaskStatus, TaskLogs, CancelTask

### 2. Test DelegateTask
```
Use DelegateTask to run: Create a file called test.txt with "Hello from Claudine" inside
```

Expected: Returns task ID

### 3. Check Status
```
Use TaskStatus to check the current task
```

Expected: Shows task status (running/completed)

### 4. Get Logs
```
Use TaskLogs with the task ID from step 2
```

Expected: Shows mock execution output

### 5. Test Cancellation
```
Use DelegateTask to run: Perform a complex analysis for 10 seconds
Then immediately: Use CancelTask with the task ID
```

Expected: Task cancelled successfully

## Troubleshooting

### Tools not appearing
1. Check MCP config: `cat ~/.config/claude/mcp_servers.json`
2. Ensure NEW session (not --continue)
3. Check server runs: `node /workspace/claudine/dist/index.js`

### Server errors
1. Check Node version: `node --version` (need 20+)
2. Rebuild: `npm run clean && npm run build`
3. Check logs: `npm run dev`

### Mock mode not working
1. Ensure MOCK_MODE=true in config
2. Test directly: `MOCK_MODE=true npm run dev`

## Success Criteria
- [ ] All 4 tools appear in Claude Code
- [ ] Can delegate a task
- [ ] Can check status
- [ ] Can retrieve logs
- [ ] Can cancel a task

## Notes
- Using MOCK_MODE for testing without Claude CLI
- Real Claude CLI integration: remove MOCK_MODE from config
- Logs stored in memory (lost on restart in MVP)