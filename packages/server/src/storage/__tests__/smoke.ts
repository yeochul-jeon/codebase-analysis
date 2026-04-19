import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobAdapter } from '../blob/fs.js';
import { SqliteAdapter } from '../db/sqlite.js';
import { runBlobContract, runDbContract } from './contract.js';

const tmpDb = join(tmpdir(), `ca-storage-smoke-${Date.now()}.db`);
const tmpBlob = join(tmpdir(), `ca-storage-blobs-${Date.now()}`);

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean): void {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.error(`✗ ${label}`); fail++; }
}

try {
  const { repoId, indexId } = await runDbContract(check, () => new SqliteAdapter(tmpDb));
  await runBlobContract(check, () => new FsBlobAdapter(tmpBlob), { repoId, indexId });
} finally {
  try { rmSync(tmpDb); } catch {}
  try { rmSync(tmpBlob, { recursive: true }); } catch {}
}

console.log(`\nStorage smoke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
