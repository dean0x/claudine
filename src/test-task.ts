#!/usr/bin/env node
/**
 * Simple task testing utility for debugging
 */

import { bootstrap } from './bootstrap.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'delegate') {
    const prompt = args[1];
    if (!prompt) {
      console.error('Usage: npx tsx src/test-task.ts delegate "echo hello"');
      process.exit(1);
    }
    await delegateTask(prompt);
    
  } else if (command === 'status') {
    const taskId = args[1];
    if (!taskId) {
      console.error('Usage: npx tsx src/test-task.ts status <task-id>');
      process.exit(1);
    }
    await getTaskStatus(taskId);
    
  } else {
    console.error('Commands: delegate, status');
    process.exit(1);
  }
}

async function delegateTask(prompt: string) {
  try {
    console.log('🚀 Bootstrapping...');
    const container = await bootstrap();
    
    console.log('🔧 Getting task manager...');
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
    console.log('📝 Delegating task:', prompt);
    
    const result = await taskManager.delegate({ prompt });
    if (result.ok) {
      const task = result.value;
      console.log('✅ Task delegated!');
      console.log('📋 Task ID:', task.id);
      console.log('🔍 Status:', task.status);
      console.log('⏰ Check status: npx tsx src/test-task.ts status', task.id);
    } else {
      console.error('❌ Failed to delegate task:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function getTaskStatus(taskId: string) {
  try {
    console.log('🚀 Bootstrapping...');
    const container = await bootstrap();
    
    console.log('🔧 Getting task manager...');
    const taskManagerResult = await container.resolve('taskManager');
    if (!taskManagerResult.ok) {
      console.error('❌ Failed to get task manager:', taskManagerResult.error.message);
      process.exit(1);
    }
    
    const taskManager = taskManagerResult.value as any;
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
      console.log('   Prompt:', task.prompt.substring(0, 100));
      
      // Get logs too
      const logsResult = await taskManager.getLogs(taskId);
      if (logsResult.ok) {
        const logs = logsResult.value;
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
      }
    } else {
      console.error('❌ Failed to get task status:', result.error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});