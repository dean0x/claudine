#!/usr/bin/env node
// Test JSON-RPC 2.0 protocol compliance

import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, MOCK_MODE: 'true' }
});

let tests = [];

server.stderr.on('data', () => {}); // Suppress stderr

server.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      
      // Check JSON-RPC 2.0 compliance
      if (!response.jsonrpc || response.jsonrpc !== '2.0') {
        tests.push({ test: 'JSON-RPC version', passed: false, error: 'Missing or incorrect version' });
      } else {
        tests.push({ test: `Response ${response.id}`, passed: true });
      }
    }
  } catch (error) {
    tests.push({ test: 'JSON parsing', passed: false, error: error.message });
  }
});

async function testProtocol() {
  console.log('🔬 Testing JSON-RPC 2.0 Protocol Compliance\n');
  
  // Wait for server
  await new Promise(r => setTimeout(r, 1000));
  
  // Test 1: Valid request
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '0.1.0', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
  }) + '\n');
  
  await new Promise(r => setTimeout(r, 500));
  
  // Test 2: Request without ID (notification)
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {}
  }) + '\n');
  
  await new Promise(r => setTimeout(r, 500));
  
  // Test 3: Invalid method
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'invalid/method',
    params: {}
  }) + '\n');
  
  await new Promise(r => setTimeout(r, 500));
  
  // Test 4: Batch request (if supported)
  server.stdin.write(JSON.stringify([
    { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} }
  ]) + '\n');
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Results
  console.log('Results:');
  let passed = 0;
  let failed = 0;
  
  tests.forEach(t => {
    if (t.passed) {
      console.log(`✅ ${t.test}`);
      passed++;
    } else {
      console.log(`❌ ${t.test}: ${t.error || 'Failed'}`);
      failed++;
    }
  });
  
  console.log(`\n📊 Protocol Compliance: ${passed}/${passed + failed} tests passed`);
  
  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

testProtocol().catch(console.error);