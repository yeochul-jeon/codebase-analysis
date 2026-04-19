import { mkdirSync } from 'node:fs';
import { FsBlobAdapter } from './blob/fs.js';
import { S3BlobAdapter } from './blob/s3.js';
import type { BlobAdapter } from './blob/types.js';
import { PgAdapter } from './db/pg.js';
import { SqliteAdapter } from './db/sqlite.js';
import type { DbAdapter } from './db/types.js';

export function createDbAdapter(): DbAdapter {
  const backend = process.env.DB_BACKEND ?? 'sqlite';
  switch (backend) {
    case 'sqlite': {
      const dbPath = process.env.DB_PATH ?? './data/index.db';
      return new SqliteAdapter(dbPath);
    }
    case 'pg': {
      const url = process.env.PG_URL;
      if (!url) throw new Error('PG_URL is required when DB_BACKEND=pg');
      return new PgAdapter({ url });
    }
    default:
      throw new Error(`Unknown DB_BACKEND: "${backend}" — valid values: sqlite, pg`);
  }
}

export function createBlobAdapter(): BlobAdapter {
  const backend = process.env.STORAGE_BACKEND ?? 'fs';
  switch (backend) {
    case 'fs': {
      const blobsDir = process.env.BLOBS_DIR ?? './data/blobs';
      mkdirSync(blobsDir, { recursive: true });
      return new FsBlobAdapter(blobsDir);
    }
    case 's3': {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_BACKEND=s3');
      return new S3BlobAdapter({
        bucket,
        region: process.env.S3_REGION ?? 'us-east-1',
        endpoint: process.env.S3_ENDPOINT || undefined,
        accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1',
      });
    }
    default:
      throw new Error(`Unknown STORAGE_BACKEND: "${backend}" — valid values: fs, s3`);
  }
}
