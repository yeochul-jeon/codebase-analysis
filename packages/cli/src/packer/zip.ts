import AdmZip from 'adm-zip';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_BYTES = 1_048_576; // 1 MB

export function buildSourceZip(
  files: Array<{ path: string; source: string; absPath: string }>,
): Buffer {
  const zip = new AdmZip();

  for (const { path, source, absPath } of files) {
    try {
      const stat = lstatSync(absPath);
      if (stat.isSymbolicLink()) {
        console.warn(`[packer] skipping symlink: ${path}`);
        continue;
      }
      const buf = Buffer.from(source, 'utf8');
      if (buf.byteLength > MAX_FILE_BYTES) {
        console.warn(`[packer] skipping large file (${buf.byteLength} bytes): ${path}`);
        continue;
      }
      zip.addFile(path, buf);
    } catch {
      console.warn(`[packer] could not stat file, skipping: ${path}`);
    }
  }

  return zip.toBuffer();
}
