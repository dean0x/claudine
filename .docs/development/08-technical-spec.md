# Technical Specification

## MCP Server Architecture

### Core Components

```typescript
// src/types.ts - Core type definitions
interface Task {
  id: string;                    // UUID v4
  prompt: string;                 // Task description for Claude
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  process?: ChildProcess;         // Node.js process reference
  output: string[];               // Captured stdout
  errors: string[];               // Captured stderr
  startTime?: number;             // Date.now() when started
  endTime?: number;               // Date.now() when completed
  exitCode?: number;              // Process exit code
  cancelReason?: string;          // If cancelled, why
}

interface ToolResponse {
  success: boolean;
  data?: any;
  error?: string;
}
```

### MCP Tool Schemas

#### DelegateTask
```typescript
{
  name: 'DelegateTask',
  description: 'Delegate a task to a background Claude Code instance',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The task for Claude Code to execute',
        minLength: 1,
        maxLength: 4000
      }
    },
    required: ['prompt']
  }
}
```

**Implementation Logic**:
1. Validate prompt (not empty, length limits)
2. Check if task already running (MVP: only one at a time)
3. Generate UUID for task ID
4. Spawn Claude Code process with prompt
5. Store task in registry
6. Return task ID immediately

#### TaskStatus
```typescript
{
  name: 'TaskStatus',
  description: 'Get status of a delegated task',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID to check (omit for current task)',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      }
    }
  }
}
```

**Implementation Logic**:
1. If no taskId, return current task status
2. Look up task in registry
3. Return status and basic metadata
4. Handle task not found gracefully

#### TaskLogs
```typescript
{
  name: 'TaskLogs',
  description: 'Retrieve execution logs from a delegated task',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID to get logs for',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      },
      tail: {
        type: 'number',
        description: 'Number of recent lines to return',
        default: 100,
        minimum: 1,
        maximum: 1000
      }
    },
    required: ['taskId']
  }
}
```

**Implementation Logic**:
1. Validate task exists
2. Get output array from task
3. Apply tail limit if specified
4. Format output for display
5. Include both stdout and stderr

#### CancelTask
```typescript
{
  name: 'CancelTask',
  description: 'Cancel a running delegated task',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID to cancel',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      },
      reason: {
        type: 'string',
        description: 'Optional reason for cancellation',
        maxLength: 200
      }
    },
    required: ['taskId']
  }
}
```

**Implementation Logic**:
1. Validate task exists and is running
2. Send SIGTERM to process
3. Set 5-second timer for SIGKILL if needed
4. Update task status to 'cancelled'
5. Store cancellation reason
6. Clean up resources

## Process Management

### Claude Code CLI Invocation

```bash
# Basic invocation pattern
claude -p "<prompt>" --no-interactive --output-format json

# With session resume (Phase 3)
claude -p "<prompt>" --resume <session-id> --no-interactive

# Environment variables to set
CLAUDE_CODE_TIMEOUT=1800000  # 30 minutes default
CLAUDE_CODE_MAX_TOKENS=100000
```

### Process Spawning

```typescript
// src/executor.ts
import { spawn, ChildProcess } from 'child_process';

class ProcessExecutor {
  spawn(taskId: string, prompt: string): ChildProcess {
    const args = [
      '-p',
      prompt,
      '--no-interactive',  // Non-interactive mode
      '--output-format', 'text'  // Plain text output
    ];

    const child = spawn('claude', args, {
      cwd: process.cwd(),  // Use current directory for MVP
      env: {
        ...process.env,
        CLAUDE_CODE_TASK_ID: taskId,
        CLAUDE_CODE_TIMEOUT: '1800000'
      },
      stdio: ['ignore', 'pipe', 'pipe'],  // Ignore stdin, pipe stdout/stderr
      detached: false,  // Don't detach from parent
      shell: false      // Direct execution, no shell
    });

    return child;
  }
}
```

### Output Capture Strategy

```typescript
class OutputCapture {
  private output: string[] = [];
  private errors: string[] = [];
  private maxBufferSize = 10 * 1024 * 1024; // 10MB limit
  private currentSize = 0;

  captureStdout(data: Buffer) {
    const str = data.toString('utf8');
    const size = Buffer.byteLength(str);
    
    if (this.currentSize + size > this.maxBufferSize) {
      // Truncate old output if needed
      this.output = ['[Output truncated...]\n', ...this.output.slice(-100)];
      this.currentSize = this.output.reduce((acc, s) => acc + Buffer.byteLength(s), 0);
    }
    
    this.output.push(str);
    this.currentSize += size;
  }
}
```

## State Management

### Task Registry (MVP - In Memory)

```typescript
class TaskRegistry {
  private tasks = new Map<string, Task>();
  private currentTaskId: string | null = null;
  private cleanupInterval: NodeJS.Timer;

  constructor() {
    // Clean up completed tasks older than 1 hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTasks();
    }, 60 * 60 * 1000); // Every hour
  }

  private cleanupOldTasks() {
    const oneHourAgo = Date.now() - 3600000;
    for (const [id, task] of this.tasks) {
      if (task.endTime && task.endTime < oneHourAgo) {
        this.tasks.delete(id);
      }
    }
  }
}
```

## Error Handling

### Error Types

```typescript
enum ErrorCode {
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  CLAUDE_NOT_FOUND = 'CLAUDE_NOT_FOUND',
  SPAWN_FAILED = 'SPAWN_FAILED',
  INVALID_PROMPT = 'INVALID_PROMPT',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

class ClaudineError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public taskId?: string
  ) {
    super(message);
    this.name = 'ClaudineError';
  }
}
```

### Error Responses

```typescript
// MCP error response format
{
  error: {
    code: -32603,  // Internal error
    message: "Task already running",
    data: {
      errorCode: "TASK_ALREADY_RUNNING",
      taskId: "current-task-id"
    }
  }
}
```

## File Structure

```
claudine/
├── src/
│   ├── index.ts              # Entry point, starts MCP server
│   ├── server.ts             # MCP server class
│   ├── types.ts              # TypeScript type definitions
│   ├── tools/
│   │   ├── delegate.ts       # DelegateTask tool
│   │   ├── status.ts         # TaskStatus tool
│   │   ├── logs.ts           # TaskLogs tool
│   │   └── cancel.ts         # CancelTask tool
│   ├── core/
│   │   ├── executor.ts       # Process execution logic
│   │   ├── registry.ts       # Task registry
│   │   └── output.ts         # Output capture
│   └── utils/
│       ├── errors.ts         # Error handling
│       ├── validation.ts     # Input validation
│       └── logger.ts         # Logging setup
├── tests/
│   ├── unit/
│   └── integration/
├── dist/                     # Compiled JS output
├── logs/                     # Log files
├── package.json
├── tsconfig.json
├── .env.example              # Environment variables
└── README.md
```

## Environment Variables

```bash
# .env.example
NODE_ENV=development
LOG_LEVEL=info
MAX_OUTPUT_BUFFER=10485760    # 10MB
TASK_TIMEOUT=1800000           # 30 minutes
CLAUDE_CODE_PATH=claude        # Path to Claude Code CLI
MCP_SERVER_NAME=claudine
MCP_SERVER_VERSION=0.1.0
```

## Testing Strategy

### Unit Tests (Vitest)

```typescript
// tests/unit/executor.test.ts
describe('ProcessExecutor', () => {
  it('should spawn claude process with correct arguments', () => {
    const mockSpawn = vi.spyOn(childProcess, 'spawn');
    const executor = new ProcessExecutor();
    
    executor.spawn('task-123', 'test prompt');
    
    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', 'test prompt', '--no-interactive', '--output-format', 'text'],
      expect.objectContaining({
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    );
  });
});
```

### Integration Tests

```typescript
// tests/integration/delegate.test.ts
describe('DelegateTask Integration', () => {
  it('should execute task end-to-end', async () => {
    const server = await startTestServer();
    const response = await server.callTool('DelegateTask', {
      prompt: 'echo "Hello, World!"'
    });
    
    expect(response.success).toBe(true);
    expect(response.data.taskId).toMatch(/^[0-9a-f]{8}-/);
    
    // Wait for completion
    await waitFor(() => {
      const status = server.callTool('TaskStatus', {
        taskId: response.data.taskId
      });
      return status.data.status === 'completed';
    });
    
    const logs = await server.callTool('TaskLogs', {
      taskId: response.data.taskId
    });
    
    expect(logs.data.output).toContain('Hello, World!');
  });
});
```

## Performance Considerations

### Limits (MVP)
- Max output buffer: 10MB per task
- Task timeout: 30 minutes
- One task at a time
- Cleanup after 1 hour

### Monitoring Points
- Process spawn time
- Memory usage per task
- Output buffer size
- Task execution duration

## Security Considerations

### Input Validation
- Sanitize prompts (no shell injection)
- Validate task IDs (UUID format)
- Limit prompt length (4000 chars)
- No file system access in prompts

### Process Isolation
- No shell execution
- Limited environment variables
- No network access (MVP)
- Current directory only

## Logging

### Log Levels
```typescript
logger.info('Task started', { taskId, prompt: prompt.substring(0, 100) });
logger.error('Task failed', { taskId, error: error.message });
logger.debug('Process spawned', { taskId, pid: child.pid });
logger.warn('Task timeout approaching', { taskId, elapsed });
```

### Log Output Format
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "Task started",
  "taskId": "abc-123",
  "prompt": "First 100 chars..."
}
```