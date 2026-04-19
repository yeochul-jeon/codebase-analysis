import AdmZip from 'adm-zip';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobAdapter } from '../../../server/src/storage/blob/fs.js';
import { SqliteAdapter } from '../../../server/src/storage/db/sqlite.js';
import { createApp } from '../../../server/src/app.js';
import { ServerClient } from '../client.js';
import { tools } from '../tools/index.js';
import type { PackedIndex } from '@codebase-analysis/shared';

const TOKEN = 'test-token';
const tmpBlob = mkdtempSync(join(tmpdir(), 'ca-mcp-smoke-'));

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean): void {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.error(`✗ ${label}`); fail++; }
}

try {
  // ─── Setup: seed fixture via in-process server ──────────────────────────────
  const db = new SqliteAdapter(':memory:');
  const blob = new FsBlobAdapter(tmpBlob);
  const app = createApp({ db, blob, uploadToken: TOKEN });
  const bearerHeader = { Authorization: `Bearer ${TOKEN}` };

  const symbolKey = 'b'.repeat(64);
  const packedIndex: PackedIndex = {
    schema_version: 1,
    repo_name: 'mcp-demo',
    commit_sha: 'def456',
    branch: 'main',
    generated_at: Math.floor(Date.now() / 1000),
    symbols: [{
      symbol_key: symbolKey,
      parent_key: null,
      file_path: 'src/hello.ts',
      name: 'hello',
      kind: 'function',
      signature: 'hello(): void',
      start_line: 1,
      end_line: 3,
      modifiers: ['export'],
      annotations: [],
    }],
    occurrences: [{
      caller_key: null,
      callee_name: 'hello',
      kind: 'call',
      file_path: 'src/hello.ts',
      line: 5,
    }],
    files: ['src/hello.ts'],
  };

  const createRes = await app.request('/v1/repos/mcp-demo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'def456', branch: 'main' }),
  });
  const { index_id: indexId } = await createRes.json() as { index_id: number };

  await app.request(`/v1/indexes/${indexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(packedIndex),
  });

  const zip = new AdmZip();
  zip.addFile('src/hello.ts', Buffer.from('export function hello() {}\n// call\nhello();\n', 'utf8'));
  await app.request(`/v1/indexes/${indexId}/source-zip`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/octet-stream' },
    body: zip.toBuffer(),
  });

  await app.request(`/v1/indexes/${indexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });

  // ─── In-process fetch shim ──────────────────────────────────────────────────
  const inProcessFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    return app.request(path, init as Parameters<typeof app.request>[1]);
  };

  const client = new ServerClient('http://localhost', { fetchImpl: inProcessFetch as typeof fetch });

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // ─── search_symbols happy path ──────────────────────────────────────────────
  const searchResult = await toolMap.get('search_symbols')!.handler(
    { q: 'hello', repo: 'mcp-demo', commit: 'def456' },
    client,
  );
  const searchData = JSON.parse(searchResult.content[0].text) as { symbols: { name: string }[] };
  check('search_symbols returns content', searchResult.content.length === 1);
  check('search_symbols finds hello', searchData.symbols.some((s) => s.name === 'hello'));

  // ─── search_symbols error: unknown repo ────────────────────────────────────
  let searchErr: Error | undefined;
  try {
    await toolMap.get('search_symbols')!.handler({ q: 'x', repo: 'ghost' }, client);
  } catch (e) { searchErr = e as Error; }
  check('search_symbols unknown repo throws', searchErr !== undefined);

  // ─── get_symbol_body happy path ─────────────────────────────────────────────
  const bodyResult = await toolMap.get('get_symbol_body')!.handler({ symbol_key: symbolKey }, client);
  const bodyData = JSON.parse(bodyResult.content[0].text) as { body: string };
  check('get_symbol_body returns content', bodyResult.content.length === 1);
  check('get_symbol_body has body string', typeof bodyData.body === 'string' && bodyData.body.length > 0);

  // ─── get_symbol_body error: invalid hex ────────────────────────────────────
  let bodyErr: Error | undefined;
  try {
    await toolMap.get('get_symbol_body')!.handler({ symbol_key: 'not-hex' }, client);
  } catch (e) { bodyErr = e as Error; }
  check('get_symbol_body invalid key throws', bodyErr !== undefined);

  // ─── get_references happy path ──────────────────────────────────────────────
  // fixture callee_name='hello' matches symbol.name='hello' → occurrences ≥ 1
  const refsResult = await toolMap.get('get_references')!.handler({ symbol_key: symbolKey }, client);
  const refsData = JSON.parse(refsResult.content[0].text) as { occurrences: unknown[] };
  check('get_references returns content', refsResult.content.length === 1);
  check('get_references occurrences array', Array.isArray(refsData.occurrences));

  // ─── get_references error: absent key ──────────────────────────────────────
  let refsErr: Error | undefined;
  try {
    await toolMap.get('get_references')!.handler({ symbol_key: '0'.repeat(64) }, client);
  } catch (e) { refsErr = e as Error; }
  check('get_references absent key throws', refsErr !== undefined);

  // ─── get_file_overview happy path ──────────────────────────────────────────
  const overviewResult = await toolMap.get('get_file_overview')!.handler(
    { repo: 'mcp-demo', path: 'src/hello.ts', commit: 'def456' },
    client,
  );
  const overviewData = JSON.parse(overviewResult.content[0].text) as { symbols: { name: string }[] };
  check('get_file_overview returns content', overviewResult.content.length === 1);
  check('get_file_overview finds hello', overviewData.symbols.some((s) => s.name === 'hello'));

  // ─── get_file_overview error: unknown repo ─────────────────────────────────
  let overviewErr: Error | undefined;
  try {
    await toolMap.get('get_file_overview')!.handler({ repo: 'ghost', path: 'src/hello.ts' }, client);
  } catch (e) { overviewErr = e as Error; }
  check('get_file_overview unknown repo throws', overviewErr !== undefined);

  db.close();
} finally {
  rmSync(tmpBlob, { recursive: true, force: true });
}

console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
