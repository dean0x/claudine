#!/usr/bin/env node
// Proper test for CancelTask functionality

import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MOCK_MODE: 'true',
    MOCK_DELAY: '10'  // 10 second delay to allow cancellation
  }
});

let messageId = 1;
let currentTaskId = null;
let testPassed = false;

server.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg.includes('running')) {
    console.log('ℹ️  Server info:', msg);
  }
});

server.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      
      // Extract task ID from DelegateTask
      if (response.id === 2 && response.result?.content?.[0]?.text) {
        const result = JSON.parse(response.result.content[0].text);
        if (result.taskId) {
          currentTaskId = result.taskId;
          console.log('📝 Task started with ID:', currentTaskId);
        }
      }
      
      // Check task status
      if (response.id === 3 && response.result?.content?.[0]?.text) {
        const result = JSON.parse(response.result.content[0].text);
        console.log('📊 Task status:', result.status);
      }
      
      // Check cancellation result
      if (response.id === 4 && response.result?.content?.[0]?.text) {
        const result = JSON.parse(response.result.content[0].text);
        if (result.success && result.message.includes('cancelled')) {
          console.log('✅ Task cancelled successfully!');
          testPassed = true;
        }
      }
      
      // Check final status
      if (response.id === 5 && response.result?.content?.[0]?.text) {
        const result = JSON.parse(response.result.content[0].text);
        if (result.status === 'cancelled') {
          console.log('✅ Final status confirms cancellation:', result.status);
          testPassed = true;
        }
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
  server.stdin.write(JSON.stringify(request) + '\n');
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testCancellation() {
  console.log('\n🔬 Testing Task Cancellation\n');
  console.log('=' .repeat(50));
  
  await wait(1000);
  
  // 1. Initialize
  sendRequest('initialize', {
    protocolVersion: '0.1.0',
    capabilities: {},
    clientInfo: { name: 'cancel-test', version: '1.0.0' }
  });
  await wait(500);
  
  // 2. Start a long-running task
  console.log('\n📋 Starting a 10-second task...');
  sendRequest('tools/call', {
    name: 'DelegateTask',
    arguments: {
      prompt: 'Long running analysis task that takes 10 seconds'
    }
  });
  await wait(1000);
  
  // 3. Check that it's running
  console.log('\n📋 Checking task status (should be running)...');
  sendRequest('tools/call', {
    name: 'TaskStatus',
    arguments: {}
  });
  await wait(1000);
  
  // 4. Cancel the task while it's running
  console.log('\n📋 Cancelling the task...');
  if (currentTaskId) {
    sendRequest('tools/call', {
      name: 'CancelTask',
      arguments: {
        taskId: currentTaskId,
        reason: 'Testing cancellation functionality'
      }
    });
    await wait(1000);
    
    // 5. Check final status
    console.log('\n📋 Checking final status (should be cancelled)...');
    sendRequest('tools/call', {
      name: 'TaskStatus',
      arguments: {
        taskId: currentTaskId
      }
    });
    await wait(1000);
  }
  
  console.log('\n' + '=' .repeat(50));
  
  if (testPassed) {
    console.log('\n✅ Cancel test PASSED! Task was successfully cancelled.\n');
    server.kill();
    process.exit(0);
  } else {
    console.log('\n❌ Cancel test FAILED. Task was not cancelled properly.\n');
    server.kill();
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  server.kill();
  process.exit(0);
});

testCancellation().catch(console.error);