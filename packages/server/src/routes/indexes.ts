import { Hono } from 'hono';
import { z } from 'zod';
import type { DbAdapter, DbOccurrence, DbSymbol } from '../storage/db/types.js';
import type { BlobAdapter } from '../storage/blob/types.js';
import { packedIndexSchema } from '../schemas/packed-index.js';
import { requireBearer } from '../middleware/bearer.js';

export function createIndexesRouter(
  db: DbAdapter,
  blob: BlobAdapter,
  uploadToken: string,
): Hono {
  const router = new Hono();
  const auth = requireBearer(uploadToken);

  // POST /v1/repos/:name/indexes — create or reset an index (ADR-010)
  router.post('/v1/repos/:name/indexes', auth, async (c) => {
    const name = c.req.param('name');
    const bodySchema = z.object({
      commit_sha: z.string().min(1),
      branch: z.string().nullable().optional(),
    });
    const body = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid body' }, 400);

    const { commit_sha, branch = null } = body.data;
    const repo = await db.getOrCreateRepo(name, branch ?? 'main');
    const existing = await db.getIndex(repo.id, commit_sha);

    let indexId: number;
    if (existing) {
      if (existing.status === 'ready') {
        return c.json({ index_id: existing.id, status: 'ready' }, 409);
      }
      await db.deleteIndexData(existing.id);
      await db.resetIndexToUploading(existing.id);
      indexId = existing.id;
    } else {
      const created = await db.createIndex(repo.id, commit_sha, branch ?? undefined);
      indexId = created.id;
    }

    return c.json({ index_id: indexId, status: 'uploading' });
  });

  // PUT /v1/indexes/:id/index-json — upload parsed symbols + occurrences
  router.put('/v1/indexes/:id/index-json', auth, async (c) => {
    const indexId = Number(c.req.param('id'));
    if (!Number.isInteger(indexId)) return c.json({ error: 'Invalid index id' }, 400);

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = packedIndexSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: 'Schema validation failed', details: parsed.error.flatten() }, 400);
    }

    const payload = parsed.data;
    const idx = await db.getIndexById(indexId);
    if (!idx) return c.json({ error: 'Index not found' }, 404);

    const repo = await db.getRepoByName(payload.repo_name);
    const branchMatches = payload.branch === (idx.branch ?? null);
    if (!repo || repo.id !== idx.repo_id || payload.commit_sha !== idx.commit_sha || !branchMatches) {
      return c.json({ error: 'Index payload does not match target index' }, 409);
    }

    const symbols: DbSymbol[] = payload.symbols.map((s) => ({
      index_id: indexId,
      symbol_key: s.symbol_key,
      file_path: s.file_path,
      name: s.name,
      kind: s.kind,
      signature: s.signature,
      parent_key: s.parent_key,
      start_line: s.start_line,
      end_line: s.end_line,
      modifiers: s.modifiers.length > 0 ? JSON.stringify(s.modifiers) : null,
      annotations: s.annotations.length > 0 ? JSON.stringify(s.annotations) : null,
    }));

    const occurrences: DbOccurrence[] = payload.occurrences.map((o) => ({
      index_id: indexId,
      caller_key: o.caller_key,
      callee_name: o.callee_name,
      kind: o.kind,
      file_path: o.file_path,
      line: o.line,
    }));

    await db.insertSymbols(symbols);
    await db.insertOccurrences(occurrences);

    return c.json({ symbol_count: symbols.length, occurrence_count: occurrences.length });
  });

  // PUT /v1/indexes/:id/source-zip — upload raw zip buffer
  router.put('/v1/indexes/:id/source-zip', auth, async (c) => {
    const indexId = Number(c.req.param('id'));
    if (!Number.isInteger(indexId)) return c.json({ error: 'Invalid index id' }, 400);

    const idx = await db.getIndexById(indexId);
    if (!idx) return c.json({ error: 'Index not found' }, 404);

    const ab = await c.req.arrayBuffer();
    const buf = Buffer.from(ab);
    await blob.saveBlob(idx.repo_id, indexId, buf);

    return c.json({ bytes: buf.byteLength });
  });

  // PATCH /v1/indexes/:id — finalize index status
  router.patch('/v1/indexes/:id', auth, async (c) => {
    const indexId = Number(c.req.param('id'));
    if (!Number.isInteger(indexId)) return c.json({ error: 'Invalid index id' }, 400);

    const bodySchema = z.object({
      status: z.enum(['ready', 'failed']),
      file_count: z.number().int().nonnegative().optional(),
    });
    const body = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid body' }, 400);

    const { status, file_count } = body.data;
    const idx = await db.getIndexById(indexId);
    if (!idx) return c.json({ error: 'Index not found' }, 404);

    if (status === 'ready') {
      if (idx.status !== 'uploading') {
        return c.json({ error: 'Only uploading indexes can be finalized' }, 409);
      }

      const files = await db.getFilesByIndex(indexId);
      const hasIndexData = files.length > 0;
      const hasBlob = await blob.hasBlob(idx.repo_id, indexId);
      if (!hasIndexData || !hasBlob) {
        return c.json({ error: 'Index is incomplete: index-json and source-zip are both required' }, 409);
      }

      await db.markIndexReady(indexId, file_count ?? 0);
      if (idx.branch) {
        await db.updateRepoHead(idx.repo_id, idx.branch, indexId);
      }
    } else {
      await db.markIndexFailed(indexId);
    }

    return c.json({ status });
  });

  return router;
}
