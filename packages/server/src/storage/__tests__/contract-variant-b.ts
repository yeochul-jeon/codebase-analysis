// Variant B contract test — runs PgAdapter + S3BlobAdapter against the shared contract harness.
// Requires: RUN_VARIANT_B=1, PG_URL, S3_BUCKET, plus optional S3_REGION/S3_ENDPOINT/credentials.
//
// Usage:
//   docker compose --profile variant-b up -d postgres minio minio-init
//   RUN_VARIANT_B=1 PG_URL=postgres://ca:ca@localhost:5432/ca \
//     S3_BUCKET=ca-blobs S3_ENDPOINT=http://localhost:9000 \
//     S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin \
//     pnpm -F @codebase-analysis/server test:variant-b
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { PgAdapter } from '../db/pg.js';
import { S3BlobAdapter } from '../blob/s3.js';
import { runBlobContract, runDbContract } from './contract.js';

if (process.env.RUN_VARIANT_B !== '1') {
  console.log('Skipping Variant B contract tests (set RUN_VARIANT_B=1 to run)');
  console.log('  requires: PG_URL, S3_BUCKET');
  process.exit(0);
}

const pgUrl = process.env.PG_URL;
if (!pgUrl) { console.error('PG_URL is required'); process.exit(1); }

const s3Bucket = process.env.S3_BUCKET;
if (!s3Bucket) { console.error('S3_BUCKET is required'); process.exit(1); }

const s3Region = process.env.S3_REGION ?? 'us-east-1';
const s3Endpoint = process.env.S3_ENDPOINT || undefined;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID || undefined;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY || undefined;

// ── Reset PG ─────────────────────────────────────────────────────────────────
// TRUNCATE repos CASCADE clears all FK-dependent tables; RESTART IDENTITY resets SERIAL sequences.
const resetPool = new Pool({ connectionString: pgUrl });
try {
  await resetPool.query('TRUNCATE repos RESTART IDENTITY CASCADE');
} catch {
  // Table may not exist yet (first run before PgAdapter migrates) — that's fine.
}
await resetPool.end();

// ── Reset S3 ──────────────────────────────────────────────────────────────────
const resetClient = new S3Client({
  region: s3Region,
  endpoint: s3Endpoint,
  forcePathStyle: !!s3Endpoint,
  credentials:
    s3AccessKeyId && s3SecretAccessKey
      ? { accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey }
      : undefined,
});

const listRes = await resetClient.send(
  new ListObjectsV2Command({ Bucket: s3Bucket }),
);
for (const obj of listRes.Contents ?? []) {
  await resetClient.send(
    new DeleteObjectCommand({ Bucket: s3Bucket, Key: obj.Key! }),
  );
}

// ── Run contract harness ──────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function check(label: string, cond: boolean): void {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.error(`✗ ${label}`); fail++; }
}

const { repoId, indexId } = await runDbContract(
  check,
  () => new PgAdapter({ url: pgUrl }),
);

await runBlobContract(
  check,
  () => new S3BlobAdapter({
    bucket: s3Bucket,
    region: s3Region,
    endpoint: s3Endpoint,
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
    forcePathStyle: !!s3Endpoint,
  }),
  { repoId, indexId },
);

console.log(`\nVariant B contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
