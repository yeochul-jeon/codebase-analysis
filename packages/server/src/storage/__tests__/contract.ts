import AdmZip from 'adm-zip';
import type { BlobAdapter } from '../blob/types.js';
import type { DbAdapter } from '../db/types.js';

export type CheckFn = (label: string, cond: boolean) => void;

export async function runDbContract(
  check: CheckFn,
  makeDb: () => DbAdapter,
): Promise<{ repoId: number; indexId: number }> {
  const db = makeDb();

  const repo = await db.getOrCreateRepo('my-service', 'main');
  check('getOrCreateRepo returns name', repo.name === 'my-service');
  check('getOrCreateRepo idempotent', (await db.getOrCreateRepo('my-service')).id === repo.id);

  const idx = await db.createIndex(repo.id, 'abc123', 'main');
  check('createIndex status=uploading', idx.status === 'uploading');

  await db.insertSymbols([{
    index_id: idx.id, symbol_key: 'key001', file_path: 'src/Foo.ts',
    name: 'Foo', kind: 'class', signature: null, parent_key: null,
    start_line: 1, end_line: 10, modifiers: null, annotations: null,
  }]);
  await db.insertOccurrences([{
    index_id: idx.id, caller_key: null, callee_name: 'Bar',
    kind: 'call', file_path: 'src/Foo.ts', line: 5,
  }]);

  await db.markIndexReady(idx.id, 1);
  await db.updateRepoHead(repo.id, 'main', idx.id);

  const found = await db.getIndex(repo.id, 'abc123');
  check('getIndex after markReady', found?.status === 'ready');

  const ftsResults = await db.searchSymbols(repo.id, 'abc123', 'Foo');
  check('FTS search returns 1 result', ftsResults.length === 1);
  check('FTS result name=Foo', ftsResults[0]?.name === 'Foo');

  check('getSymbolByKey found', (await db.getSymbolByKey('key001'))?.name === 'Foo');
  check('getFileSymbols length=1', (await db.getFileSymbols(repo.id, 'abc123', 'src/Foo.ts')).length === 1);
  check('getOccurrences callee=Bar', (await db.getOccurrences('Bar', repo.id, 'abc123')).length === 1);

  await db.deleteIndexData(idx.id);
  check('FTS cleared after deleteIndexData', (await db.searchSymbols(repo.id, 'abc123', 'Foo')).length === 0);

  await db.close();
  return { repoId: repo.id, indexId: idx.id };
}

export async function runBlobContract(
  check: CheckFn,
  makeBlob: () => BlobAdapter,
  fixture: { repoId: number; indexId: number },
): Promise<void> {
  const { repoId, indexId } = fixture;

  const zip = new AdmZip();
  zip.addFile('src/main.ts', Buffer.from('export const x = 1;'));
  const zipBuf = zip.toBuffer();

  const blob = makeBlob();

  await blob.saveBlob(repoId, indexId, zipBuf);
  check('hasBlob true after save', await blob.hasBlob(repoId, indexId));
  check('hasBlob false for missing', !(await blob.hasBlob(999, 999)));

  const entry = await blob.getEntry(repoId, indexId, 'src/main.ts');
  check('getEntry returns content', entry?.toString() === 'export const x = 1;');

  const missing = await blob.getEntry(repoId, indexId, 'nonexistent.ts');
  check('getEntry undefined for nonexistent entry', missing === undefined);
}
