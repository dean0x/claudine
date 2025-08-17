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
  help           Show this help message

Examples:
  claudine mcp start    # Start the MCP server
  claudine mcp test     # Test that it works
  
Repository: https://github.com/dean0x/claudine
`);
}

if (mainCommand === 'mcp') {
  if (subCommand === 'start') {
    console.log('🚀 Starting Claudine MCP Server...\n');
    
    // Run the MCP server
    const indexPath = path.join(__dirname, 'index.js');
    const mcp = spawn('node', [indexPath], {
      stdio: 'inherit'
    });
    
    mcp.on('error', (error) => {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    });
    
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
    
  } else {
    console.error(`❌ Unknown MCP subcommand: ${subCommand || '(none)'}`);
    console.log('Valid subcommands: start, test');
    process.exit(1);
  }
  
} else if (mainCommand === 'help' || !mainCommand) {
  showHelp();
  
} else {
  console.error(`❌ Unknown command: ${mainCommand}`);
  showHelp();
  process.exit(1);
}