import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { SqliteAdapter } from './storage/db/sqlite.js';
import { FsBlobAdapter } from './storage/blob/fs.js';
import { createApp } from './app.js';

const dbPath = process.env.DB_PATH ?? './data/index.db';
const blobsDir = process.env.BLOBS_DIR ?? './data/blobs';
const uploadToken = process.env.ANALYZE_UPLOAD_TOKEN ?? '';
const port = Number(process.env.PORT ?? 3000);

mkdirSync(blobsDir, { recursive: true });

const db = new SqliteAdapter(dbPath);
const blob = new FsBlobAdapter(blobsDir);
const app = createApp({ db, blob, uploadToken });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
  if (!uploadToken) {
    console.warn('Warning: ANALYZE_UPLOAD_TOKEN is not set — all write endpoints will return 401');
  }
});
