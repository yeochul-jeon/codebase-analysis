import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BlobAdapter } from './types.js';

export class FsBlobAdapter implements BlobAdapter {
  constructor(private readonly blobDir: string) {}

  private blobPath(repoId: number, indexId: number): string {
    return join(this.blobDir, String(repoId), `${indexId}.zip`);
  }

  async saveBlob(repoId: number, indexId: number, data: Buffer): Promise<void> {
    const path = this.blobPath(repoId, indexId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }

  async getEntry(repoId: number, indexId: number, filePath: string): Promise<Buffer | undefined> {
    const path = this.blobPath(repoId, indexId);
    if (!existsSync(path)) return undefined;
    try {
      const zip = new AdmZip(readFileSync(path));
      const entry = zip.getEntry(filePath);
      if (!entry) return undefined;
      return zip.readFile(entry) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async hasBlob(repoId: number, indexId: number): Promise<boolean> {
    return existsSync(this.blobPath(repoId, indexId));
  }
}
