# Claudine Implementation Blueprint

## Executive Summary
Claudine is an MCP server that enables Claude to delegate tasks to background Claude Code CLI instances. It provides sophisticated task management with priority-based execution, dependency resolution, and optional git worktree isolation.

## System Architecture

### Component Overview
```
┌─────────────────────────────────────────────────────┐
│                   Claude (Host)                      │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │            MCP Client (Built-in)             │   │
│  └───────────────┬───────────────────────────┘   │
│                  │ JSON-RPC over STDIO              │
└──────────────────┼───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│             Claudine MCP Server                   │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │         Task Queue Manager                │   │
│  │  - Priority Queue (P0, P1, P2)           │   │
│  │  - Dependency Resolution                  │   │
│  │  - Resource Pool Management              │   │
│  └──────────────────────────────────────────┘   │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │      Process Execution Engine             │   │
│  │  - Claude Code CLI Spawning              │   │
│  │  - Session Management                     │   │
│  │  - Output Capture & Streaming            │   │
│  └──────────────────────────────────────────┘   │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │        Git Worktree Manager               │   │
│  │  - Worktree Creation/Cleanup             │   │
│  │  - Branch Management                      │   │
│  │  - Isolation Strategy                     │   │
│  └──────────────────────────────────────────┘   │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │         Logging & Monitoring              │   │
│  │  - Structured JSON Logging               │   │
│  │  - Output Persistence                     │   │
│  │  - Performance Metrics                    │   │
│  └──────────────────────────────────────────┘   │
└───────────────────────────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───▼──┐      ┌───▼──┐      ┌───▼──┐
│Task 1│      │Task 2│      │Task 3│
│Claude│      │Claude│      │Claude│
│ Code │      │ Code │      │ Code │
└──────┘      └──────┘      └──────┘
```

## Core Implementation

### 1. MCP Server Setup

```typescript
// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TaskManager } from './task-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { ProcessExecutor } from './process-executor.js';

export class ClaudineServer {
  private server: Server;
  private taskManager: TaskManager;
  private worktreeManager: WorktreeManager;
  private processExecutor: ProcessExecutor;

  constructor() {
    this.server = new Server(
      {
        name: 'claudine',
        version: '1.0.0',
        description: 'Task delegation to background Claude Code instances'
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    this.taskManager = new TaskManager();
    this.worktreeManager = new WorktreeManager();
    this.processExecutor = new ProcessExecutor();

    this.registerTools();
  }

  private registerTools() {
    // Tool: DelegateTask
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        if (request.params.name === 'DelegateTask') {
          return this.handleDelegateTask(request.params.arguments);
        }
        // Handle other tools...
      }
    );
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Claudine MCP Server started');
  }
}
```

### 2. Task Management System

```typescript
// src/task-manager.ts
export interface ClaudineTask {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  dependencies: string[];
  command: string;
  context: {
    sessionId?: string;
    worktreeBranch?: string;
    timeout?: number;
    useWorktree?: boolean;
  };
  status: 'queued' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: Error;
  startTime?: number;
  endTime?: number;
}

export class TaskManager {
  private tasks: Map<string, ClaudineTask> = new Map();
  private queue: PriorityQueue<ClaudineTask>;
  private running: Set<string> = new Set();
  private maxConcurrent = 5;

  constructor() {
    this.queue = new PriorityQueue(this.compareTasks);
  }

  private compareTasks(a: ClaudineTask, b: ClaudineTask): number {
    const priorityOrder = { P0: 0, P1: 1, P2: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  }

  async submitTask(task: Omit<ClaudineTask, 'id' | 'status'>): Promise<string> {
    const taskId = crypto.randomUUID();
    const fullTask: ClaudineTask = {
      ...task,
      id: taskId,
      status: 'queued'
    };

    this.tasks.set(taskId, fullTask);
    this.queue.enqueue(fullTask);
    
    setImmediate(() => this.processQueue());
    
    return taskId;
  }

  private async processQueue() {
    while (this.running.size < this.maxConcurrent && !this.queue.isEmpty()) {
      const task = this.findNextExecutableTask();
      if (task) {
        this.executeTask(task);
      } else {
        break; // No executable tasks available
      }
    }
  }

  private findNextExecutableTask(): ClaudineTask | null {
    const pending = this.queue.toArray();
    
    for (const task of pending) {
      if (this.canExecute(task)) {
        this.queue.remove(task);
        return task;
      }
    }
    
    return null;
  }

  private canExecute(task: ClaudineTask): boolean {
    // Check if all dependencies are completed
    return task.dependencies.every(depId => {
      const dep = this.tasks.get(depId);
      return dep && dep.status === 'completed';
    });
  }
}
```

### 3. Process Executor with Intelligent Monitoring

```typescript
// src/process-executor.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export class ProcessExecutor extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private heartbeatMonitor: HeartbeatMonitor;
  private resourceMonitor: ResourceMonitor;

  constructor() {
    super();
    this.heartbeatMonitor = new HeartbeatMonitor();
    this.resourceMonitor = new ResourceMonitor();
    
    // Listen for monitoring events
    this.heartbeatMonitor.on('task:stalled', (data) => {
      this.emit('task:stalled', data);
      // Notify user, don't auto-kill
    });
    
    this.resourceMonitor.on('task:high-memory', (data) => {
      this.emit('task:warning', {
        type: 'high-memory',
        ...data
      });
    });
  }

  async execute(
    taskId: string,
    command: string,
    args: string[],
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, CLAUDINE_TASK_ID: taskId },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const processInfo: ProcessInfo = {
      process: child,
      pid: child.pid,
      startTime: Date.now(),
      taskId
    };
    
    this.processes.set(taskId, processInfo);

    // Start monitoring
    this.heartbeatMonitor.monitorTask(taskId, child);
    if (child.pid) {
      this.resourceMonitor.monitorProcess(taskId, child.pid);
    }

    const output: string[] = [];
    const errors: string[] = [];
    let lastActivity = Date.now();

    // Capture output with activity tracking
    child.stdout.on('data', (data) => {
      const str = data.toString();
      output.push(str);
      lastActivity = Date.now();
      this.emit('output', { 
        taskId, 
        type: 'stdout', 
        data: str,
        timestamp: lastActivity 
      });
    });

    child.stderr.on('data', (data) => {
      const str = data.toString();
      errors.push(str);
      lastActivity = Date.now();
      this.emit('output', { 
        taskId, 
        type: 'stderr', 
        data: str,
        timestamp: lastActivity 
      });
    });

    // Optional timeout (disabled by default)
    let timeoutHandle: NodeJS.Timeout | null = null;
    if (options.timeout && options.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        this.emit('task:timeout', { 
          taskId, 
          timeout: options.timeout,
          lastActivity 
        });
        // Emit warning, let user decide whether to cancel
      }, options.timeout);
    }

    // Wait for completion
    return new Promise((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        
        // Stop monitoring
        this.heartbeatMonitor.stopMonitoring(taskId);
        this.resourceMonitor.stopMonitoring(taskId);
        
        this.processes.delete(taskId);

        resolve({
          taskId,
          exitCode: code,
          signal,
          output: output.join(''),
          errors: errors.join(''),
          success: code === 0,
          duration: Date.now() - processInfo.startTime
        });
      });

      child.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        
        // Stop monitoring
        this.heartbeatMonitor.stopMonitoring(taskId);
        this.resourceMonitor.stopMonitoring(taskId);
        
        this.processes.delete(taskId);
        reject(error);
      });
    });
  }

  // User-controlled task management
  async cancelTask(taskId: string, reason?: string): Promise<boolean> {
    const processInfo = this.processes.get(taskId);
    if (processInfo) {
      this.emit('task:cancelling', { taskId, reason });
      
      // Graceful termination first
      processInfo.process.kill('SIGTERM');
      
      // Force kill after grace period
      setTimeout(() => {
        if (!processInfo.process.killed) {
          processInfo.process.kill('SIGKILL');
        }
      }, 5000);
      
      return true;
    }
    return false;
  }

  async suspendTask(taskId: string): Promise<boolean> {
    const processInfo = this.processes.get(taskId);
    if (processInfo && processInfo.pid) {
      process.kill(processInfo.pid, 'SIGSTOP');
      this.emit('task:suspended', { taskId });
      return true;
    }
    return false;
  }

  async resumeTask(taskId: string): Promise<boolean> {
    const processInfo = this.processes.get(taskId);
    if (processInfo && processInfo.pid) {
      process.kill(processInfo.pid, 'SIGCONT');
      this.emit('task:resumed', { taskId });
      return true;
    }
    return false;
  }

  getTaskStatus(taskId: string): TaskStatus | null {
    const processInfo = this.processes.get(taskId);
    if (!processInfo) return null;

    return {
      taskId,
      pid: processInfo.pid,
      running: !processInfo.process.killed,
      startTime: processInfo.startTime,
      uptime: Date.now() - processInfo.startTime
    };
  }
}
```

### 4. Worktree Manager

```typescript
// src/worktree-manager.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export class WorktreeManager {
  private baseRepo: string;
  private worktreesDir: string;

  constructor(baseRepo: string = process.cwd()) {
    this.baseRepo = baseRepo;
    this.worktreesDir = path.join(baseRepo, '..', 'claudine-worktrees');
  }

  async createTaskWorktree(
    taskId: string,
    branch?: string
  ): Promise<WorktreeInfo> {
    await fs.mkdir(this.worktreesDir, { recursive: true });

    const worktreePath = path.join(this.worktreesDir, `task-${taskId}`);
    const branchName = branch || `claudine-task-${taskId}`;

    // Check if branch exists
    try {
      await execAsync(`git rev-parse --verify ${branchName}`, {
        cwd: this.baseRepo
      });
      // Branch exists, use it
      await execAsync(`git worktree add ${worktreePath} ${branchName}`, {
        cwd: this.baseRepo
      });
    } catch {
      // Branch doesn't exist, create it
      await execAsync(`git worktree add -b ${branchName} ${worktreePath}`, {
        cwd: this.baseRepo
      });
    }

    return {
      taskId,
      path: worktreePath,
      branch: branchName,
      created: new Date()
    };
  }

  async removeTaskWorktree(taskId: string): Promise<void> {
    const worktreePath = path.join(this.worktreesDir, `task-${taskId}`);
    
    try {
      await execAsync(`git worktree remove ${worktreePath} --force`, {
        cwd: this.baseRepo
      });
    } catch (error) {
      // Fallback to manual removal if git command fails
      await fs.rm(worktreePath, { recursive: true, force: true });
      await execAsync('git worktree prune', { cwd: this.baseRepo });
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: this.baseRepo
    });

    return this.parseWorktreeList(stdout);
  }
}
```

### 5. MCP Tools Definition

```typescript
// src/tools.ts
export const CLAUDINE_TOOLS = [
  {
    name: 'DelegateTask',
    description: 'Delegate a task to a background Claude Code instance',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt for Claude Code'
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          default: 'P2',
          description: 'Task priority (P0=critical, P1=high, P2=normal)'
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          default: [],
          description: 'Task IDs that must complete before this task'
        },
        sessionId: {
          type: 'string',
          description: 'Claude Code session ID to resume'
        },
        useWorktree: {
          type: 'boolean',
          default: false,
          description: 'Execute in isolated git worktree'
        },
        branch: {
          type: 'string',
          description: 'Git branch for worktree (if useWorktree=true)'
        },
        timeout: {
          type: 'number',
          default: null,
          description: 'Optional timeout in milliseconds (null = no timeout)'
        },
        enableMonitoring: {
          type: 'boolean',
          default: true,
          description: 'Enable heartbeat and resource monitoring'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'TaskStatus',
    description: 'Get status of delegated tasks',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Specific task ID (omit for all tasks)'
        }
      }
    }
  },
  {
    name: 'TaskLogs',
    description: 'Retrieve execution logs from a delegated task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to get logs for'
        },
        tail: {
          type: 'number',
          default: 100,
          description: 'Number of recent lines to return'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'CancelTask',
    description: 'Cancel a running delegated task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to cancel'
        },
        reason: {
          type: 'string',
          description: 'Optional reason for cancellation'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'SuspendTask',
    description: 'Suspend a running delegated task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to suspend'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'ResumeTask',
    description: 'Resume a suspended delegated task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to resume'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'ListTasks',
    description: 'List all delegated tasks with their current status',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'running', 'completed', 'failed', 'suspended', 'queued'],
          default: 'all',
          description: 'Filter tasks by status'
        }
      }
    }
  },
  {
    name: 'TaskMetrics',
    description: 'Get resource metrics for a delegated task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to get metrics for'
        }
      },
      required: ['taskId']
    }
  }
];
```

## Deployment Instructions

### 1. Project Setup
```bash
# Initialize project
mkdir claudine
cd claudine
npm init -y

# Install dependencies
npm install @modelcontextprotocol/sdk
npm install pino pino-pretty pino-roll
npm install @types/node typescript tsx
npm install --save-dev @types/pino
```

### 2. Package.json Configuration
```json
{
  "name": "claudine",
  "version": "1.0.0",
  "description": "MCP server for delegating tasks to Claude Code",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "jest"
  },
  "bin": {
    "claudine": "./dist/index.js"
  }
}
```

### 3. TypeScript Configuration
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "logs"]
}
```

### 4. Claude Desktop Integration
```json
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["/path/to/claudine/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info",
        "MAX_CONCURRENT_TASKS": "5",
        "DEFAULT_TIMEOUT": "300000"
      }
    }
  }
}
```

## Testing Strategy

### Unit Tests
- Task queue management
- Priority ordering
- Dependency resolution
- Worktree operations

### Integration Tests
- MCP protocol compliance
- Claude Code CLI spawning
- Output capture
- Session management

### E2E Tests
- Full task lifecycle
- Concurrent task execution
- Error recovery
- Resource cleanup

## Monitoring & Observability

### Metrics to Track
- Task execution time
- Queue depth
- Success/failure rates
- Resource utilization
- Claude Code session reuse

### Health Checks
- Process pool availability
- Disk space for logs/worktrees
- Git repository status
- MCP connection status

## Security & Resource Management

### Adaptive Resource Management
Instead of hard limits, Claudine uses intelligent resource management:

1. **Input Validation**: Sanitize all task prompts
2. **Dynamic Resource Scaling**: 
   - Soft limits (warnings) vs hard limits (enforcement)
   - System resource monitoring (CPU, memory)
   - Adaptive concurrent process management
3. **Intelligent Task Monitoring**:
   - Heartbeat monitoring instead of hard timeouts
   - Progress tracking for long-running tasks
   - Stall detection with notifications
4. **Log Sanitization**: Redact sensitive data
5. **Filesystem Isolation**: Use worktrees for separation
6. **Process Control**:
   - User-controlled cancellation
   - Checkpoint & resume capabilities
   - Resource-based interventions

### Monitoring Strategy
```typescript
{
  "monitoring": {
    "stallDetection": true,
    "stallThreshold": 300000,     // 5 min without output
    "resourceMonitoring": true,
    "alertOnHighUsage": true,
    "checkpointInterval": 600000  // 10 min auto-checkpoint
  },
  "limits": {
    "softMaxConcurrent": 10,      // Warn above this
    "hardMaxConcurrent": 50,       // Absolute max
    "maxMemoryPerTask": "2GB",     // Soft limit
    "criticalMemory": "4GB",       // Critical threshold
    "defaultTimeout": null,        // No timeout by default
    "userCancellable": true        // Users can always cancel
  }
}

## Future Enhancements

1. **Web UI Dashboard**: Task monitoring interface
2. **Task Templates**: Reusable task configurations
3. **Webhook Notifications**: External system integration
4. **Distributed Execution**: Multi-machine support
5. **Smart Scheduling**: ML-based priority optimization
6. **Caching Layer**: Session and output caching
7. **Task Composition**: Complex workflow support

## Conclusion

Claudine provides a robust foundation for delegating Claude Code tasks with proper isolation, monitoring, and management. The architecture is extensible and follows MCP best practices for security and reliability.