#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ServerClient } from './client.js';
import { tools } from './tools/index.js';

const serverUrl = process.env['ANALYZE_SERVER_URL'] ?? 'http://localhost:3000';
const client = new ServerClient(serverUrl);

const server = new Server(
  { name: 'codebase-analysis', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  return tool.handler(req.params.arguments ?? {}, client);
});

const transport = new StdioServerTransport();
await server.connect(transport);
