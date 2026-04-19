// Variant B stub — AWS S3 implementation of BlobAdapter (ADR-015).
// Not yet implemented. Activate when migrating from local FS to S3.
import type { BlobAdapter } from './types.js';

function notImplemented(method: string): never {
  throw new Error(`S3BlobAdapter.${method}: Variant B not implemented`);
}

export class S3BlobAdapter implements BlobAdapter {
  saveBlob(_repoId: number, _indexId: number, _data: Buffer): Promise<void> { notImplemented('saveBlob'); }
  getEntry(_repoId: number, _indexId: number, _filePath: string): Promise<Buffer | undefined> { notImplemented('getEntry'); }
  hasBlob(_repoId: number, _indexId: number): Promise<boolean> { notImplemented('hasBlob'); }
}
