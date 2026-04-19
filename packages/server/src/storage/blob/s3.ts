// Variant B — AWS S3 implementation of BlobAdapter (ADR-015, ADR-019).
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import AdmZip from 'adm-zip';
import type { BlobAdapter } from './types.js';

export interface S3BlobAdapterOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Set true for MinIO/LocalStack (path-style URLs). Defaults to true when endpoint is set. */
  forcePathStyle?: boolean;
}

export class S3BlobAdapter implements BlobAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(opts: S3BlobAdapterOptions) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle ?? !!opts.endpoint,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
    });
  }

  private key(repoId: number, indexId: number): string {
    return `${repoId}/${indexId}.zip`;
  }

  async saveBlob(repoId: number, indexId: number, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(repoId, indexId),
        Body: data,
      }),
    );
  }

  async getEntry(repoId: number, indexId: number, filePath: string): Promise<Buffer | undefined> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(repoId, indexId),
        }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      const buf = Buffer.concat(chunks);
      const zip = new AdmZip(buf);
      const entry = zip.getEntry(filePath);
      if (!entry) return undefined;
      return zip.readFile(entry) ?? undefined;
    } catch (e: unknown) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }

  async hasBlob(repoId: number, indexId: number): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.key(repoId, indexId),
        }),
      );
      return true;
    } catch (e: unknown) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }
}

function isNotFound(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err.name === 'NoSuchKey' ||
    err.name === 'NotFound' ||
    err.$metadata?.httpStatusCode === 404
  );
}
