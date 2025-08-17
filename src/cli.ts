#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI for easy setup and running
const args = process.argv.slice(2);
const command = args[0];

if (command === 'setup' || command === 'init') {
  console.log('🚀 Setting up Claudine MCP Server...\n');
  
  const configDir = path.join(process.env.HOME || '', '.config', 'claude');
  const configFile = path.join(configDir, 'mcp_servers.json');
  
  // Create config directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`✅ Created config directory: ${configDir}`);
  }
  
  // Generate config
  const claudinePath = path.join(__dirname, 'index.js');
  const config = {
    mcpServers: {
      claudine: {
        command: 'node',
        args: [claudinePath],
        env: {}
      }
    }
  };
  
  // Check if config exists
  if (fs.existsSync(configFile)) {
    console.log('⚠️  Existing MCP configuration found.');
    console.log('\nAdd this to your mcp_servers.json:');
    console.log(JSON.stringify(config.mcpServers.claudine, null, 2));
  } else {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(`✅ Created MCP config: ${configFile}`);
  }
  
  console.log('\n✨ Setup complete! Start a new Claude Code session to use Claudine.');
  console.log('\nTest with: "Use DelegateTask to run: echo Hello from Claudine"');
  
} else if (command === 'run' || command === 'start') {
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
  
} else if (command === 'test') {
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
  console.log(`
🤖 Claudine MCP Server - CLI

Usage:
  npx claudine-mcp <command>

Commands:
  setup, init    Set up MCP configuration for Claude Code
  run, start     Run the MCP server directly
  test           Test the server in mock mode
  help           Show this help message

Examples:
  npx claudine-mcp setup    # One-time setup
  npx claudine-mcp test     # Test that it works
  
After setup, start a new Claude Code session and use:
  "Use DelegateTask to run: <your task>"

Repository: https://github.com/dean0x/claudine
`);
}