export interface DbRepo {
  id: number;
  name: string;
  default_branch: string;
  created_at: number;
}

export interface DbIndex {
  id: number;
  repo_id: number;
  commit_sha: string;
  branch: string | null;
  status: 'uploading' | 'ready' | 'failed';
  file_count: number | null;
  created_at: number;
}

export interface DbSymbol {
  id?: number;
  index_id: number;
  symbol_key: string;
  file_path: string;
  name: string;
  kind: string;
  signature: string | null;
  parent_key: string | null;
  start_line: number;
  end_line: number;
  modifiers: string | null;   // JSON array string
  annotations: string | null; // JSON array string
}

export interface DbOccurrence {
  id?: number;
  index_id: number;
  caller_key: string | null;
  callee_name: string;
  kind: string;
  file_path: string;
  line: number;
}

export interface DbAdapter {
  // ── Repo ──────────────────────────────────────────────────────────────────

  getOrCreateRepo(name: string, defaultBranch?: string): DbRepo;

  // ── Index lifecycle (ADR-010 idempotency) ─────────────────────────────────

  /**
   * Returns existing index for (repoId, commitSha) or undefined.
   * Callers implement ADR-010: if status is 'ready', reuse; if 'uploading'/'failed', replace.
   */
  getIndex(repoId: number, commitSha: string): DbIndex | undefined;

  /** Look up an index by its primary key. */
  getIndexById(indexId: number): DbIndex | undefined;

  createIndex(repoId: number, commitSha: string, branch?: string): DbIndex;

  /** Delete symbols + occurrences for an index to allow full replace (ADR-010). */
  deleteIndexData(indexId: number): void;

  /** Reset status to 'uploading' for an existing uploading/failed index (ADR-010 replay). */
  resetIndexToUploading(indexId: number): void;

  markIndexReady(indexId: number, fileCount: number): void;
  markIndexFailed(indexId: number): void;

  /** Upsert repo_head row (ADR-009). */
  updateRepoHead(repoId: number, branch: string, indexId: number): void;

  // ── Write (analyze push, via REST in Session 5) ───────────────────────────

  insertSymbols(symbols: DbSymbol[]): void;
  insertOccurrences(occurrences: DbOccurrence[]): void;

  // ── Read (MCP / REST, Session 5+) ─────────────────────────────────────────

  searchSymbols(repoId: number, commitSha: string, query: string, limit?: number): DbSymbol[];
  getSymbolByKey(symbolKey: string): DbSymbol | undefined;
  getFileSymbols(repoId: number, commitSha: string, filePath: string): DbSymbol[];
  getOccurrences(calleeName: string, repoId: number, commitSha: string): DbOccurrence[];

  /** Read-only repo lookup — does not create. */
  getRepoByName(name: string): DbRepo | undefined;
  /** Look up the latest index_id for a repo+branch (ADR-009). */
  getRepoHead(repoId: number, branch: string): { index_id: number } | undefined;
  /** List distinct file paths that have at least one symbol in an index. */
  getFilesByIndex(indexId: number): string[];

  close(): void;
}
