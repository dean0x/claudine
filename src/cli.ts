#!/usr/bin/env node

// Set process title for easy identification in ps/pgrep/pkill
process.title = 'claudine-cli';

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootstrap } from './bootstrap.js';
import { validatePath, validateBufferSize, validateTimeout } from './utils/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI with subcommand pattern
const args = process.argv.slice(2);
const mainCommand = args[0];
const subCommand = args[1];

function showHelp() {
  console.log(`
🤖 Claudine - MCP Server for Task Delegation

Usage:
  claudine <command> [options...]

MCP Server Commands:
  mcp start              Start the MCP server
  mcp test               Test server startup and validation  
  mcp config             Show MCP configuration for Claude

Task Commands:
  delegate <prompt> [options]  Delegate a task to Claude Code (with git worktree by default)
    -p, --priority P0|P1|P2    Task priority (P0=critical, P1=high, P2=normal)
    -w, --working-directory D  Working directory for task execution
    --no-worktree              Run directly without worktree isolation
    --keep-worktree            Always preserve worktree after completion
    --delete-worktree          Always cleanup worktree after completion
    -s, --strategy STRATEGY    Merge strategy: pr|auto|manual|patch (default: pr)
    -b, --branch NAME          Custom branch name
    --base BRANCH              Base branch (default: current)
    -t, --timeout MS           Task timeout in milliseconds
  status [task-id]             Get status of task(s)
  logs <task-id> [--tail N]    Get output logs for a task (optionally limit to last N lines)
  cancel <task-id> [reason]    Cancel a running task with optional reason
  help                         Show this help message

Examples:
  claudine mcp start                                    # Start MCP server
  claudine delegate "analyze this codebase"            # Delegate task (PR by default)
  claudine delegate "fix the bug" --priority P0        # High priority task
  claudine delegate "test changes" --no-worktree      # Run directly without worktree
  claudine delegate "new feature" --strategy auto     # Auto-merge if no conflicts
  claudine delegate "experiment" --keep-worktree      # Preserve worktree after completion
  claudine status                                       # List all tasks
  claudine status abc123                                # Get specific task status
  claudine logs abc123                                  # Get task output
  claudine cancel abc123                                # Cancel task
  
Repository: https://github.com/dean0x/claudine
`);
}

function showConfig() {
  const config = {
    mcpServers: {
      claudine: {
        command: "npx",
        args: ["-y", "claudine", "mcp", "start"]
      }
    }
  };

  console.log(`
📋 MCP Configuration for Claudine

Add this to your MCP configuration file:

${JSON.stringify(config, null, 2)}

Configuration file locations:
- Claude Code: .mcp.json (in project root)
- Claude Desktop (macOS): ~/Library/Application Support/Claude/claude_desktop_config.json
- Claude Desktop (Windows): %APPDATA%\\Claude\\claude_desktop_config.json

For local development, use:
{
  "mcpServers": {
    "claudine": {
      "command": "node",
      "args": ["/path/to/claudine/dist/index.js"]
    }
  }
}

For global installation, use:
{
  "mcpServers": {
    "claudine": {
      "command": "claudine",
      "args": ["mcp", "start"]
    }
  }
}

Learn more: https://github.com/dean0x/claudine#configuration
`);
}

async function delegateTask(prompt: string, options?: {
  priority?: 'P0' | 'P1' | 'P2';
  workingDirectory?: string;
  useWorktree?: boolean;
  worktreeCleanup?: 'auto' | 'keep' | 'delete';
  mergeStrategy?: 'pr' | 'auto' | 'manual' | 'patch';
  branchName?: string;
  baseBranch?: string;
  autoCommit?: boolean;
  pushToRemote?: boolean;
  prTitle?: string;
  prBody?: string;
  timeout?: number;
  maxOutputBuffer?: number;
}) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const container = await bootstrap();
    
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    console.log('📝 Delegating task:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
    
    const request = {
      prompt,
      ...options
    };
    
    // Log the parameters being used
    if (options) {
      console.log('🔧 Task parameters:');
      if (options.priority) console.log('  Priority:', options.priority);
      if (options.workingDirectory) console.log('  Working Directory:', options.workingDirectory);
      if (options.useWorktree) console.log('  Use Worktree:', options.useWorktree);
      if (options.timeout) console.log('  Timeout:', options.timeout, 'ms');
      if (options.maxOutputBuffer) console.log('  Max Output Buffer:', options.maxOutputBuffer, 'bytes');
    }
    
    const result = await taskManager.delegate(request);
    if (result.ok) {
      const task = result.value;
      console.log('✅ Task delegated successfully!');
      console.log('📋 Task ID:', task.id);
      console.log('🔍 Status:', task.status);
      console.log('⏰ Check status with: claudine status', task.id);
      process.exit(0);
    } else {
      console.error('❌ Failed to delegate task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function getTaskStatus(taskId?: string) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const container = await bootstrap();
    
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    
    if (taskId) {
      console.log('🔍 Getting status for:', taskId);
      const result = await taskManager.getStatus(taskId);
      if (result.ok) {
        const task = result.value;
        console.log('📋 Task Details:');
        console.log('   ID:', task.id);
        console.log('   Status:', task.status);
        console.log('   Priority:', task.priority);
        if (task.startedAt) console.log('   Started:', new Date(task.startedAt).toISOString());
        if (task.completedAt) console.log('   Completed:', new Date(task.completedAt).toISOString());
        if (task.exitCode !== undefined) console.log('   Exit Code:', task.exitCode);
        if (task.completedAt && task.startedAt) {
          console.log('   Duration:', task.completedAt - task.startedAt, 'ms');
        }
        console.log('   Prompt:', task.prompt.substring(0, 100) + (task.prompt.length > 100 ? '...' : ''));
      } else {
        console.error('❌ Failed to get task status:', result.error.message);
        process.exit(1);
      }
    } else {
      console.log('📋 Getting all tasks...');
      const result = await taskManager.getStatus();
      if (result.ok && Array.isArray(result.value) && result.value.length > 0) {
        console.log(`📋 Found ${result.value.length} tasks:\n`);
        result.value.forEach((task: any) => {
          console.log(`${task.id} - ${task.status} - ${task.prompt.substring(0, 50)}...`);
        });
      } else if (result.ok) {
        console.log('📋 No tasks found');
      } else {
        console.error('❌ Failed to get tasks:', result.error.message);
        process.exit(1);
      }
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function getTaskLogs(taskId: string, tail?: number) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const container = await bootstrap();
    
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    console.log('📤 Getting logs for:', taskId);
    
    const result = await taskManager.getLogs(taskId);
    if (result.ok) {
      const logs = result.value;
      
      // Apply tail limit if specified
      let stdoutLines = logs.stdout || [];
      let stderrLines = logs.stderr || [];
      
      if (tail && tail > 0) {
        stdoutLines = stdoutLines.slice(-tail);
        stderrLines = stderrLines.slice(-tail);
      }
      
      if (stdoutLines.length > 0) {
        console.log('\n📤 STDOUT' + (tail ? ` (last ${tail} lines)` : '') + ':');
        stdoutLines.forEach((line: string) => console.log('  ', line));
      }
      if (stderrLines.length > 0) {
        console.log('\n📤 STDERR' + (tail ? ` (last ${tail} lines)` : '') + ':');
        stderrLines.forEach((line: string) => console.log('  ', line));
      }
      if ((!logs.stdout || logs.stdout.length === 0) && (!logs.stderr || logs.stderr.length === 0)) {
        console.log('\n📤 No output captured');
      }
      process.exit(0);
    } else {
      console.error('❌ Failed to get task logs:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function cancelTask(taskId: string, reason?: string) {
  try {
    console.log('🚀 Bootstrapping Claudine...');
    const container = await bootstrap();
    
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    console.log('🛑 Canceling task:', taskId);
    if (reason) {
      console.log('📝 Reason:', reason);
    }
    
    const result = await taskManager.cancel(taskId, reason);
    if (result.ok) {
      console.log('✅ Task canceled successfully');
      process.exit(0);
    } else {
      console.error('❌ Failed to cancel task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (mainCommand === 'mcp') {
  if (subCommand === 'start') {
    // For MCP, we must NOT print to stdout - just start the server
    // MCP uses stdio for communication
    const indexPath = path.join(__dirname, 'index.js');
    import(indexPath).then((module) => {
      // Call the main function if available
      if (module.main) {
        return module.main();
      }
    }).catch((error) => {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    });
    
  } else if (subCommand === 'test') {
    console.log('🧪 Testing Claudine MCP Server...\n');
    
    // Test real server startup and shutdown
    const indexPath = path.join(__dirname, 'index.js');
    const mcp = spawn('node', [indexPath], {
      stdio: ['pipe', 'pipe', 'pipe'] // Capture output for validation
    });
    
    let output = '';
    let hasError = false;
    
    // Capture stdout/stderr
    mcp.stdout?.on('data', (data) => { output += data.toString(); });
    mcp.stderr?.on('data', (data) => { output += data.toString(); });
    
    // Handle process events
    mcp.on('error', (error) => {
      console.error('❌ Failed to start server:', error.message);
      hasError = true;
    });
    
    mcp.on('exit', (code) => {
      if (hasError) {
        process.exit(1);
      }
      if (code !== 0 && code !== null) {
        console.error('❌ Server exited with non-zero code:', code);
        console.error('Output:', output);
        process.exit(1);
      }
    });
    
    // Test server starts within reasonable time
    setTimeout(() => {
      if (output.includes('Starting Claudine MCP Server') && !hasError) {
        console.log('✅ Server started successfully!');
        console.log('✅ Bootstrap completed without errors');
        mcp.kill();
        process.exit(0);
      } else {
        console.error('❌ Server failed to start properly');
        console.error('Output:', output);
        mcp.kill();
        process.exit(1);
      }
    }, 5000);
    
  } else if (subCommand === 'config') {
    showConfig();
    
  } else {
    console.error(`❌ Unknown MCP subcommand: ${subCommand || '(none)'}`);
    console.log('Valid subcommands: start, test, config');
    process.exit(1);
  }
  
} else if (mainCommand === 'delegate') {
  // Parse arguments for delegate command
  const delegateArgs = args.slice(1);
  const options: {
    priority?: 'P0' | 'P1' | 'P2';
    workingDirectory?: string;
    useWorktree?: boolean;
    worktreeCleanup?: 'auto' | 'keep' | 'delete';
    mergeStrategy?: 'pr' | 'auto' | 'manual' | 'patch';
    branchName?: string;
    baseBranch?: string;
    autoCommit?: boolean;
    pushToRemote?: boolean;
    prTitle?: string;
    prBody?: string;
    timeout?: number;
    maxOutputBuffer?: number;
  } = {
    useWorktree: true,  // Default: use worktree
    worktreeCleanup: 'auto',  // Default: smart cleanup
    mergeStrategy: 'pr',  // Default: create PR
    autoCommit: true,
    pushToRemote: true
  };
  
  let promptWords: string[] = [];
  
  for (let i = 0; i < delegateArgs.length; i++) {
    const arg = delegateArgs[i];
    
    if (arg === '--priority' || arg === '-p') {
      const next = delegateArgs[i + 1];
      if (next && ['P0', 'P1', 'P2'].includes(next)) {
        options.priority = next as 'P0' | 'P1' | 'P2';
        i++; // skip next arg
      } else {
        console.error('❌ Invalid priority. Must be P0, P1, or P2');
        process.exit(1);
      }
    } else if (arg === '--working-directory' || arg === '-w') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        // Validate the path to prevent traversal attacks
        const pathResult = validatePath(next);
        if (!pathResult.ok) {
          console.error(`❌ Invalid working directory: ${pathResult.error.message}`);
          process.exit(1);
        }
        options.workingDirectory = pathResult.value;
        i++; // skip next arg
      } else {
        console.error('❌ Working directory requires a path');
        process.exit(1);
      }
    } else if (arg === '--no-worktree') {
      options.useWorktree = false;
      options.mergeStrategy = undefined; // Merge strategies don't apply without worktree
    } else if (arg === '--keep-worktree') {
      options.worktreeCleanup = 'keep';
    } else if (arg === '--delete-worktree') {
      options.worktreeCleanup = 'delete';
    } else if (arg === '--strategy' || arg === '-s') {
      const next = delegateArgs[i + 1];
      if (next && ['pr', 'auto', 'manual', 'patch'].includes(next)) {
        options.mergeStrategy = next as 'pr' | 'auto' | 'manual' | 'patch';
        i++;
      } else {
        console.error('❌ Invalid strategy. Must be pr, auto, manual, or patch');
        process.exit(1);
      }
    } else if (arg === '--branch' || arg === '-b') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.branchName = next;
        i++;
      } else {
        console.error('❌ Branch name required');
        process.exit(1);
      }
    } else if (arg === '--base') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.baseBranch = next;
        i++;
      } else {
        console.error('❌ Base branch required');
        process.exit(1);
      }
    } else if (arg === '--pr-title') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.prTitle = next;
        i++;
      } else {
        console.error('❌ PR title required');
        process.exit(1);
      }
    } else if (arg === '--pr-body') {
      const next = delegateArgs[i + 1];
      if (next && !next.startsWith('-')) {
        options.prBody = next;
        i++;
      } else {
        console.error('❌ PR body required');
        process.exit(1);
      }
    } else if (arg === '--no-commit') {
      options.autoCommit = false;
    } else if (arg === '--no-push') {
      options.pushToRemote = false;
    } else if (arg === '--timeout' || arg === '-t') {
      const next = delegateArgs[i + 1];
      const timeout = parseInt(next);
      const timeoutResult = validateTimeout(timeout);
      if (!timeoutResult.ok) {
        console.error(`❌ ${timeoutResult.error.message}`);
        process.exit(1);
      }
      options.timeout = timeoutResult.value;
      i++; // skip next arg
    } else if (arg === '--max-output-buffer') {
      const next = delegateArgs[i + 1];
      const buffer = parseInt(next);
      const bufferResult = validateBufferSize(buffer);
      if (!bufferResult.ok) {
        console.error(`❌ ${bufferResult.error.message}`);
        process.exit(1);
      }
      options.maxOutputBuffer = bufferResult.value;
      i++; // skip next arg
    } else if (arg.startsWith('-')) {
      console.error(`❌ Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      promptWords.push(arg);
    }
  }
  
  const prompt = promptWords.join(' ');
  if (!prompt) {
    console.error('❌ Usage: claudine delegate "<prompt>" [options]');
    console.error('Options:');
    console.error('  -p, --priority P0|P1|P2      Task priority (P0=critical, P1=high, P2=normal)');
    console.error('  -w, --working-directory DIR   Working directory for task execution');
    console.error('');
    console.error('Worktree Control:');
    console.error('  --no-worktree                 Run directly without worktree isolation');
    console.error('  --keep-worktree               Always preserve worktree after completion');
    console.error('  --delete-worktree             Always cleanup worktree after completion');
    console.error('');
    console.error('Merge Strategy (requires worktree):');
    console.error('  -s, --strategy STRATEGY       Merge strategy: pr|auto|manual|patch (default: pr)');
    console.error('  -b, --branch NAME             Custom branch name');
    console.error('  --base BRANCH                 Base branch (default: current)');
    console.error('  --no-commit                   Don\'t auto-commit changes');
    console.error('  --no-push                     Don\'t push to remote');
    console.error('  --pr-title TITLE              PR title (for pr strategy)');
    console.error('  --pr-body BODY                PR description');
    console.error('');
    console.error('Execution:');
    console.error('  -t, --timeout MS              Task timeout in milliseconds');
    console.error('  --max-output-buffer BYTES     Maximum output buffer size');
    console.error('');
    console.error('Examples:');
    console.error('  claudine delegate "refactor auth"                     # Default: PR with worktree');
    console.error('  claudine delegate "quick fix" --no-worktree           # Direct execution');
    console.error('  claudine delegate "feature" --strategy auto           # Auto-merge');
    console.error('  claudine delegate "experiment" --keep-worktree        # Preserve worktree');
    process.exit(1);
  }
  
  await delegateTask(prompt, Object.keys(options).length > 0 ? options : undefined);
  
} else if (mainCommand === 'status') {
  const taskId = args[1];
  await getTaskStatus(taskId);
  
} else if (mainCommand === 'logs') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine logs <task-id> [--tail N]');
    console.error('Example: claudine logs abc123');
    console.error('         claudine logs abc123 --tail 50');
    process.exit(1);
  }
  
  // Parse optional tail parameter
  let tail: number | undefined;
  const tailIndex = args.indexOf('--tail');
  if (tailIndex !== -1 && args[tailIndex + 1]) {
    const tailValue = parseInt(args[tailIndex + 1]);
    if (isNaN(tailValue) || tailValue < 1 || tailValue > 1000) {
      console.error('❌ Invalid tail value. Must be between 1 and 1000');
      process.exit(1);
    }
    tail = tailValue;
  }
  
  await getTaskLogs(taskId, tail);
  
} else if (mainCommand === 'cancel') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine cancel <task-id> [reason]');
    console.error('Example: claudine cancel abc123');
    console.error('         claudine cancel abc123 "Taking too long"');
    process.exit(1);
  }
  
  // Optional reason is everything after the task ID
  const reason = args.slice(2).join(' ') || undefined;
  await cancelTask(taskId, reason);
  
} else if (mainCommand === 'help' || !mainCommand) {
  showHelp();
  
} else {
  console.error(`❌ Unknown command: ${mainCommand}`);
  showHelp();
  process.exit(1);
}