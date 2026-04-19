import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // /s/<64-hex> → symbol.html (client-side routing handled by app.js)
  app.get('/s/:key', serveStatic({ root: PUBLIC_DIR, path: 'symbol.html' }));
  // static assets: index.html, app.js, style.css
  app.use('/*', serveStatic({ root: PUBLIC_DIR }));

  return app;
}
