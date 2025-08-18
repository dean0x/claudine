# Tech Stack Decision Document

## Decision Summary
**Language**: TypeScript  
**Runtime**: Node.js 20+  
**MCP SDK**: @modelcontextprotocol/sdk  
**Process Management**: Native child_process  
**Logging**: Pino  
**Testing**: Vitest  
**Build Tool**: tsx (development) / tsc (production)

## Rationale

### TypeScript (Chosen over Python)

**Pros:**
- MCP TypeScript SDK is more mature and feature-complete
- Better async/await support for concurrent task management
- Superior process spawning capabilities with child_process
- Type safety for complex task management logic
- Better performance for I/O intensive operations
- Native EventEmitter for real-time monitoring

**Cons:**
- Slightly more complex setup than Python
- TypeScript compilation step required

**Decision**: TypeScript provides better tooling for our concurrent process management needs.

### Core Dependencies

#### Required (MVP)
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",  // MCP server implementation
  "pino": "^9.0.0",                        // High-performance logging
  "zod": "^3.22.0"                         // Runtime validation
}
```

#### Development
```json
{
  "typescript": "^5.3.0",
  "tsx": "^4.0.0",                         // Fast TypeScript execution
  "@types/node": "^20.0.0",
  "vitest": "^1.0.0"                       // Fast unit testing
}
```

#### Phase 2+ (Deferred)
```json
{
  "pino-pretty": "^11.0.0",                // Pretty logging (optional)
  "bullmq": "^5.0.0",                      // Advanced queue (if needed)
  "p-queue": "^8.0.0"                      // Promise queue (if needed)
}
```

### Architecture Decisions

#### 1. Simple Process Pool (MVP)
```typescript
// Start simple, no external dependencies
class SimpleProcessPool {
  private processes = new Map<string, ChildProcess>();
  private queue: Task[] = [];
  
  async execute(task: Task) {
    // Direct spawn, no complex pooling
    const child = spawn('claude', [...]);
    this.processes.set(task.id, child);
  }
}
```

#### 2. File-Based State (MVP)
- Use JSON files for task state persistence
- No database dependency for MVP
- Simple recovery mechanism

#### 3. Direct STDIO Communication
- Use MCP SDK's StdioServerTransport
- No HTTP server for MVP
- Direct Claude Desktop integration

### Development Environment

#### Minimum Requirements
- Node.js 20.0.0+
- npm 10.0.0+
- Git 2.30+ (for worktree support)
- Claude Code CLI installed locally

#### Recommended VSCode Extensions
- ESLint
- Prettier
- TypeScript Error Lens

### File Structure (MVP)
```
claudine/
├── src/
│   ├── index.ts           # Entry point
│   ├── server.ts          # MCP server setup
│   ├── tools/
│   │   ├── delegate.ts    # DelegateTask implementation
│   │   └── status.ts      # TaskStatus implementation
│   ├── executor.ts        # Process execution
│   └── types.ts           # TypeScript types
├── dist/                  # Compiled output
├── logs/                  # Task logs
├── state/                 # Task state files
├── package.json
├── tsconfig.json
└── README.md
```

### Build & Deployment

#### Development
```bash
npm run dev  # tsx src/index.ts
```

#### Production Build
```bash
npm run build  # tsc
npm start     # node dist/index.js
```

#### MCP Registration (Claude Desktop)
```json
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["${HOME}/claudine/dist/index.js"]
    }
  }
}
```

## Deferred Decisions

### For Later Phases
1. **Database**: PostgreSQL/SQLite for task history (Phase 3)
2. **Queue System**: BullMQ for advanced scheduling (Phase 2)
3. **Monitoring**: OpenTelemetry integration (Phase 4)
4. **API Layer**: REST/GraphQL for external access (Phase 5)
5. **Container**: Docker for deployment (Phase 3)

### Why Defer?
- Reduce initial complexity
- Faster time to first value
- Learn from real usage patterns
- Avoid premature optimization

## Risk Mitigation

### Technical Risks
1. **Process crashes**: Implement graceful recovery
2. **Memory leaks**: Monitor with built-in Node.js tools
3. **Concurrent limits**: Start with conservative defaults
4. **State corruption**: Use atomic file operations

### Mitigation Strategies
- Comprehensive error handling from day 1
- Structured logging for debugging
- Conservative resource limits
- File-based locks for state changes

## Success Criteria for Tech Stack

1. **Can spawn Claude Code process**: ✓ (child_process)
2. **Can capture output**: ✓ (stdio streams)
3. **Can integrate with Claude**: ✓ (MCP SDK)
4. **Can persist state**: ✓ (filesystem)
5. **Can handle errors**: ✓ (try/catch + events)
6. **Can be tested**: ✓ (vitest)

## Next Steps

1. Initialize TypeScript project
2. Install core dependencies
3. Create basic MCP server
4. Implement DelegateTask tool
5. Test with Claude Desktop