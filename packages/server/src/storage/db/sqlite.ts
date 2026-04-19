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

  getOrCreateRepo(name: string, defaultBranch = 'main'): DbRepo {
    this.db
      .prepare('INSERT OR IGNORE INTO repos(name, default_branch) VALUES (?, ?)')
      .run(name, defaultBranch);
    return this.db.prepare('SELECT * FROM repos WHERE name = ?').get(name) as DbRepo;
  }

  // ── Index lifecycle ────────────────────────────────────────────────────────

  getIndex(repoId: number, commitSha: string): DbIndex | undefined {
    return this.db
      .prepare('SELECT * FROM indexes WHERE repo_id = ? AND commit_sha = ?')
      .get(repoId, commitSha) as DbIndex | undefined;
  }

  createIndex(repoId: number, commitSha: string, branch?: string): DbIndex {
    const result = this.db
      .prepare('INSERT INTO indexes(repo_id, commit_sha, branch) VALUES (?, ?, ?) RETURNING *')
      .get(repoId, commitSha, branch ?? null) as DbIndex;
    return result;
  }

  deleteIndexData(indexId: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM occurrences WHERE index_id = ?').run(indexId);
      this.db.prepare('DELETE FROM symbols WHERE index_id = ?').run(indexId);
    })();
  }

  markIndexReady(indexId: number, fileCount: number): void {
    this.db
      .prepare("UPDATE indexes SET status = 'ready', file_count = ? WHERE id = ?")
      .run(fileCount, indexId);
  }

  markIndexFailed(indexId: number): void {
    this.db
      .prepare("UPDATE indexes SET status = 'failed' WHERE id = ?")
      .run(indexId);
  }

  updateRepoHead(repoId: number, branch: string, indexId: number): void {
    this.db
      .prepare('INSERT OR REPLACE INTO repo_head(repo_id, branch, index_id) VALUES (?, ?, ?)')
      .run(repoId, branch, indexId);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  insertSymbols(symbols: DbSymbol[]): void {
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

  insertOccurrences(occurrences: DbOccurrence[]): void {
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

  searchSymbols(repoId: number, commitSha: string, query: string, limit = 20): DbSymbol[] {
    const idx = this.getIndex(repoId, commitSha);
    if (!idx) return [];
    return this.db.prepare(`
      SELECT s.*
      FROM symbols s
      WHERE s.id IN (SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ?)
        AND s.index_id = ?
      LIMIT ?
    `).all(`${query}*`, idx.id, limit) as DbSymbol[];
  }

  getSymbolByKey(symbolKey: string): DbSymbol | undefined {
    return this.db
      .prepare('SELECT * FROM symbols WHERE symbol_key = ?')
      .get(symbolKey) as DbSymbol | undefined;
  }

  getFileSymbols(repoId: number, commitSha: string, filePath: string): DbSymbol[] {
    const idx = this.getIndex(repoId, commitSha);
    if (!idx) return [];
    return this.db
      .prepare('SELECT * FROM symbols WHERE index_id = ? AND file_path = ?')
      .all(idx.id, filePath) as DbSymbol[];
  }

  getOccurrences(calleeName: string, repoId: number, commitSha: string): DbOccurrence[] {
    const idx = this.getIndex(repoId, commitSha);
    if (!idx) return [];
    return this.db
      .prepare('SELECT * FROM occurrences WHERE callee_name = ? AND index_id = ?')
      .all(calleeName, idx.id) as DbOccurrence[];
  }

  close(): void {
    this.db.close();
  }
}
