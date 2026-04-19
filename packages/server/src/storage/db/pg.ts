// Variant B stub — PostgreSQL implementation of DbAdapter (ADR-015, ADR-021).
// Not yet implemented. Activate when migrating from SQLite to PostgreSQL.
import type {
  DbAdapter, DbRepo, DbIndex, DbSymbol, DbOccurrence,
} from './types.js';

function notImplemented(method: string): never {
  throw new Error(`PgAdapter.${method}: Variant B not implemented`);
}

export class PgAdapter implements DbAdapter {
  getOrCreateRepo(_name: string, _defaultBranch?: string): DbRepo { notImplemented('getOrCreateRepo'); }
  getIndex(_repoId: number, _commitSha: string): DbIndex | undefined { notImplemented('getIndex'); }
  getIndexById(_indexId: number): DbIndex | undefined { notImplemented('getIndexById'); }
  createIndex(_repoId: number, _commitSha: string, _branch?: string): DbIndex { notImplemented('createIndex'); }
  deleteIndexData(_indexId: number): void { notImplemented('deleteIndexData'); }
  resetIndexToUploading(_indexId: number): void { notImplemented('resetIndexToUploading'); }
  markIndexReady(_indexId: number, _fileCount: number): void { notImplemented('markIndexReady'); }
  markIndexFailed(_indexId: number): void { notImplemented('markIndexFailed'); }
  updateRepoHead(_repoId: number, _branch: string, _indexId: number): void { notImplemented('updateRepoHead'); }
  insertSymbols(_symbols: DbSymbol[]): void { notImplemented('insertSymbols'); }
  insertOccurrences(_occurrences: DbOccurrence[]): void { notImplemented('insertOccurrences'); }
  searchSymbols(_repoId: number, _commitSha: string, _query: string, _limit?: number): DbSymbol[] { notImplemented('searchSymbols'); }
  getSymbolByKey(_symbolKey: string): DbSymbol | undefined { notImplemented('getSymbolByKey'); }
  getFileSymbols(_repoId: number, _commitSha: string, _filePath: string): DbSymbol[] { notImplemented('getFileSymbols'); }
  getOccurrences(_calleeName: string, _repoId: number, _commitSha: string): DbOccurrence[] { notImplemented('getOccurrences'); }
  getRepoByName(_name: string): DbRepo | undefined { notImplemented('getRepoByName'); }
  getRepoHead(_repoId: number, _branch: string): { index_id: number } | undefined { notImplemented('getRepoHead'); }
  getFilesByIndex(_indexId: number): string[] { notImplemented('getFilesByIndex'); }
  close(): void { /* no-op for connection pool teardown placeholder */ }
}
