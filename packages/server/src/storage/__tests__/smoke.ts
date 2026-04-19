import AdmZip from 'adm-zip';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobAdapter } from '../blob/fs.js';
import { SqliteAdapter } from '../db/sqlite.js';

const tmpDb = join(tmpdir(), `ca-storage-smoke-${Date.now()}.db`);
const tmpBlob = join(tmpdir(), `ca-storage-blobs-${Date.now()}`);

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean): void {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.error(`✗ ${label}`); fail++; }
}

try {
  const db = new SqliteAdapter(tmpDb);

  // ── Repo ────────────────────────────────────────────────────────────────────
  const repo = db.getOrCreateRepo('my-service', 'main');
  check('getOrCreateRepo returns name', repo.name === 'my-service');
  check('getOrCreateRepo idempotent', db.getOrCreateRepo('my-service').id === repo.id);

  // ── Index lifecycle ──────────────────────────────────────────────────────────
  const idx = db.createIndex(repo.id, 'abc123', 'main');
  check('createIndex status=uploading', idx.status === 'uploading');

  db.insertSymbols([{
    index_id: idx.id, symbol_key: 'key001', file_path: 'src/Foo.ts',
    name: 'Foo', kind: 'class', signature: null, parent_key: null,
    start_line: 1, end_line: 10, modifiers: null, annotations: null,
  }]);
  db.insertOccurrences([{
    index_id: idx.id, caller_key: null, callee_name: 'Bar',
    kind: 'call', file_path: 'src/Foo.ts', line: 5,
  }]);

  db.markIndexReady(idx.id, 1);
  db.updateRepoHead(repo.id, 'main', idx.id);

  const found = db.getIndex(repo.id, 'abc123');
  check('getIndex after markReady', found?.status === 'ready');

  // ── FTS (symbols_ai + symbols_ad triggers) ──────────────────────────────────
  const ftsResults = db.searchSymbols(repo.id, 'abc123', 'Foo');
  check('FTS search returns 1 result', ftsResults.length === 1);
  check('FTS result name=Foo', ftsResults[0]?.name === 'Foo');

  // ── Point reads ─────────────────────────────────────────────────────────────
  check('getSymbolByKey found', db.getSymbolByKey('key001')?.name === 'Foo');
  check('getFileSymbols length=1', db.getFileSymbols(repo.id, 'abc123', 'src/Foo.ts').length === 1);
  check('getOccurrences callee=Bar', db.getOccurrences('Bar', repo.id, 'abc123').length === 1);

  // ── deleteIndexData clears FTS (symbols_ad trigger) ─────────────────────────
  db.deleteIndexData(idx.id);
  check('FTS cleared after deleteIndexData', db.searchSymbols(repo.id, 'abc123', 'Foo').length === 0);

  db.close();

  // ── BlobAdapter ─────────────────────────────────────────────────────────────
  const zip = new AdmZip();
  zip.addFile('src/main.ts', Buffer.from('export const x = 1;'));
  const zipBuf = zip.toBuffer();

  const blob = new FsBlobAdapter(tmpBlob);

  await blob.saveBlob(repo.id, idx.id, zipBuf);
  check('hasBlob true after save', await blob.hasBlob(repo.id, idx.id));
  check('hasBlob false for missing', !(await blob.hasBlob(999, 999)));

  const entry = await blob.getEntry(repo.id, idx.id, 'src/main.ts');
  check('getEntry returns content', entry?.toString() === 'export const x = 1;');

  const missing = await blob.getEntry(repo.id, idx.id, 'nonexistent.ts');
  check('getEntry undefined for nonexistent entry', missing === undefined);

} finally {
  try { rmSync(tmpDb); } catch {}
  try { rmSync(tmpBlob, { recursive: true }); } catch {}
}

console.log(`\nStorage smoke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
