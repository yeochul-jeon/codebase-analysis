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

  getOrCreateRepo(name: string, defaultBranch?: string): Promise<DbRepo>;

  // ── Index lifecycle (ADR-010 idempotency) ─────────────────────────────────

  /**
   * Returns existing index for (repoId, commitSha) or undefined.
   * Callers implement ADR-010: if status is 'ready', reuse; if 'uploading'/'failed', replace.
   */
  getIndex(repoId: number, commitSha: string): Promise<DbIndex | undefined>;

  /** Look up an index by its primary key. */
  getIndexById(indexId: number): Promise<DbIndex | undefined>;

  createIndex(repoId: number, commitSha: string, branch?: string): Promise<DbIndex>;

  /** Delete symbols + occurrences for an index to allow full replace (ADR-010). */
  deleteIndexData(indexId: number): Promise<void>;

  /** Reset status to 'uploading' for an existing uploading/failed index (ADR-010 replay). */
  resetIndexToUploading(indexId: number): Promise<void>;

  markIndexReady(indexId: number, fileCount: number): Promise<void>;
  markIndexFailed(indexId: number): Promise<void>;

  /** Upsert repo_head row (ADR-009). */
  updateRepoHead(repoId: number, branch: string, indexId: number): Promise<void>;

  // ── Write (analyze push, via REST in Session 5) ───────────────────────────

  insertSymbols(symbols: DbSymbol[]): Promise<void>;
  insertOccurrences(occurrences: DbOccurrence[]): Promise<void>;

  // ── Read (MCP / REST, Session 5+) ─────────────────────────────────────────

  searchSymbols(repoId: number, commitSha: string, query: string, limit?: number): Promise<DbSymbol[]>;
  getSymbolByKey(symbolKey: string): Promise<DbSymbol | undefined>;
  getFileSymbols(repoId: number, commitSha: string, filePath: string): Promise<DbSymbol[]>;
  getOccurrences(calleeName: string, repoId: number, commitSha: string): Promise<DbOccurrence[]>;

  /** Read-only repo lookup — does not create. */
  getRepoByName(name: string): Promise<DbRepo | undefined>;
  /** Look up the latest index_id for a repo+branch (ADR-009). */
  getRepoHead(repoId: number, branch: string): Promise<{ index_id: number } | undefined>;
  /** List distinct file paths that have at least one symbol in an index. */
  getFilesByIndex(indexId: number): Promise<string[]>;
  /** Fallback: most recent ready index for a repo (used when default_branch head is missing). */
  getLatestReadyIndex(repoId: number): Promise<DbIndex | undefined>;

  close(): Promise<void>;
}
