# Logging Strategy Research

## Overview
Effective logging is crucial for monitoring, debugging, and auditing Claudine's task execution. This document outlines the logging architecture and best practices for the MCP server.

## Logging Libraries Comparison

### 1. Pino (Recommended)
**Pros:**
- Extremely fast (low overhead)
- JSON structured logging by default
- Minimal CPU/memory impact
- Stream-based architecture
- Child loggers for context

**Configuration:**
```javascript
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname'
        }
      },
      {
        target: 'pino/file',
        options: { 
          destination: './logs/claudine.log',
          mkdir: true
        }
      }
    ]
  }
});
```

### 2. Winston (Alternative)
**Pros:**
- Highly configurable
- Multiple transport support
- Built-in log rotation
- Large ecosystem

**Configuration:**
```javascript
const winston = require('winston');
require('winston-daily-rotate-file');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.DailyRotateFile({
      filename: 'claudine-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d'
    })
  ]
});
```

## Claudine Logging Architecture

### 1. Structured Log Format
```javascript
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "taskId": "task-abc123",
  "sessionId": "session-xyz789",
  "event": "task.started",
  "message": "Starting Claude Code execution",
  "context": {
    "worktree": "/worktrees/task-abc123",
    "branch": "feature-xyz",
    "priority": "P1"
  },
  "metadata": {
    "pid": 12345,
    "hostname": "claudine-server"
  }
}
```

### 2. Log Levels Strategy

| Level | Usage | Example |
|-------|-------|---------|
| `fatal` | System crashes | "Failed to start MCP server" |
| `error` | Task failures | "Claude Code process crashed" |
| `warn` | Recoverable issues | "Task timeout approaching" |
| `info` | Key events | "Task completed successfully" |
| `debug` | Detailed flow | "Spawning process with args..." |
| `trace` | Low-level details | "JSON-RPC message received" |

### 3. Multi-Layer Logging

```javascript
class ClaudineLogger {
  constructor() {
    // Main server logger
    this.serverLogger = pino({
      name: 'claudine-server',
      level: 'info'
    });

    // Task execution logger
    this.taskLogger = pino({
      name: 'claudine-tasks',
      level: 'debug',
      transport: {
        target: 'pino/file',
        options: { destination: './logs/tasks.log' }
      }
    });

    // MCP protocol logger
    this.protocolLogger = pino({
      name: 'mcp-protocol',
      level: 'trace',
      transport: {
        target: 'pino/file',
        options: { destination: './logs/protocol.log' }
      }
    });
  }

  logTaskEvent(taskId, event, data) {
    const child = this.taskLogger.child({ taskId });
    child.info({ event, ...data }, `Task ${event}`);
  }

  logClaudeOutput(taskId, stream, data) {
    const logPath = `./logs/tasks/${taskId}/output.log`;
    const streamLogger = pino(pino.destination(logPath));
    streamLogger.info({ stream, data: data.toString() });
  }
}
```

### 4. Output Capture Strategy

#### Real-time Streaming
```javascript
class OutputCapture {
  constructor(taskId, logger) {
    this.taskId = taskId;
    this.logger = logger;
    this.outputBuffer = [];
    this.outputStream = fs.createWriteStream(
      `./logs/tasks/${taskId}/full-output.log`
    );
  }

  captureProcess(childProcess) {
    // Capture stdout
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      this.outputBuffer.push({ type: 'stdout', data: output, timestamp: Date.now() });
      this.outputStream.write(`[STDOUT] ${output}`);
      this.logger.debug({ taskId: this.taskId, stdout: output });
    });

    // Capture stderr
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      this.outputBuffer.push({ type: 'stderr', data: output, timestamp: Date.now() });
      this.outputStream.write(`[STDERR] ${output}`);
      this.logger.warn({ taskId: this.taskId, stderr: output });
    });

    // Handle completion
    childProcess.on('exit', (code) => {
      this.outputStream.end();
      this.saveExecutionSummary(code);
    });
  }

  saveExecutionSummary(exitCode) {
    const summary = {
      taskId: this.taskId,
      exitCode,
      startTime: this.outputBuffer[0]?.timestamp,
      endTime: Date.now(),
      outputLines: this.outputBuffer.length,
      errors: this.outputBuffer.filter(o => o.type === 'stderr').length
    };

    fs.writeFileSync(
      `./logs/tasks/${this.taskId}/summary.json`,
      JSON.stringify(summary, null, 2)
    );
  }
}
```

### 5. Log Rotation & Management

#### Automatic Rotation with Pino
```javascript
const { multistream } = require('pino');
const { createWriteStream } = require('pino-roll');

const streams = [
  { stream: process.stdout },
  { 
    stream: createWriteStream({
      file: './logs/claudine.log',
      size: '10M',     // Rotate at 10MB
      interval: '1d',  // Rotate daily
      compress: true   // Gzip old files
    })
  }
];

const logger = pino({}, multistream(streams));
```

#### Manual Cleanup Strategy
```javascript
class LogManager {
  async cleanupOldLogs(retentionDays = 7) {
    const logsDir = './logs/tasks';
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    
    const taskDirs = await fs.promises.readdir(logsDir);
    
    for (const dir of taskDirs) {
      const stats = await fs.promises.stat(path.join(logsDir, dir));
      if (stats.mtime.getTime() < cutoffTime) {
        await fs.promises.rm(path.join(logsDir, dir), { recursive: true });
        this.logger.info(`Cleaned up old logs for task ${dir}`);
      }
    }
  }
}
```

### 6. Debugging & Troubleshooting

#### Debug Mode
```javascript
// Enable debug logging via environment variable
const logger = pino({
  level: process.env.DEBUG ? 'trace' : 'info',
  prettyPrint: process.env.NODE_ENV === 'development'
});

// Conditional debug logging
if (logger.isLevelEnabled('debug')) {
  logger.debug({
    request: JSON.stringify(request),
    headers: request.headers
  }, 'Incoming MCP request');
}
```

#### Correlation IDs
```javascript
class RequestTracker {
  constructor(logger) {
    this.logger = logger;
  }

  trackRequest(requestId, method, params) {
    const child = this.logger.child({ requestId });
    
    child.info({ method, params }, 'Request received');
    
    return {
      log: child,
      complete: (result) => {
        child.info({ result }, 'Request completed');
      },
      error: (error) => {
        child.error({ error }, 'Request failed');
      }
    };
  }
}
```

### 7. Security Considerations

#### Sensitive Data Filtering
```javascript
const logger = pino({
  redact: {
    paths: ['password', 'token', 'apiKey', '*.secret'],
    censor: '[REDACTED]'
  }
});

// Custom sanitization
function sanitizeLogs(data) {
  const sensitivePatterns = [
    /api[_-]?key["\s]*[:=]["\s]*["']?[\w-]+["']?/gi,
    /token["\s]*[:=]["\s]*["']?[\w-]+["']?/gi,
    /password["\s]*[:=]["\s]*["']?[^"\s]+["']?/gi
  ];
  
  let sanitized = JSON.stringify(data);
  sensitivePatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });
  
  return JSON.parse(sanitized);
}
```

### 8. Performance Monitoring

```javascript
class PerformanceLogger {
  logTaskMetrics(taskId, metrics) {
    this.logger.info({
      taskId,
      duration: metrics.endTime - metrics.startTime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      outputSize: metrics.outputBytes,
      exitCode: metrics.exitCode
    }, 'Task performance metrics');
  }

  startTimer(operation) {
    const start = process.hrtime.bigint();
    return {
      end: () => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1000000; // Convert to ms
        this.logger.debug({ operation, duration }, 'Operation completed');
        return duration;
      }
    };
  }
}
```

## Best Practices

1. **Use structured JSON logging** for machine parsing
2. **Implement log levels** appropriately
3. **Include correlation IDs** for request tracking
4. **Rotate logs** to prevent disk space issues
5. **Sanitize sensitive data** before logging
6. **Use child loggers** for context isolation
7. **Buffer high-frequency logs** to reduce I/O
8. **Implement retention policies** for compliance
9. **Monitor log volume** to detect issues
10. **Use async logging** for performance

## References
- [Pino Documentation](https://getpino.io/)
- [Winston Documentation](https://github.com/winstonjs/winston)
- [Node.js Logging Best Practices](https://blog.logrocket.com/node-js-logging-best-practices-essential-guide/)
- [Structured Logging Guide](https://www.structlog.org/en/stable/)