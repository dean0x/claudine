#!/usr/bin/env node
// Test script for CancelTask functionality

import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MOCK_MODE: 'true'
  }
});

let messageId = 1;
let currentTaskId = null;

server.stderr.on('data', (data) => {
  console.error('[INFO]', data.toString().trim());
});

server.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      console.log('\n📥 Response received');
      
      // Extract task ID
      if (response.result?.content?.[0]?.text) {
        const text = response.result.content[0].text;
        try {
          const parsed = JSON.parse(text);
          if (parsed.taskId) {
            currentTaskId = parsed.taskId;
            console.log(`✅ Task ID: ${currentTaskId}`);
            console.log(`   Status: ${parsed.status || 'N/A'}`);
            console.log(`   Message: ${parsed.message || ''}`);
          }
        } catch {}
      }
    }
  } catch (error) {
    // Ignore parse errors
  }
});

function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: messageId++,
    method,
    params
  };
  
  console.log(`\n📤 Sending: ${method}`);
  server.stdin.write(JSON.stringify(request) + '\n');
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testCancellation() {
  console.log('🧪 Testing Task Cancellation\n');
  console.log('=' .repeat(50));
  
  await wait(1000);
  
  // Initialize
  sendRequest('initialize', {
    protocolVersion: '0.1.0',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  });
  await wait(500);
  
  // Start a long-running task
  console.log('\n1️⃣  Starting a long-running task (10 second mock)...');
  
  // Update mock to run longer
  server.kill();
  await wait(500);
  
  // Restart with longer mock task
  const server2 = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MOCK_MODE: 'true',
      MOCK_DELAY: '10'  // 10 second task
    }
  });
  
  server2.stderr.on('data', (data) => {
    console.error('[INFO]', data.toString().trim());
  });
  
  server2.stdout.on('data', (data) => {
    try {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        const response = JSON.parse(line);
        if (response.result?.content?.[0]?.text) {
          const text = response.result.content[0].text;
          try {
            const parsed = JSON.parse(text);
            if (parsed.taskId && !currentTaskId) {
              currentTaskId = parsed.taskId;
            }
            console.log('📥 Response:', parsed.message || parsed.status || 'OK');
          } catch {}
        }
      }
    } catch {}
  });
  
  await wait(1000);
  
  // Initialize new server
  const request1 = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '0.1.0',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' }
    }
  };
  server2.stdin.write(JSON.stringify(request1) + '\n');
  await wait(500);
  
  // Delegate long task
  console.log('\n📤 Delegating long-running task...');
  const request2 = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'DelegateTask',
      arguments: {
        prompt: 'Perform complex analysis that takes 10 seconds'
      }
    }
  };
  server2.stdin.write(JSON.stringify(request2) + '\n');
  await wait(1000);
  
  // Check status (should be running)
  console.log('\n2️⃣  Checking status (should be running)...');
  const request3 = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'TaskStatus',
      arguments: {}
    }
  };
  server2.stdin.write(JSON.stringify(request3) + '\n');
  await wait(1000);
  
  // Cancel the task
  console.log('\n3️⃣  Cancelling the task...');
  if (currentTaskId) {
    const request4 = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'CancelTask',
        arguments: {
          taskId: currentTaskId,
          reason: 'Testing cancellation functionality'
        }
      }
    };
    server2.stdin.write(JSON.stringify(request4) + '\n');
    await wait(1000);
    
    // Check status again (should be cancelled)
    console.log('\n4️⃣  Checking status after cancellation...');
    const request5 = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'TaskStatus',
        arguments: {
          taskId: currentTaskId
        }
      }
    };
    server2.stdin.write(JSON.stringify(request5) + '\n');
    await wait(1000);
  } else {
    console.log('❌ No task ID captured');
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log('✅ Cancel test complete!');
  
  server2.kill();
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

testCancellation().catch(console.error);