# Development Setup Checklist

## Pre-Development Checklist

### Environment Requirements
- [ ] **Node.js 20.0.0+** installed
  ```bash
  node --version  # Should output v20.0.0 or higher
  ```

- [ ] **npm 10.0.0+** installed
  ```bash
  npm --version  # Should output 10.0.0 or higher
  ```

- [ ] **Git 2.30+** installed (for worktree support in Phase 3)
  ```bash
  git --version  # Should output 2.30 or higher
  ```

- [ ] **Claude Code CLI** installed and working
  ```bash
  claude --version  # Should output version
  claude -p "echo test" # Should work
  ```

- [ ] **TypeScript** globally installed (optional but helpful)
  ```bash
  npm install -g typescript
  tsc --version  # Should output 5.3.0 or higher
  ```

### Claude Desktop Setup
- [ ] Claude Desktop installed
- [ ] Can access Claude Desktop settings
- [ ] Know location of MCP config file
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - Linux: `~/.config/Claude/claude_desktop_config.json`

### Development Tools
- [ ] Code editor ready (VSCode recommended)
- [ ] Terminal/shell access
- [ ] GitHub account (for repository)
- [ ] MCP Inspector installed (optional but helpful)
  ```bash
  npm install -g @modelcontextprotocol/inspector
  ```

## Project Initialization Checklist

### Step 1: Create Project Structure
```bash
# Create project directory
mkdir claudine
cd claudine

# Initialize git repository
git init
echo "node_modules/" > .gitignore
echo "dist/" >> .gitignore
echo "logs/" >> .gitignore
echo ".env" >> .gitignore
echo "*.log" >> .gitignore

# Create directory structure
mkdir -p src/tools src/core src/utils tests/unit tests/integration logs
```

### Step 2: Initialize npm Project
```bash
# Initialize package.json
npm init -y

# Update package.json name and description
npm pkg set name="claudine"
npm pkg set description="MCP server for delegating tasks to Claude Code"
npm pkg set version="0.1.0"
npm pkg set type="module"
npm pkg set main="dist/index.js"
```

### Step 3: Install Dependencies
```bash
# Core dependencies
npm install @modelcontextprotocol/sdk zod

# Development dependencies
npm install -D typescript @types/node tsx vitest @vitest/ui

# Optional (for later)
# npm install pino pino-pretty
```

### Step 4: Configure TypeScript
Create `tsconfig.json`:
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
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "logs", "tests"]
}
```

### Step 5: Add npm Scripts
```bash
# Add development scripts
npm pkg set scripts.dev="tsx src/index.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node dist/index.js"
npm pkg set scripts.test="vitest"
npm pkg set scripts.test:ui="vitest --ui"
npm pkg set scripts.clean="rm -rf dist logs"
npm pkg set scripts.typecheck="tsc --noEmit"
```

### Step 6: Create Entry Point
Create `src/index.ts`:
```typescript
#!/usr/bin/env node
console.log('Claudine MCP Server starting...');
// TODO: Implement server
```

### Step 7: Verify Setup
```bash
# Test TypeScript compilation
npm run typecheck

# Test dev script
npm run dev  # Should output "Claudine MCP Server starting..."

# Test build
npm run build
npm start    # Should output same message
```

## First Code Checklist

### FOUND-001: Initialize TypeScript Project
- [ ] package.json created with correct settings
- [ ] Dependencies installed
- [ ] tsconfig.json configured
- [ ] npm scripts working
- [ ] Can run `npm run dev`
- [ ] Can run `npm run build`

### FOUND-002: Setup MCP Server Scaffold
- [ ] Create `src/server.ts`
- [ ] Import MCP SDK
- [ ] Create basic server class
- [ ] Setup StdioServerTransport
- [ ] Server starts without errors

### FOUND-003: Define TypeScript Types
- [ ] Create `src/types.ts`
- [ ] Define Task interface
- [ ] Define ToolResponse interface
- [ ] Define ErrorCode enum
- [ ] Export all types

## Testing Checklist

### Manual Testing Points
- [ ] MCP server starts
- [ ] No TypeScript errors
- [ ] Can connect with MCP Inspector
- [ ] Tools appear in tool list
- [ ] Basic request/response works

### Automated Testing Setup
- [ ] Vitest configured
- [ ] Test structure created
- [ ] Mock child_process ready
- [ ] First test passes

## Integration Checklist

### Claude Desktop Integration
- [ ] Build project (`npm run build`)
- [ ] Note full path to `dist/index.js`
- [ ] Update Claude Desktop config:
  ```json
  {
    "mcpServers": {
      "claudine": {
        "command": "node",
        "args": ["/absolute/path/to/claudine/dist/index.js"],
        "env": {}
      }
    }
  }
  ```
- [ ] Restart Claude Desktop
- [ ] Verify Claudine appears in tools

## Troubleshooting Checklist

### Common Issues and Solutions

#### Issue: Claude Code not found
- [ ] Verify `claude` is in PATH
- [ ] Try full path to claude executable
- [ ] Check Claude Code is installed

#### Issue: TypeScript errors
- [ ] Run `npm run typecheck` for details
- [ ] Verify Node.js version is 20+
- [ ] Check tsconfig.json settings

#### Issue: MCP server won't start
- [ ] Check for port conflicts
- [ ] Verify all dependencies installed
- [ ] Check logs directory exists
- [ ] Review error messages

#### Issue: Claude Desktop doesn't see Claudine
- [ ] Verify absolute path in config
- [ ] Check JSON syntax in config
- [ ] Restart Claude Desktop
- [ ] Check Claude Desktop logs

## Daily Development Checklist

### Start of Day
- [ ] Pull latest changes
- [ ] Run `npm install` (if package.json changed)
- [ ] Run `npm run typecheck`
- [ ] Check task tracker for today's tasks

### Before Each Commit
- [ ] Run `npm run typecheck`
- [ ] Run `npm test` (once tests exist)
- [ ] Update task tracker
- [ ] Write clear commit message

### End of Day
- [ ] Commit all changes
- [ ] Update task tracker with progress
- [ ] Note any blockers
- [ ] Plan tomorrow's tasks

## Definition of Ready (Before Starting a Task)

- [ ] Task description is clear
- [ ] Acceptance criteria defined
- [ ] Dependencies identified
- [ ] Technical approach understood
- [ ] Test cases considered

## Definition of Done (Task Complete)

- [ ] Code implemented
- [ ] No TypeScript errors
- [ ] Tests written (if applicable)
- [ ] Manual testing passed
- [ ] Code self-reviewed
- [ ] Task tracker updated

## Emergency Contacts

### Resources
- MCP Documentation: https://modelcontextprotocol.io
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Claude Code Docs: https://docs.anthropic.com/claude-code
- TypeScript Docs: https://www.typescriptlang.org/docs

### Common Commands
```bash
# Quick reset
npm run clean && npm run build

# Check what's running
ps aux | grep claude

# Kill stuck processes
pkill -f claude

# Clear logs
rm -rf logs/*

# Full reinstall
rm -rf node_modules package-lock.json
npm install
```