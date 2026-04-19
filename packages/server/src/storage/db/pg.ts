// Variant B — PostgreSQL implementation of DbAdapter (ADR-015, ADR-022, ADR-023).
import { Pool } from 'pg';
import type {
  DbAdapter, DbRepo, DbIndex, DbSymbol, DbOccurrence,
} from './types.js';
import { runMigrationsPg } from './migrate-pg.js';

export interface PgAdapterOptions {
  url: string;
}

export class PgAdapter implements DbAdapter {
  private pool: Pool;
  // runMigrationsPg runs once on construction; all methods wait for it
  private ready: Promise<void>;

  constructor(opts: PgAdapterOptions) {
    this.pool = new Pool({ connectionString: opts.url });
    this.ready = runMigrationsPg(this.pool);
  }

  // ── Repo ──────────────────────────────────────────────────────────────────

  async getOrCreateRepo(name: string, defaultBranch = 'main'): Promise<DbRepo> {
    await this.ready;
    await this.pool.query(
      'INSERT INTO repos(name, default_branch) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      [name, defaultBranch],
    );
    const { rows } = await this.pool.query<DbRepo>(
      'SELECT * FROM repos WHERE name = $1',
      [name],
    );
    return rows[0];
  }

  // ── Index lifecycle ────────────────────────────────────────────────────────

  async getIndex(repoId: number, commitSha: string): Promise<DbIndex | undefined> {
    await this.ready;
    const { rows } = await this.pool.query<DbIndex>(
      'SELECT * FROM indexes WHERE repo_id = $1 AND commit_sha = $2',
      [repoId, commitSha],
    );
    return rows[0];
  }

  async getIndexById(indexId: number): Promise<DbIndex | undefined> {
    await this.ready;
    const { rows } = await this.pool.query<DbIndex>(
      'SELECT * FROM indexes WHERE id = $1',
      [indexId],
    );
    return rows[0];
  }

  async createIndex(repoId: number, commitSha: string, branch?: string): Promise<DbIndex> {
    await this.ready;
    const { rows } = await this.pool.query<DbIndex>(
      'INSERT INTO indexes(repo_id, commit_sha, branch) VALUES ($1, $2, $3) RETURNING *',
      [repoId, commitSha, branch ?? null],
    );
    return rows[0];
  }

  async deleteIndexData(indexId: number): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM occurrences WHERE index_id = $1', [indexId]);
      await client.query('DELETE FROM symbols WHERE index_id = $1', [indexId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async markIndexReady(indexId: number, fileCount: number): Promise<void> {
    await this.ready;
    await this.pool.query(
      "UPDATE indexes SET status = 'ready', file_count = $1 WHERE id = $2",
      [fileCount, indexId],
    );
  }

  async markIndexFailed(indexId: number): Promise<void> {
    await this.ready;
    await this.pool.query(
      "UPDATE indexes SET status = 'failed' WHERE id = $1",
      [indexId],
    );
  }

  async resetIndexToUploading(indexId: number): Promise<void> {
    await this.ready;
    await this.pool.query(
      "UPDATE indexes SET status = 'uploading', file_count = NULL WHERE id = $1",
      [indexId],
    );
  }

  async updateRepoHead(repoId: number, branch: string, indexId: number): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO repo_head(repo_id, branch, index_id) VALUES ($1, $2, $3)
       ON CONFLICT (repo_id, branch) DO UPDATE SET index_id = EXCLUDED.index_id`,
      [repoId, branch, indexId],
    );
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async insertSymbols(symbols: DbSymbol[]): Promise<void> {
    if (symbols.length === 0) return;
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of symbols) {
        await client.query(
          `INSERT INTO symbols
             (index_id, symbol_key, file_path, name, kind, signature,
              parent_key, start_line, end_line, modifiers, annotations)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (symbol_key) DO NOTHING`,
          [
            s.index_id, s.symbol_key, s.file_path, s.name, s.kind,
            s.signature, s.parent_key, s.start_line, s.end_line,
            s.modifiers, s.annotations,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async insertOccurrences(occurrences: DbOccurrence[]): Promise<void> {
    if (occurrences.length === 0) return;
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const o of occurrences) {
        await client.query(
          `INSERT INTO occurrences
             (index_id, caller_key, callee_name, kind, file_path, line)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [o.index_id, o.caller_key, o.callee_name, o.kind, o.file_path, o.line],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async searchSymbols(repoId: number, commitSha: string, query: string, limit = 20): Promise<DbSymbol[]> {
    const idx = await this.getIndex(repoId, commitSha);
    if (!idx) return [];
    // ADR-022: to_tsquery 'simple' prefix search; query is already validated /^[A-Za-z0-9_]+$/
    const { rows } = await this.pool.query<DbSymbol>(
      `SELECT * FROM symbols
       WHERE index_id = $1 AND name_tsv @@ to_tsquery('simple', $2)
       LIMIT $3`,
      [idx.id, `${query}:*`, limit],
    );
    return rows;
  }

  async getSymbolByKey(symbolKey: string): Promise<DbSymbol | undefined> {
    await this.ready;
    const { rows } = await this.pool.query<DbSymbol>(
      'SELECT * FROM symbols WHERE symbol_key = $1',
      [symbolKey],
    );
    return rows[0];
  }

  async getFileSymbols(repoId: number, commitSha: string, filePath: string): Promise<DbSymbol[]> {
    const idx = await this.getIndex(repoId, commitSha);
    if (!idx) return [];
    const { rows } = await this.pool.query<DbSymbol>(
      'SELECT * FROM symbols WHERE index_id = $1 AND file_path = $2',
      [idx.id, filePath],
    );
    return rows;
  }

  async getOccurrences(calleeName: string, repoId: number, commitSha: string): Promise<DbOccurrence[]> {
    const idx = await this.getIndex(repoId, commitSha);
    if (!idx) return [];
    const { rows } = await this.pool.query<DbOccurrence>(
      'SELECT * FROM occurrences WHERE callee_name = $1 AND index_id = $2',
      [calleeName, idx.id],
    );
    return rows;
  }

  async getRepoByName(name: string): Promise<DbRepo | undefined> {
    await this.ready;
    const { rows } = await this.pool.query<DbRepo>(
      'SELECT * FROM repos WHERE name = $1',
      [name],
    );
    return rows[0];
  }

  async getRepoHead(repoId: number, branch: string): Promise<{ index_id: number } | undefined> {
    await this.ready;
    const { rows } = await this.pool.query<{ index_id: number }>(
      'SELECT index_id FROM repo_head WHERE repo_id = $1 AND branch = $2',
      [repoId, branch],
    );
    return rows[0];
  }

  async getFilesByIndex(indexId: number): Promise<string[]> {
    await this.ready;
    const { rows } = await this.pool.query<{ file_path: string }>(
      `SELECT DISTINCT file_path FROM symbols WHERE index_id = $1
       UNION
       SELECT DISTINCT file_path FROM occurrences WHERE index_id = $1
       ORDER BY file_path`,
      [indexId],
    );
    return rows.map((r) => r.file_path);
  }

  async getLatestReadyIndex(repoId: number): Promise<DbIndex | undefined> {
    await this.ready;
    const { rows } = await this.pool.query<DbIndex>(
      "SELECT * FROM indexes WHERE repo_id = $1 AND status = 'ready' ORDER BY id DESC LIMIT 1",
      [repoId],
    );
    return rows[0];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
