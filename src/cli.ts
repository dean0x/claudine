#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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
  claudine <command> [subcommand]

Commands:
  mcp start      Start the MCP server
  mcp test       Test server startup and validation
  mcp config     Show MCP configuration for Claude
  help           Show this help message

Examples:
  claudine mcp start     # Start the MCP server
  claudine mcp test      # Test that it works
  claudine mcp config    # Get configuration JSON
  
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
  
} else if (mainCommand === 'help' || !mainCommand) {
  showHelp();
  
} else {
  console.error(`❌ Unknown command: ${mainCommand}`);
  showHelp();
  process.exit(1);
}