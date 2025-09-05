#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootstrap } from './bootstrap.js';

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
  delegate <prompt>      Delegate a task to Claude Code
  status [task-id]       Get status of task(s)
  logs <task-id>         Get output logs for a task
  cancel <task-id>       Cancel a running task
  help                   Show this help message

Examples:
  claudine mcp start                           # Start MCP server
  claudine delegate "analyze this codebase"   # Delegate task  
  claudine status                              # List all tasks
  claudine status abc123                       # Get specific task status
  claudine logs abc123                         # Get task output
  claudine cancel abc123                       # Cancel task
  
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

async function delegateTask(prompt: string) {
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
    
    const result = await taskManager.delegate({ prompt });
    if (result.ok) {
      const task = result.value;
      console.log('✅ Task delegated successfully!');
      console.log('📋 Task ID:', task.id);
      console.log('🔍 Status:', task.status);
      console.log('⏰ Check status with: claudine status', task.id);
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
      const result = await taskManager.listTasks();
      if (result.ok && result.value.length > 0) {
        console.log(`📋 Found ${result.value.length} tasks:\n`);
        result.value.forEach((task: any) => {
          console.log(`${task.id} - ${task.status} - ${task.prompt.substring(0, 50)}...`);
        });
      } else {
        console.log('📋 No tasks found');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function getTaskLogs(taskId: string) {
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
      if (logs.stdout && logs.stdout.length > 0) {
        console.log('\n📤 STDOUT:');
        logs.stdout.forEach((line: string) => console.log('  ', line));
      }
      if (logs.stderr && logs.stderr.length > 0) {
        console.log('\n📤 STDERR:');
        logs.stderr.forEach((line: string) => console.log('  ', line));
      }
      if ((!logs.stdout || logs.stdout.length === 0) && (!logs.stderr || logs.stderr.length === 0)) {
        console.log('\n📤 No output captured');
      }
    } else {
      console.error('❌ Failed to get task logs:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function cancelTask(taskId: string) {
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
    
    const result = await taskManager.cancel(taskId);
    if (result.ok) {
      console.log('✅ Task canceled successfully');
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
  const prompt = args.slice(1).join(' ');
  if (!prompt) {
    console.error('❌ Usage: claudine delegate "<prompt>"');
    console.error('Example: claudine delegate "analyze this codebase"');
    process.exit(1);
  }
  await delegateTask(prompt);
  
} else if (mainCommand === 'status') {
  const taskId = args[1];
  await getTaskStatus(taskId);
  
} else if (mainCommand === 'logs') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine logs <task-id>');
    console.error('Example: claudine logs abc123');
    process.exit(1);
  }
  await getTaskLogs(taskId);
  
} else if (mainCommand === 'cancel') {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Usage: claudine cancel <task-id>');
    console.error('Example: claudine cancel abc123');
    process.exit(1);
  }
  await cancelTask(taskId);
  
} else if (mainCommand === 'help' || !mainCommand) {
  showHelp();
  
} else {
  console.error(`❌ Unknown command: ${mainCommand}`);
  showHelp();
  process.exit(1);
}