import Database from 'better-sqlite3';
import type { DbAdapter, DbIndex, DbOccurrence, DbRepo, DbSymbol } from './types.js';
import { runMigrations } from './migrate.js';

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
  }

  // ── Repo ───────────────────────────────────────────────────────────────────

  async getOrCreateRepo(name: string, defaultBranch = 'main'): Promise<DbRepo> {
    this.db
      .prepare('INSERT OR IGNORE INTO repos(name, default_branch) VALUES (?, ?)')
      .run(name, defaultBranch);
    return this.db.prepare('SELECT * FROM repos WHERE name = ?').get(name) as DbRepo;
  }

  // ── Index lifecycle ────────────────────────────────────────────────────────

  async getIndex(repoId: number, commitSha: string): Promise<DbIndex | undefined> {
    return this.db
      .prepare('SELECT * FROM indexes WHERE repo_id = ? AND commit_sha = ?')
      .get(repoId, commitSha) as DbIndex | undefined;
  }

  async getIndexById(indexId: number): Promise<DbIndex | undefined> {
    return this.db
      .prepare('SELECT * FROM indexes WHERE id = ?')
      .get(indexId) as DbIndex | undefined;
  }

  async createIndex(repoId: number, commitSha: string, branch?: string): Promise<DbIndex> {
    const result = this.db
      .prepare('INSERT INTO indexes(repo_id, commit_sha, branch) VALUES (?, ?, ?) RETURNING *')
      .get(repoId, commitSha, branch ?? null) as DbIndex;
    return result;
  }

  async deleteIndexData(indexId: number): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM occurrences WHERE index_id = ?').run(indexId);
      this.db.prepare('DELETE FROM symbols WHERE index_id = ?').run(indexId);
    })();
  }

  async markIndexReady(indexId: number, fileCount: number): Promise<void> {
    this.db
      .prepare("UPDATE indexes SET status = 'ready', file_count = ? WHERE id = ?")
      .run(fileCount, indexId);
  }

  async markIndexFailed(indexId: number): Promise<void> {
    this.db
      .prepare("UPDATE indexes SET status = 'failed' WHERE id = ?")
      .run(indexId);
  }

  async resetIndexToUploading(indexId: number): Promise<void> {
    this.db
      .prepare("UPDATE indexes SET status = 'uploading', file_count = NULL WHERE id = ?")
      .run(indexId);
  }

  async updateRepoHead(repoId: number, branch: string, indexId: number): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO repo_head(repo_id, branch, index_id) VALUES (?, ?, ?)')
      .run(repoId, branch, indexId);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async insertSymbols(symbols: DbSymbol[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO symbols
        (index_id, symbol_key, file_path, name, kind, signature,
         parent_key, start_line, end_line, modifiers, annotations)
      VALUES
        (@index_id, @symbol_key, @file_path, @name, @kind, @signature,
         @parent_key, @start_line, @end_line, @modifiers, @annotations)
    `);
    const insert = this.db.transaction((rows: DbSymbol[]) => {
      for (const row of rows) stmt.run(row);
    });
    insert(symbols);
  }

  async insertOccurrences(occurrences: DbOccurrence[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO occurrences
        (index_id, caller_key, callee_name, kind, file_path, line)
      VALUES
        (@index_id, @caller_key, @callee_name, @kind, @file_path, @line)
    `);
    const insert = this.db.transaction((rows: DbOccurrence[]) => {
      for (const row of rows) stmt.run(row);
    });
    insert(occurrences);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async searchSymbols(repoId: number, commitSha: string, query: string, limit = 20): Promise<DbSymbol[]> {
    const idx = await this.getIndex(repoId, commitSha);
    if (!idx) return [];
    return this.db.prepare(`
      SELECT s.*
      FROM symbols s
      WHERE s.id IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ?)
        AND s.index_id = ?
      LIMIT ?
    `).all(`name:${query}*`, idx.id, limit) as DbSymbol[];
  }

  async getSymbolByKey(symbolKey: string): Promise<DbSymbol | undefined> {
    return this.db
      .prepare('SELECT * FROM symbols WHERE symbol_key = ?')
      .get(symbolKey) as DbSymbol | undefined;
  }

  async getFileSymbols(repoId: number, commitSha: string, filePath: string): Promise<DbSymbol[]> {
    const idx = await this.getIndex(repoId, commitSha);
    if (!idx) return [];
    return this.db
      .prepare('SELECT * FROM symbols WHERE index_id = ? AND file_path = ?')
      .all(idx.id, filePath) as DbSymbol[];
  }

  async getOccurrences(calleeName: string, repoId: number, commitSha: string): Promise<DbOccurrence[]> {
    const idx = await this.getIndex(repoId, commitSha);
    if (!idx) return [];
    return this.db
      .prepare('SELECT * FROM occurrences WHERE callee_name = ? AND index_id = ?')
      .all(calleeName, idx.id) as DbOccurrence[];
  }

  async getRepoByName(name: string): Promise<DbRepo | undefined> {
    return this.db.prepare('SELECT * FROM repos WHERE name = ?').get(name) as DbRepo | undefined;
  }

  async getRepoHead(repoId: number, branch: string): Promise<{ index_id: number } | undefined> {
    return this.db
      .prepare('SELECT index_id FROM repo_head WHERE repo_id = ? AND branch = ?')
      .get(repoId, branch) as { index_id: number } | undefined;
  }

  async getFilesByIndex(indexId: number): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT file_path FROM symbols WHERE index_id = ?
      UNION
      SELECT DISTINCT file_path FROM occurrences WHERE index_id = ?
      ORDER BY file_path
    `).all(indexId, indexId) as { file_path: string }[];
    return rows.map((r) => r.file_path);
  }

  async getLatestReadyIndex(repoId: number): Promise<DbIndex | undefined> {
    return this.db
      .prepare("SELECT * FROM indexes WHERE repo_id = ? AND status = 'ready' ORDER BY id DESC LIMIT 1")
      .get(repoId) as DbIndex | undefined;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
