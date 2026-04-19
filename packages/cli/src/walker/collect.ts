import { readdirSync } from 'node:fs';
import { join, sep, posix } from 'node:path';

// Hard-coded skip directories (no .gitignore support; see FUTURE-TASKS)
const SKIP_DIRS = new Set([
  'node_modules', 'build', 'target', '.gradle',
  '.git', 'dist', '.codebase-analysis',
]);

export interface CollectedFile {
  absPath: string;
  relPath: string; // repo-relative POSIX path
}

export function collectFiles(root: string): CollectedFile[] {
  const results: CollectedFile[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const abs = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        // Convert to POSIX relative path
        const rel = abs.slice(root.length + 1).split(sep).join(posix.sep);
        results.push({ absPath: abs, relPath: rel });
      }
    }
  }

  walk(root);
  return results;
}
