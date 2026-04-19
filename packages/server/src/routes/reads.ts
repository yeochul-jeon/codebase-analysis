import { Hono } from 'hono';
import { z } from 'zod';
import type { DbAdapter, DbIndex } from '../storage/db/types.js';
import type { BlobAdapter } from '../storage/blob/types.js';

const HEX64 = /^[0-9a-f]{64}$/;

async function resolveIndex(db: DbAdapter, repoName: string, commit?: string): Promise<DbIndex | undefined> {
  const repo = await db.getRepoByName(repoName);
  if (!repo) return undefined;

  if (commit) {
    const idx = await db.getIndex(repo.id, commit);
    return idx?.status === 'ready' ? idx : undefined;
  }

  const head = await db.getRepoHead(repo.id, repo.default_branch);
  const idx = head ? await db.getIndexById(head.index_id) : await db.getLatestReadyIndex(repo.id);
  return idx?.status === 'ready' ? idx : undefined;
}

export function createReadsRouter(db: DbAdapter, blob: BlobAdapter): Hono {
  const router = new Hono();

  // GET /v1/search?q=&repo=&commit=&limit=
  router.get('/v1/search', async (c) => {
    const qSchema = z.object({
      q: z.string().regex(/^[A-Za-z0-9_]+$/).min(1),
      repo: z.string().min(1),
      commit: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    });
    const parsed = qSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'Invalid query params' }, 400);

    const { q, repo, commit, limit } = parsed.data;
    const idx = await resolveIndex(db, repo, commit);
    if (!idx) return c.json({ error: 'Not found' }, 404);

    const symbols = await db.searchSymbols(idx.repo_id, idx.commit_sha, q, limit);
    return c.json({ symbols });
  });

  // GET /v1/symbols/:key
  router.get('/v1/symbols/:key', async (c) => {
    const key = c.req.param('key');
    if (!HEX64.test(key)) return c.json({ error: 'Invalid symbol key' }, 400);

    const symbol = await db.getSymbolByKey(key);
    if (!symbol) return c.json({ error: 'Not found' }, 404);

    return c.json({ symbol });
  });

  // GET /v1/symbols/:key/body
  router.get('/v1/symbols/:key/body', async (c) => {
    const key = c.req.param('key');
    if (!HEX64.test(key)) return c.json({ error: 'Invalid symbol key' }, 400);

    const symbol = await db.getSymbolByKey(key);
    if (!symbol) return c.json({ error: 'Not found' }, 404);

    const idx = await db.getIndexById(symbol.index_id);
    if (!idx) return c.json({ error: 'Not found' }, 404);

    const buf = await blob.getEntry(idx.repo_id, idx.id, symbol.file_path);
    if (!buf) return c.json({ error: 'Not found' }, 404);

    // lines are 1-based; slice [start_line-1, end_line] (end_line inclusive)
    const lines = buf.toString('utf8').split('\n');
    const body = lines.slice(symbol.start_line - 1, symbol.end_line).join('\n');

    return c.json({
      symbol_key: symbol.symbol_key,
      file_path: symbol.file_path,
      start_line: symbol.start_line,
      end_line: symbol.end_line,
      body,
    });
  });

  // GET /v1/repos/:name/files?commit=
  router.get('/v1/repos/:name/files', async (c) => {
    const name = c.req.param('name');
    const commit = c.req.query('commit');

    const idx = await resolveIndex(db, name, commit);
    if (!idx) return c.json({ error: 'Not found' }, 404);

    const files = await db.getFilesByIndex(idx.id);
    return c.json({ files });
  });

  // GET /v1/symbols/:key/references
  router.get('/v1/symbols/:key/references', async (c) => {
    const key = c.req.param('key');
    if (!HEX64.test(key)) return c.json({ error: 'Invalid symbol key' }, 400);

    const symbol = await db.getSymbolByKey(key);
    if (!symbol) return c.json({ error: 'Not found' }, 404);

    const idx = await db.getIndexById(symbol.index_id);
    if (!idx) return c.json({ error: 'Not found' }, 404);

    const occurrences = await db.getOccurrences(symbol.name, idx.repo_id, idx.commit_sha);
    return c.json({ symbol_key: key, occurrences });
  });

  // GET /v1/repos/:name/file-symbols?path=&commit=
  router.get('/v1/repos/:name/file-symbols', async (c) => {
    const name = c.req.param('name');
    const path = c.req.query('path');
    const commit = c.req.query('commit');

    if (!path) return c.json({ error: 'Missing required query param: path' }, 400);

    const idx = await resolveIndex(db, name, commit);
    if (!idx) return c.json({ error: 'Not found' }, 404);

    const symbols = await db.getFileSymbols(idx.repo_id, idx.commit_sha, path);
    return c.json({ repo: name, commit_sha: idx.commit_sha, file_path: path, symbols });
  });

  return router;
}
