#!/usr/bin/env node
/**
 * Claudine MCP Server - New Architecture
 * Main entry point with autoscaling
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pkg from '../package.json' with { type: 'json' };
import { bootstrap } from './bootstrap.js';
import { AutoscalingManager } from './services/autoscaling-manager.js';
import { WorkerPool } from './core/interfaces.js';
import { MCPAdapter } from './adapters/mcp-adapter.js';
import { Logger } from './core/interfaces.js';
import { Container } from './core/container.js';

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

async function main() {
  // Set process title for easy identification in ps/pgrep/pkill
  process.title = 'claudine-mcp';
  
  let container: Container | null = null;
  let autoscaler: AutoscalingManager | null = null;

  try {
    // Bootstrap application
    container = await bootstrap();

    // Resolve services (async factories require resolve())
    const loggerResult = await container.resolve<Logger>('logger');
    const mcpAdapterResult = await container.resolve<MCPAdapter>('mcpAdapter');
    const autoscalerResult = await container.resolve<AutoscalingManager>('autoscalingManager');

    if (!loggerResult.ok || !mcpAdapterResult.ok || !autoscalerResult.ok) {
      console.error('Failed to resolve required services:');
      if (!loggerResult.ok) console.error('  logger:', loggerResult.error.message);
      if (!mcpAdapterResult.ok) console.error('  mcpAdapter:', mcpAdapterResult.error.message);
      if (!autoscalerResult.ok) console.error('  autoscalingManager:', autoscalerResult.error.message);
      process.exit(1);
    }

    const logger = loggerResult.value;
    const mcpAdapter = mcpAdapterResult.value;
    autoscaler = autoscalerResult.value;

    // All logs go to stderr to keep stdout clean for MCP protocol
    logger.info(`Starting Claudine MCP Server v${pkg.version}`);

    // Start autoscaling
    autoscaler.start();
    logger.info('Autoscaling enabled');

    // Create and start MCP server
    const transport = new StdioServerTransport();
    const server = mcpAdapter.getServer();

    await server.connect(transport);
    logger.info('MCP server connected');

    // Handle shutdown gracefully
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);

      // Stop autoscaling
      if (autoscaler) {
        autoscaler.stop();
      }

      // Kill all workers
      const workerPoolResult = container?.get('workerPool');
      if (workerPoolResult?.ok) {
        await (workerPoolResult.value as WorkerPool).killAll();
      }

      // Close server
      await server.close();

      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Log ready state
    logger.info('Claudine is ready', {
      autoscaling: true,
      cpuThreshold: process.env.CPU_THRESHOLD || '80',
      memoryReserve: process.env.MEMORY_RESERVE || '1GB',
    });

    // Keep process alive
    process.stdin.resume();

  } catch (error) {
    console.error('Failed to start server:', error);
    
    // Clean up if startup failed
    if (autoscaler) {
      autoscaler.stop();
    }
    
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };