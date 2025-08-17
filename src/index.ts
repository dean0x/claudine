#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClaudineServer } from './server.js';

async function main() {
  console.error('Claudine MCP Server starting...');
  
  try {
    const server = new ClaudineServer();
    const transport = new StdioServerTransport();
    
    await server.connect(transport);
    console.error('Claudine MCP Server running');
  } catch (error) {
    console.error('Failed to start Claudine MCP Server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});