import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createBlobAdapter, createDbAdapter } from './storage/factory.js';

const uploadToken = process.env.ANALYZE_UPLOAD_TOKEN ?? '';
const port = Number(process.env.PORT ?? 3000);

const db = createDbAdapter();
const blob = createBlobAdapter();
const app = createApp({ db, blob, uploadToken });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
  if (!uploadToken) {
    console.warn('Warning: ANALYZE_UPLOAD_TOKEN is not set — all write endpoints will return 401');
  }
});
