# Process Management Research

## Node.js Child Process Management

### 1. Process Spawning Methods

#### spawn()
Best for long-running processes with streaming output:
```javascript
const { spawn } = require('child_process');
const child = spawn('command', ['arg1', 'arg2'], {
  cwd: '/working/directory',
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe']  // stdin, stdout, stderr
});
```

**Advantages:**
- Streams output in real-time
- Low memory overhead
- Suitable for long-running processes
- Direct control over stdio

#### exec()
For simple commands with buffered output:
```javascript
const { exec } = require('child_process');
exec('ls -la', (error, stdout, stderr) => {
  console.log(stdout);
});
```

**Limitations:**
- Buffers entire output in memory
- Max buffer size restrictions
- Not suitable for long-running processes

#### fork()
Specifically for Node.js processes with IPC:
```javascript
const { fork } = require('child_process');
const child = fork('script.js');
child.send({ cmd: 'START' });
child.on('message', (msg) => {
  console.log('Message from child:', msg);
});
```

### 2. Stream Management

#### Real-time Output Capture
```javascript
const child = spawn('claude', args);

// Capture stdout
child.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
  // Process or store output
});

// Capture stderr
child.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
  // Log errors
});

// Handle process exit
child.on('close', (code) => {
  console.log(`Process exited with code ${code}`);
});
```

#### Handling Large Outputs
- Use streams instead of buffering
- Implement backpressure handling
- Consider piping to files for persistence

### 3. Process Lifecycle Management

#### Process States
```javascript
class ProcessManager {
  constructor() {
    this.processes = new Map();
  }

  spawn(id, command, args, options) {
    const child = spawn(command, args, options);
    
    this.processes.set(id, {
      process: child,
      pid: child.pid,
      status: 'running',
      startTime: Date.now()
    });

    child.on('exit', (code) => {
      const proc = this.processes.get(id);
      proc.status = 'exited';
      proc.exitCode = code;
      proc.endTime = Date.now();
    });

    return child;
  }

  kill(id, signal = 'SIGTERM') {
    const proc = this.processes.get(id);
    if (proc && proc.process) {
      proc.process.kill(signal);
    }
  }
}
```

### 4. Inter-Process Communication (IPC)

#### Using stdio for IPC
```javascript
// Parent process
const child = spawn('node', ['child.js'], {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});

child.send({ command: 'start', data: {} });
child.on('message', (msg) => {
  console.log('Received:', msg);
});
```

#### Unix Domain Sockets
```javascript
const net = require('net');

// Server (parent)
const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    console.log('Received:', data.toString());
  });
});
server.listen('/tmp/claudine.sock');

// Client (child)
const client = net.connect('/tmp/claudine.sock');
client.write('Task completed');
```

#### File-based Signaling
```javascript
const fs = require('fs');
const path = require('path');

// Write completion marker
function signalCompletion(taskId, result) {
  const markerPath = path.join('/tmp/claudine', `${taskId}.done`);
  fs.writeFileSync(markerPath, JSON.stringify({
    taskId,
    result,
    timestamp: Date.now()
  }));
}

// Watch for completion
function watchCompletion(taskId, callback) {
  const markerPath = path.join('/tmp/claudine', `${taskId}.done`);
  fs.watchFile(markerPath, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      const result = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      callback(result);
      fs.unwatchFile(markerPath);
    }
  });
}
```

### 5. Resource Management

#### Adaptive Process Pooling
```javascript
class AdaptiveProcessPool {
  constructor(options = {}) {
    this.softLimit = options.softLimit || 10;
    this.hardLimit = options.hardLimit || 50;
    this.minMemoryPerTask = options.minMemoryPerTask || 512 * 1024 * 1024; // 512MB
    this.maxCpuThreshold = options.maxCpuThreshold || 0.8; // 80% CPU
    this.running = new Set();
    this.queue = [];
  }

  async canSpawnNew() {
    // Check system resources dynamically
    const memInfo = await this.getSystemMemory();
    const cpuLoad = await this.getCPULoad();
    
    // Soft limit warning
    if (this.running.size >= this.softLimit) {
      console.warn(`Running ${this.running.size} processes (soft limit: ${this.softLimit})`);
    }
    
    // Dynamic decision based on available resources
    return (
      this.running.size < this.hardLimit &&
      memInfo.available > this.minMemoryPerTask &&
      cpuLoad.average < this.maxCpuThreshold
    );
  }

  async execute(command, args, options = {}) {
    // Wait if we can't spawn new process
    while (!await this.canSpawnNew()) {
      await this.waitForResources();
    }

    const process = spawn(command, args, options);
    this.running.add(process);

    process.on('exit', () => {
      this.running.delete(process);
      this.processNext();
    });

    return process;
  }

  async getSystemMemory() {
    const os = require('os');
    return {
      total: os.totalmem(),
      free: os.freemem(),
      available: os.freemem() // Simplified, could use more sophisticated calculation
    };
  }

  async getCPULoad() {
    const os = require('os');
    const loads = os.loadavg();
    const cpuCount = os.cpus().length;
    return {
      average: loads[0] / cpuCount,
      loads
    };
  }

  waitForResources() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        if (await this.canSpawnNew()) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 5000); // Check every 5 seconds
    });
  }
}
```

#### Heartbeat Monitoring (Instead of Hard Timeouts)
```javascript
class HeartbeatMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.stallThreshold = options.stallThreshold || 300000; // 5 minutes
    this.checkInterval = options.checkInterval || 30000; // Check every 30s
    this.lastActivity = new Map();
    this.monitors = new Map();
  }

  monitorTask(taskId, process) {
    // Track initial activity
    this.lastActivity.set(taskId, Date.now());
    
    // Monitor stdout/stderr for activity
    process.stdout.on('data', () => {
      this.lastActivity.set(taskId, Date.now());
      this.emit('task:active', { taskId, stream: 'stdout' });
    });
    
    process.stderr.on('data', () => {
      this.lastActivity.set(taskId, Date.now());
      this.emit('task:active', { taskId, stream: 'stderr' });
    });
    
    // Periodic stall check
    const interval = setInterval(() => {
      const lastSeen = this.lastActivity.get(taskId);
      const stalledTime = Date.now() - lastSeen;
      
      if (stalledTime > this.stallThreshold) {
        this.emit('task:stalled', { 
          taskId, 
          stalledFor: stalledTime,
          lastActivity: new Date(lastSeen)
        });
        // Note: We emit an event, not kill the process
        // Let the consumer decide what to do
      }
    }, this.checkInterval);
    
    this.monitors.set(taskId, interval);
    
    // Cleanup on exit
    process.on('exit', () => {
      clearInterval(interval);
      this.monitors.delete(taskId);
      this.lastActivity.delete(taskId);
    });
  }

  stopMonitoring(taskId) {
    const interval = this.monitors.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.monitors.delete(taskId);
      this.lastActivity.delete(taskId);
    }
  }
}
```

#### Progress-Based Monitoring
```javascript
class ProgressMonitor {
  constructor() {
    this.taskProgress = new Map();
  }

  updateProgress(taskId, progress) {
    this.taskProgress.set(taskId, {
      ...progress,
      lastUpdate: Date.now()
    });
  }

  getProgress(taskId) {
    return this.taskProgress.get(taskId);
  }

  isTaskHealthy(taskId) {
    const progress = this.taskProgress.get(taskId);
    if (!progress) return true; // No progress tracking, assume healthy
    
    const timeSinceUpdate = Date.now() - progress.lastUpdate;
    
    // Task is healthy if:
    // 1. It's making progress (percentComplete increasing)
    // 2. It's in an active phase
    // 3. It hasn't been stalled too long
    return (
      progress.percentComplete > 0 ||
      progress.phase !== 'idle' ||
      timeSinceUpdate < 600000 // 10 minutes
    );
  }
}
```

#### Resource-Based Monitoring
```javascript
class ResourceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxMemoryPerTask = options.maxMemoryPerTask || 2 * 1024 * 1024 * 1024; // 2GB
    this.criticalMemoryThreshold = options.criticalMemory || 4 * 1024 * 1024 * 1024; // 4GB
    this.checkInterval = options.checkInterval || 10000; // 10 seconds
    this.monitoring = new Map();
  }

  async monitorProcess(taskId, pid) {
    const interval = setInterval(async () => {
      try {
        const usage = await this.getProcessUsage(pid);
        
        // Emit metrics for observability
        this.emit('metrics', { taskId, usage });
        
        // Soft warning for high memory
        if (usage.memory > this.maxMemoryPerTask) {
          this.emit('task:high-memory', { 
            taskId, 
            usage,
            threshold: this.maxMemoryPerTask 
          });
        }
        
        // Critical intervention only if affecting system
        if (usage.memory > this.criticalMemoryThreshold) {
          this.emit('task:critical-memory', { taskId, usage });
          // Could send SIGUSR1 to request checkpoint
          process.kill(pid, 'USR1');
        }
      } catch (error) {
        // Process might have exited
        clearInterval(interval);
        this.monitoring.delete(taskId);
      }
    }, this.checkInterval);
    
    this.monitoring.set(taskId, interval);
  }

  async getProcessUsage(pid) {
    // Platform-specific implementation
    // On Linux, could read from /proc/{pid}/status
    // On macOS, could use ps command
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync(`ps -o pid,rss,vsz,%cpu -p ${pid}`);
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        return {
          pid: parseInt(parts[0]),
          memory: parseInt(parts[1]) * 1024, // RSS in bytes
          virtualMemory: parseInt(parts[2]) * 1024, // VSZ in bytes
          cpu: parseFloat(parts[3])
        };
      }
    } catch (error) {
      throw new Error(`Failed to get process usage: ${error.message}`);
    }
  }

  stopMonitoring(taskId) {
    const interval = this.monitoring.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.monitoring.delete(taskId);
    }
  }
}
```

#### Checkpoint & Resume Support
```javascript
class CheckpointManager {
  constructor(options = {}) {
    this.checkpointDir = options.checkpointDir || './checkpoints';
    this.autoCheckpointInterval = options.interval || 600000; // 10 minutes
    this.checkpoints = new Map();
  }

  async createCheckpoint(taskId, sessionId, metadata = {}) {
    const checkpoint = {
      taskId,
      sessionId,
      timestamp: Date.now(),
      metadata,
      canResume: true
    };
    
    // Save checkpoint to disk
    const fs = require('fs').promises;
    const path = require('path');
    
    await fs.mkdir(this.checkpointDir, { recursive: true });
    const checkpointPath = path.join(this.checkpointDir, `${taskId}.json`);
    
    await fs.writeFile(
      checkpointPath,
      JSON.stringify(checkpoint, null, 2)
    );
    
    this.checkpoints.set(taskId, checkpoint);
    return checkpoint;
  }

  async loadCheckpoint(taskId) {
    const fs = require('fs').promises;
    const path = require('path');
    const checkpointPath = path.join(this.checkpointDir, `${taskId}.json`);
    
    try {
      const data = await fs.readFile(checkpointPath, 'utf8');
      const checkpoint = JSON.parse(data);
      this.checkpoints.set(taskId, checkpoint);
      return checkpoint;
    } catch (error) {
      return null;
    }
  }

  async suspendTask(taskId, pid) {
    // Create checkpoint before suspending
    const checkpoint = await this.createCheckpoint(taskId, sessionId, {
      suspended: true,
      pid
    });
    
    // Pause the process (SIGSTOP)
    process.kill(pid, 'SIGSTOP');
    
    return checkpoint;
  }

  async resumeTask(taskId, pid) {
    const checkpoint = await this.loadCheckpoint(taskId);
    if (checkpoint && checkpoint.metadata.suspended) {
      // Resume the process (SIGCONT)
      process.kill(pid, 'SIGCONT');
      
      // Update checkpoint
      checkpoint.metadata.suspended = false;
      await this.createCheckpoint(taskId, checkpoint.sessionId, checkpoint.metadata);
      
      return true;
    }
    return false;
  }

  enableAutoCheckpoint(taskId, sessionId) {
    const interval = setInterval(() => {
      this.createCheckpoint(taskId, sessionId, { auto: true });
    }, this.autoCheckpointInterval);
    
    return () => clearInterval(interval);
  }
}

### 6. Error Handling

#### Comprehensive Error Management
```javascript
function safeSpawn(command, args, options) {
  const child = spawn(command, args, options);

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`Command not found: ${command}`);
    } else if (err.code === 'EACCES') {
      console.error(`Permission denied: ${command}`);
    } else {
      console.error(`Failed to start process: ${err.message}`);
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`Process killed by signal: ${signal}`);
    } else if (code !== 0) {
      console.log(`Process exited with error code: ${code}`);
    }
  });

  return child;
}
```

### 7. Best Practices

1. **Always handle process errors and exit events**
2. **Implement proper cleanup on parent process exit**
3. **Use appropriate spawn method for use case**
4. **Monitor resource usage (memory, CPU)**
5. **Implement graceful shutdown (SIGTERM before SIGKILL)**
6. **Log all process lifecycle events**
7. **Use process pools for concurrent execution**
8. **Set reasonable timeouts**
9. **Validate commands before spawning**
10. **Sanitize user input to prevent injection**

## References
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html)
- [Node.js Net Module (IPC)](https://nodejs.org/api/net.html)
- [Node.js Events Documentation](https://nodejs.org/api/events.html)