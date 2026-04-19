import type { ServerClient } from '../client.js';

type ToolContent = { content: Array<{ type: 'text'; text: string }> };
type JsonSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: unknown, client: ServerClient) => Promise<ToolContent>;
}

function textResult(data: unknown): ToolContent {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export const tools: ToolDef[] = [
  {
    name: 'search_symbols',
    description: 'Search for symbols (functions, classes, methods) in the indexed codebase using a text query. Returns a list of matching symbols with their locations.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query', minLength: 1 },
        repo: { type: 'string', description: 'Repository name', minLength: 1 },
        commit: { type: 'string', description: 'Commit SHA or branch name (optional, defaults to HEAD)' },
        limit: { type: 'integer', description: 'Max results (1–100, default 20)', minimum: 1, maximum: 100 },
      },
      required: ['q', 'repo'],
    },
    async handler(args, client) {
      const { q, repo, commit, limit } = args as { q: string; repo: string; commit?: string; limit?: number };
      const result = await client.search({ q, repo, commit, limit });
      return textResult(result);
    },
  },
  {
    name: 'get_symbol_body',
    description: 'Retrieve the source code body of a specific symbol by its 64-character hex key.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol_key: { type: 'string', description: '64-character hex symbol key', pattern: '^[0-9a-f]{64}$' },
      },
      required: ['symbol_key'],
    },
    async handler(args, client) {
      const { symbol_key } = args as { symbol_key: string };
      const result = await client.getSymbolBody(symbol_key);
      return textResult(result);
    },
  },
  {
    name: 'get_references',
    description: 'Get all call-site occurrences for a symbol by its 64-character hex key. NOTE: based on tree-sitter name matching — may include unrelated calls with the same callee name (ADR-002).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol_key: { type: 'string', description: '64-character hex symbol key', pattern: '^[0-9a-f]{64}$' },
      },
      required: ['symbol_key'],
    },
    async handler(args, client) {
      const { symbol_key } = args as { symbol_key: string };
      const result = await client.getReferences(symbol_key);
      return textResult(result);
    },
  },
  {
    name: 'get_file_overview',
    description: 'List all symbols defined in a specific file, providing an overview of its structure.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository name', minLength: 1 },
        path: { type: 'string', description: 'File path within the repository', minLength: 1 },
        commit: { type: 'string', description: 'Commit SHA or branch name (optional, defaults to HEAD)' },
      },
      required: ['repo', 'path'],
    },
    async handler(args, client) {
      const { repo, path, commit } = args as { repo: string; path: string; commit?: string };
      const result = await client.getFileSymbols({ repo, path, commit });
      return textResult(result);
    },
  },
];
