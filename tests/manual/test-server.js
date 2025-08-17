#!/usr/bin/env node
import { spawn } from 'child_process';
import readline from 'readline';

// Start the MCP server
const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let messageId = 1;

// Handle server stderr (info messages)
server.stderr.on('data', (data) => {
  console.error('[SERVER]', data.toString());
});

// Handle server stdout (JSON-RPC responses)
server.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      console.log('\n[RESPONSE]', JSON.stringify(response, null, 2));
    }
  } catch (error) {
    console.log('[RAW OUTPUT]', data.toString());
  }
});

// Send JSON-RPC request
function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: messageId++,
    method,
    params
  };
  
  console.log('\n[REQUEST]', JSON.stringify(request, null, 2));
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Test sequence
async function runTests() {
  console.log('Starting MCP Server Test...\n');
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 1. Initialize
  sendRequest('initialize', {
    protocolVersion: '0.1.0',
    capabilities: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 2. List tools
  sendRequest('tools/list');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 3. Test DelegateTask with echo command
  sendRequest('tools/call', {
    name: 'DelegateTask',
    arguments: {
      prompt: 'echo "Hello from Claude Code test"'
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 4. Check status
  sendRequest('tools/call', {
    name: 'TaskStatus',
    arguments: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 5. Get logs
  sendRequest('tools/call', {
    name: 'TaskLogs',
    arguments: {
      taskId: 'will-need-actual-id'  // We'll update this after getting the ID
    }
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\nTest complete. Press Ctrl+C to exit.');
}

// Handle shutdown
process.on('SIGINT', () => {
  server.kill();
  process.exit(0);
});

runTests().catch(console.error);