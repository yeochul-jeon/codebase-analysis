import AdmZip from 'adm-zip';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobAdapter } from '../../storage/blob/fs.js';
import { SqliteAdapter } from '../../storage/db/sqlite.js';
import { createApp } from '../../app.js';
import type { PackedIndex } from '@codebase-analysis/shared';

const TOKEN = 'test-token';
const tmpBlob = mkdtempSync(join(tmpdir(), 'ca-routes-smoke-'));

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean): void {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.error(`✗ ${label}`); fail++; }
}

try {
  const db = new SqliteAdapter(':memory:');
  const blob = new FsBlobAdapter(tmpBlob);
  const app = createApp({ db, blob, uploadToken: TOKEN });

  const bearerHeader = { Authorization: `Bearer ${TOKEN}` };

  // ─── 1. Create index ────────────────────────────────────────────────────────

  const createRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'abc123', branch: 'main' }),
  });
  check('POST /v1/repos/demo/indexes → 200', createRes.status === 200);
  const createBody = await createRes.json() as { index_id: number; status: string };
  check('response has index_id', typeof createBody.index_id === 'number');
  check('status is uploading', createBody.status === 'uploading');

  const indexId = createBody.index_id;

  // ─── 2. Upload index-json ───────────────────────────────────────────────────

  const symbolKey = 'a'.repeat(64);
  const packedIndex: PackedIndex = {
    schema_version: 1,
    repo_name: 'demo',
    commit_sha: 'abc123',
    branch: 'main',
    generated_at: Math.floor(Date.now() / 1000),
    symbols: [{
      symbol_key: symbolKey,
      parent_key: null,
      file_path: 'src/index.ts',
      name: 'greet',
      kind: 'function',
      signature: 'greet(name: string): string',
      start_line: 1,
      end_line: 3,
      modifiers: ['export'],
      annotations: [],
    }],
    occurrences: [{
      caller_key: null,
      callee_name: 'console',
      kind: 'call',
      file_path: 'src/index.ts',
      line: 2,
    }],
    files: ['src/index.ts'],
  };

  const jsonRes = await app.request(`/v1/indexes/${indexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(packedIndex),
  });
  check('PUT /index-json → 200', jsonRes.status === 200);
  const jsonBody = await jsonRes.json() as { symbol_count: number; occurrence_count: number };
  check('symbol_count is 1', jsonBody.symbol_count === 1);
  check('occurrence_count is 1', jsonBody.occurrence_count === 1);

  const missingIndexJsonRes = await app.request('/v1/indexes/999/index-json', {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(packedIndex),
  });
  check('PUT /index-json nonexistent index → 404', missingIndexJsonRes.status === 404);

  const mismatchedRepoRes = await app.request(`/v1/indexes/${indexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...packedIndex, repo_name: 'other-repo' }),
  });
  check('PUT /index-json repo mismatch → 409', mismatchedRepoRes.status === 409);

  const mismatchedCommitRes = await app.request(`/v1/indexes/${indexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...packedIndex, commit_sha: 'zzz999' }),
  });
  check('PUT /index-json commit mismatch → 409', mismatchedCommitRes.status === 409);

  const mismatchedBranchRes = await app.request(`/v1/indexes/${indexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...packedIndex, branch: 'release' }),
  });
  check('PUT /index-json branch mismatch → 409', mismatchedBranchRes.status === 409);

  // ─── 3. Upload source-zip ───────────────────────────────────────────────────

  const zip = new AdmZip();
  zip.addFile('src/index.ts', Buffer.from('export function greet() {}', 'utf8'));
  const zipBuf = zip.toBuffer();

  const zipRes = await app.request(`/v1/indexes/${indexId}/source-zip`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/octet-stream' },
    body: zipBuf,
  });
  check('PUT /source-zip → 200', zipRes.status === 200);
  const zipBody = await zipRes.json() as { bytes: number };
  check('bytes matches zip size', zipBody.bytes === zipBuf.byteLength);

  // ─── 4. Finalize (PATCH ready) ──────────────────────────────────────────────

  const patchRes = await app.request(`/v1/indexes/${indexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });
  check('PATCH /indexes/:id → 200', patchRes.status === 200);
  const patchBody = await patchRes.json() as { status: string };
  check('patched status is ready', patchBody.status === 'ready');

  const patchReplayRes = await app.request(`/v1/indexes/${indexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });
  check('PATCH /indexes/:id replay after ready → 409', patchReplayRes.status === 409);

  const patchMissingRes = await app.request('/v1/indexes/999', {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });
  check('PATCH /indexes/:id nonexistent → 404', patchMissingRes.status === 404);

  const emptyCreateRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'empty123', branch: 'main' }),
  });
  const { index_id: emptyIndexId } = await emptyCreateRes.json() as { index_id: number };
  const emptyPatchRes = await app.request(`/v1/indexes/${emptyIndexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 0 }),
  });
  check('PATCH /indexes/:id without uploads → 409', emptyPatchRes.status === 409);

  const jsonOnlyCreateRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'jsononly123', branch: 'main' }),
  });
  const { index_id: jsonOnlyIndexId } = await jsonOnlyCreateRes.json() as { index_id: number };
  await app.request(`/v1/indexes/${jsonOnlyIndexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...packedIndex,
      commit_sha: 'jsononly123',
      symbols: [{
        ...packedIndex.symbols[0],
        symbol_key: 'b'.repeat(64),
        name: 'jsonOnly',
      }],
      files: ['src/index.ts'],
    } satisfies PackedIndex),
  });
  const jsonOnlyPatchRes = await app.request(`/v1/indexes/${jsonOnlyIndexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });
  check('PATCH /indexes/:id with json only → 409', jsonOnlyPatchRes.status === 409);

  const zipOnlyCreateRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'ziponly123', branch: 'main' }),
  });
  const { index_id: zipOnlyIndexId } = await zipOnlyCreateRes.json() as { index_id: number };
  await app.request(`/v1/indexes/${zipOnlyIndexId}/source-zip`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/octet-stream' },
    body: zipBuf,
  });
  const zipOnlyPatchRes = await app.request(`/v1/indexes/${zipOnlyIndexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });
  check('PATCH /indexes/:id with zip only → 409', zipOnlyPatchRes.status === 409);

  // ─── 5. Verify adapter state ────────────────────────────────────────────────

  const sym = await db.getSymbolByKey(symbolKey);
  check('symbol persisted in DB', sym !== undefined);
  check('symbol name is greet', sym?.name === 'greet');

  const idx = await db.getIndexById(indexId);
  check('index status is ready', idx?.status === 'ready');
  check('index file_count is 1', idx?.file_count === 1);

  const blobExists = await blob.hasBlob(idx!.repo_id, indexId);
  check('blob saved to FS', blobExists === true);

  // ─── 6. Idempotency: same commit → 409 ─────────────────────────────────────

  const replayRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'abc123', branch: 'main' }),
  });
  check('replay same commit → 409', replayRes.status === 409);
  const replayBody = await replayRes.json() as { status: string };
  check('409 body has status ready', replayBody.status === 'ready');

  // ─── 7. Auth rejection ──────────────────────────────────────────────────────

  const noAuthRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'xyz999', branch: 'main' }),
  });
  check('missing Bearer → 401', noAuthRes.status === 401);

  const wrongAuthRes = await app.request('/v1/repos/demo/indexes', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'xyz999', branch: 'main' }),
  });
  check('wrong token → 401', wrongAuthRes.status === 401);

  // ─── 8. Healthz (no auth required) ─────────────────────────────────────────

  const healthRes = await app.request('/healthz');
  check('GET /healthz → 200 without auth', healthRes.status === 200);

  // ─── 9. GET /v1/search ─────────────────────────────────────────────────────

  const searchRes = await app.request('/v1/search?q=greet&repo=demo&commit=abc123');
  check('GET /v1/search → 200', searchRes.status === 200);
  const searchBody = await searchRes.json() as { symbols: { name: string }[] };
  check('search finds greet', searchBody.symbols.some((s) => s.name === 'greet'));

  // q=src matches file_path "src/index.ts" — must NOT return results via path hit
  const searchPathRes = await app.request('/v1/search?q=src&repo=demo&commit=abc123');
  check('GET /v1/search q=src (path prefix) → 0 results (name-only FTS)', searchPathRes.status === 200);
  const searchPathBody = await searchPathRes.json() as { symbols: unknown[] };
  check('search q=src returns no symbols (not a name)', searchPathBody.symbols.length === 0);

  // injection attempt: special FTS5 chars in q → 400 from zod regex
  const searchInjectRes = await app.request('/v1/search?q=foo)OR(file_path:bar*&repo=demo&commit=abc123');
  check('GET /v1/search injection attempt → 400', searchInjectRes.status === 400);

  const searchMissingRes = await app.request('/v1/search?q=x&repo=unknown');
  check('GET /v1/search unknown repo → 404', searchMissingRes.status === 404);

  const searchBadRes = await app.request('/v1/search?repo=demo');
  check('GET /v1/search missing q → 400', searchBadRes.status === 400);

  // ─── 10. GET /v1/symbols/:key ───────────────────────────────────────────────

  const symRes = await app.request(`/v1/symbols/${symbolKey}`);
  check('GET /v1/symbols/:key → 200', symRes.status === 200);
  const symBody = await symRes.json() as { symbol: { symbol_key: string } };
  check('symbol_key matches', symBody.symbol.symbol_key === symbolKey);

  const symBadRes = await app.request('/v1/symbols/not-a-hex');
  check('GET /v1/symbols/not-a-hex → 400', symBadRes.status === 400);

  const symMissingRes = await app.request(`/v1/symbols/${'0'.repeat(64)}`);
  check('GET /v1/symbols/unknown-key → 404', symMissingRes.status === 404);

  // ─── 11. GET /v1/symbols/:key/body ─────────────────────────────────────────

  const bodyRes = await app.request(`/v1/symbols/${symbolKey}/body`);
  check('GET /v1/symbols/:key/body → 200', bodyRes.status === 200);
  const bodyData = await bodyRes.json() as { body: string; start_line: number; end_line: number };
  check('body is non-empty', typeof bodyData.body === 'string' && bodyData.body.length > 0);
  check('body start_line is 1', bodyData.start_line === 1);

  // ─── 12. GET /v1/repos/:name/files ─────────────────────────────────────────

  const filesRes = await app.request('/v1/repos/demo/files?commit=abc123');
  check('GET /v1/repos/demo/files → 200', filesRes.status === 200);
  const filesBody = await filesRes.json() as { files: string[] };
  check('files includes src/index.ts', filesBody.files.includes('src/index.ts'));

  const filesMissingRes = await app.request('/v1/repos/ghost/files');
  check('GET /v1/repos/ghost/files → 404', filesMissingRes.status === 404);

  // ─── 13. GET /v1/symbols/:key/references ───────────────────────────────────

  const refsRes = await app.request(`/v1/symbols/${symbolKey}/references`);
  check('GET /v1/symbols/:key/references → 200', refsRes.status === 200);
  const refsBody = await refsRes.json() as { symbol_key: string; occurrences: unknown[] };
  check('references has occurrences array', Array.isArray(refsBody.occurrences));

  const refsBadRes = await app.request('/v1/symbols/not-hex/references');
  check('GET /v1/symbols/not-hex/references → 400', refsBadRes.status === 400);

  const refsMissingRes = await app.request(`/v1/symbols/${'0'.repeat(64)}/references`);
  check('GET /v1/symbols/unknown-key/references → 404', refsMissingRes.status === 404);

  // ─── 14. GET /v1/repos/:name/file-symbols ──────────────────────────────────

  const fsRes = await app.request('/v1/repos/demo/file-symbols?path=src/index.ts&commit=abc123');
  check('GET /v1/repos/demo/file-symbols → 200', fsRes.status === 200);
  const fsBody = await fsRes.json() as { symbols: { file_path: string }[] };
  check('file-symbols has symbols', fsBody.symbols.length >= 1);
  check('symbol file_path matches', fsBody.symbols[0]?.file_path === 'src/index.ts');

  const fsEmptyRes = await app.request('/v1/repos/demo/file-symbols?path=nonexistent.ts&commit=abc123');
  check('GET file-symbols nonexistent path → 200 empty', fsEmptyRes.status === 200);
  const fsEmptyBody = await fsEmptyRes.json() as { symbols: unknown[] };
  check('file-symbols nonexistent → empty array', fsEmptyBody.symbols.length === 0);

  const fsBadRes = await app.request('/v1/repos/demo/file-symbols?commit=abc123');
  check('GET file-symbols missing path → 400', fsBadRes.status === 400);

  // ─── 15. BUG-3 regression: non-main branch resolves without explicit commit ─
  // Repos using 'master' (or any branch != 'main') should be discoverable via
  // HEAD lookup (getLatestReadyIndex fallback + corrected getOrCreateRepo branch).

  const masterCreateRes = await app.request('/v1/repos/master-repo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'deadbeef01', branch: 'master' }),
  });
  const { index_id: masterIndexId } = await masterCreateRes.json() as { index_id: number };
  const masterPacked: PackedIndex = {
    ...packedIndex,
    repo_name: 'master-repo',
    commit_sha: 'deadbeef01',
    branch: 'master',
    symbols: [{ ...packedIndex.symbols[0], symbol_key: 'c'.repeat(64), name: 'masterFn', file_path: 'src/master.ts' }],
    files: ['src/master.ts'],
  };
  await app.request(`/v1/indexes/${masterIndexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(masterPacked),
  });
  await app.request(`/v1/indexes/${masterIndexId}/source-zip`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/octet-stream' },
    body: zipBuf,
  });
  await app.request(`/v1/indexes/${masterIndexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });

  const masterSearchRes = await app.request('/v1/search?q=masterFn&repo=master-repo');
  check('GET /v1/search master-branch repo (no commit) → 200', masterSearchRes.status === 200);
  const masterSearchBody = await masterSearchRes.json() as { symbols: { name: string }[] };
  check('master-branch repo search finds masterFn', masterSearchBody.symbols.some((s) => s.name === 'masterFn'));

  const masterFilesRes = await app.request('/v1/repos/master-repo/files');
  check('GET /v1/repos/master-repo/files (no commit) → 200', masterFilesRes.status === 200);
  const masterFilesBody = await masterFilesRes.json() as { files: string[] };
  check('master-branch repo files includes src/master.ts', masterFilesBody.files.includes('src/master.ts'));

  // ─── 16. Refs-only index finalization (BUG-4 regression) ──────────────────
  // A packer may produce files with occurrences but no symbol declarations.
  // The server must be able to finalize and list these indexes.

  const refsOnlyCreateRes = await app.request('/v1/repos/refs-only-repo/indexes', {
    method: 'POST',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commit_sha: 'ref001', branch: 'main' }),
  });
  const { index_id: refsOnlyIndexId } = await refsOnlyCreateRes.json() as { index_id: number };

  const refsOnlyZip = new AdmZip();
  refsOnlyZip.addFile('src/calls.ts', Buffer.from('hello();'));
  const refsOnlyZipBuf = refsOnlyZip.toBuffer();

  await app.request(`/v1/indexes/${refsOnlyIndexId}/index-json`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema_version: 1 as const,
      repo_name: 'refs-only-repo',
      commit_sha: 'ref001',
      branch: 'main',
      generated_at: 0,
      symbols: [],
      occurrences: [{ caller_key: null, callee_name: 'hello', kind: 'call', file_path: 'src/calls.ts', line: 1 }],
      files: ['src/calls.ts'],
    }),
  });
  await app.request(`/v1/indexes/${refsOnlyIndexId}/source-zip`, {
    method: 'PUT',
    headers: { ...bearerHeader, 'Content-Type': 'application/octet-stream' },
    body: refsOnlyZipBuf,
  });
  const refsOnlyPatchRes = await app.request(`/v1/indexes/${refsOnlyIndexId}`, {
    method: 'PATCH',
    headers: { ...bearerHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready', file_count: 1 }),
  });
  check('refs-only index finalizes → 200 (P1 regression)', refsOnlyPatchRes.status === 200);

  const refsOnlyFilesRes = await app.request('/v1/repos/refs-only-repo/files?commit=ref001');
  const refsOnlyFilesBody = await refsOnlyFilesRes.json() as { files: string[] };
  check('refs-only files includes src/calls.ts (P2 regression)', refsOnlyFilesBody.files.includes('src/calls.ts'));

  // ─── 17. Static files ──────────────────────────────────────────────────────

  const indexHtmlRes = await app.request('/');
  check('GET / → 200', indexHtmlRes.status === 200);
  check('GET / content-type html', (indexHtmlRes.headers.get('content-type') ?? '').includes('text/html'));
  const indexHtmlText = await indexHtmlRes.text();
  check('GET / has search-form', indexHtmlText.includes('id="search-form"'));

  const cssRes2 = await app.request('/style.css');
  check('GET /style.css → 200', cssRes2.status === 200);

  const jsRes = await app.request('/app.js');
  check('GET /app.js → 200', jsRes.status === 200);

  const sKeyRes = await app.request(`/s/${symbolKey}`);
  check('GET /s/:key → 200 (serves symbol.html)', sKeyRes.status === 200);
  const sKeyText = await sKeyRes.text();
  check('GET /s/:key body is symbol.html', sKeyText.includes('id="sym-name"'));
  check('GET /s/:key has refs disclaimer', sKeyText.includes('id="refs-disclaimer"'));

  // ─── 18. P3 Web UI enhancements ───────────────────────────────────────────

  const filePageRes = await app.request('/f?repo=demo&path=src/index.ts&commit=abc123');
  check('GET /f → 200', filePageRes.status === 200);
  const filePageText = await filePageRes.text();
  check('GET /f has file-symbols', filePageText.includes('id="file-symbols"'));

  const cssResWithCache = await app.request('/style.css');
  const cssCacheControl = cssResWithCache.headers.get('cache-control') ?? '';
  check('GET /style.css Cache-Control has max-age', cssCacheControl.includes('max-age'));
  check('GET /style.css has ETag', cssResWithCache.headers.has('etag'));

  check('GET / has no-cache', (indexHtmlRes.headers.get('cache-control') ?? '').includes('no-cache'));

  const cssEtag = cssResWithCache.headers.get('etag') ?? '';
  const cssConditionalRes = await app.request('/style.css', {
    headers: { 'If-None-Match': cssEtag },
  });
  check('GET /style.css If-None-Match → 304', cssConditionalRes.status === 304);

  await db.close();
} finally {
  rmSync(tmpBlob, { recursive: true, force: true });
}

console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
