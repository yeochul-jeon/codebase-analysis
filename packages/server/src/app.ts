import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import type { DbAdapter } from './storage/db/types.js';
import type { BlobAdapter } from './storage/blob/types.js';
import { registerHealthRoute } from './routes/health.js';
import { createIndexesRouter } from './routes/indexes.js';
import { createReadsRouter } from './routes/reads.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

export interface AppDeps {
  db: DbAdapter;
  blob: BlobAdapter;
  uploadToken: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  registerHealthRoute(app);
  app.route('/', createIndexesRouter(deps.db, deps.blob, deps.uploadToken));
  app.route('/', createReadsRouter(deps.db, deps.blob));

  // unknown /v1/* must return 404 JSON, not fall through to static handler
  app.all('/v1/*', (c) => c.json({ error: 'Not found' }, 404));

  // Cache-Control + ETag for static assets (post-middleware, runs after serveStatic)
  app.use('/*', async (c, next) => {
    await next();
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith('/v1/') || pathname === '/healthz') return;
    if (!c.res || (c.res.status !== 200 && c.res.status !== 304)) return;

    let filePath: string | undefined;
    if (pathname === '/' || pathname === '/index.html') {
      filePath = join(PUBLIC_DIR, 'index.html');
    } else if (pathname === '/f') {
      filePath = join(PUBLIC_DIR, 'file.html');
    } else if (pathname.startsWith('/s/')) {
      filePath = join(PUBLIC_DIR, 'symbol.html');
    } else if (/^\/(app\.js|style\.css|[\w.-]+\.html)$/.test(pathname)) {
      filePath = join(PUBLIC_DIR, pathname.slice(1));
    }
    if (!filePath) return;

    let stat: { size: number; mtimeMs: number };
    try { stat = statSync(filePath); } catch { return; }

    const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
    const isAsset = pathname.endsWith('.js') || pathname.endsWith('.css');
    const cacheControl = isAsset
      ? 'public, max-age=300, stale-while-revalidate=60'
      : 'no-cache';

    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch === etag) {
      c.res = new Response(null, {
        status: 304,
        headers: { 'Cache-Control': cacheControl, ETag: etag },
      });
      return;
    }

    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', cacheControl);
    headers.set('ETag', etag);
    c.res = new Response(c.res.body, { status: c.res.status, headers });
  });

  // /f → file overview page
  app.get('/f', serveStatic({ root: PUBLIC_DIR, path: 'file.html' }));
  // /s/<64-hex> → symbol.html (client-side routing handled by app.js)
  app.get('/s/:key', serveStatic({ root: PUBLIC_DIR, path: 'symbol.html' }));
  // static assets: index.html, app.js, style.css
  app.use('/*', serveStatic({ root: PUBLIC_DIR }));

  return app;
}
