#!/usr/bin/env node
// Test script that uses 'echo' instead of 'claude' for testing without Claude CLI

import { spawn } from 'child_process';
import readline from 'readline';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MOCK_MODE: 'true'  // We'll add support for this
  }
});

let messageId = 1;
let currentTaskId = null;

// Handle server stderr (info messages)
server.stderr.on('data', (data) => {
  console.error('[SERVER INFO]', data.toString().trim());
});

// Handle server stdout (JSON-RPC responses)
server.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      console.log('\n📥 Response:', JSON.stringify(response, null, 2));
      
      // Extract task ID from DelegateTask response
      if (response.result?.content?.[0]?.text) {
        const text = response.result.content[0].text;
        try {
          const parsed = JSON.parse(text);
          if (parsed.taskId) {
            currentTaskId = parsed.taskId;
            console.log(`\n✅ Task ID captured: ${currentTaskId}`);
          }
        } catch {}
      }
    }
  } catch (error) {
    console.log('[RAW]', data.toString());
  }
});

function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: messageId++,
    method,
    params
  };
  
  console.log('\n📤 Request:', method);
  server.stdin.write(JSON.stringify(request) + '\n');
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🚀 Starting Claudine MCP Server Test\n');
  console.log('=' .repeat(50));
  
  await wait(1000);
  
  // 1. Initialize
  console.log('\n1️⃣  Initializing server...');
  sendRequest('initialize', {
    protocolVersion: '0.1.0',
    capabilities: {}
  });
  await wait(500);
  
  // 2. List tools
  console.log('\n2️⃣  Listing available tools...');
  sendRequest('tools/list');
  await wait(500);
  
  // 3. Delegate a simple task
  console.log('\n3️⃣  Delegating test task...');
  sendRequest('tools/call', {
    name: 'DelegateTask',
    arguments: {
      prompt: 'Create a simple hello world Python script'
    }
  });
  await wait(2000);
  
  // 4. Check status
  console.log('\n4️⃣  Checking task status...');
  sendRequest('tools/call', {
    name: 'TaskStatus',
    arguments: {}
  });
  await wait(1000);
  
  // 5. Get logs if we have a task ID
  if (currentTaskId) {
    console.log('\n5️⃣  Retrieving task logs...');
    sendRequest('tools/call', {
      name: 'TaskLogs',
      arguments: {
        taskId: currentTaskId
      }
    });
    await wait(1000);
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log('✨ Test sequence complete!');
  console.log('Press Ctrl+C to exit\n');
}

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  server.kill();
  process.exit(0);
});

runTests().catch(console.error);