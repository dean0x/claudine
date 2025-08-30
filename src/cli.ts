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
  mcp test       Test the server in mock mode
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
    import(indexPath);
    
  } else if (subCommand === 'test') {
    console.log('🧪 Testing Claudine MCP Server...\n');
    
    // Run in mock mode
    const indexPath = path.join(__dirname, 'index.js');
    const mcp = spawn('node', [indexPath], {
      env: { ...process.env, MOCK_MODE: 'true' },
      stdio: 'inherit'
    });
    
    setTimeout(() => {
      console.log('\n✅ Server started successfully in mock mode!');
      mcp.kill();
      process.exit(0);
    }, 3000);
    
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