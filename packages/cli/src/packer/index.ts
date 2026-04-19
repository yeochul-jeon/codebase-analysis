import type { ExtractionResult, PackedIndex } from '@codebase-analysis/shared';
import { resolveFileOccurrences, resolveFileSymbols } from './resolve.js';
import { buildSourceZip } from './zip.js';

export type { PackedIndex };

export interface PackInput {
  repoName: string;
  commitSha: string;
  branch: string | null;
  files: Array<{
    path: string;      // repo-relative POSIX path
    absPath: string;   // absolute path on disk (for symlink/size check)
    source: string;    // raw text content
    extraction: ExtractionResult;
  }>;
}

export interface PackOutput {
  indexJson: PackedIndex;
  zipBuffer: Buffer;
}

export function pack(input: PackInput): PackOutput {
  const { repoName, commitSha, branch, files } = input;

  const allSymbols: PackedIndex['symbols'] = [];
  const allOccurrences: PackedIndex['occurrences'] = [];
  const filePaths: string[] = [];

  for (const file of files) {
    const { symbols, callerMap, callerNodeMap } = resolveFileSymbols(
      repoName,
      commitSha,
      file.path,
      file.extraction.symbols,
    );
    const occurrences = resolveFileOccurrences(file.path, file.extraction.refs, callerMap, callerNodeMap);

    if (symbols.length > 0 || occurrences.length > 0) {
      allSymbols.push(...symbols);
      allOccurrences.push(...occurrences);
      filePaths.push(file.path);
    }
  }

  const indexJson: PackedIndex = {
    schema_version: 1,
    repo_name: repoName,
    commit_sha: commitSha,
    branch,
    generated_at: Math.floor(Date.now() / 1000),
    symbols: allSymbols,
    occurrences: allOccurrences,
    files: filePaths,
  };

  const zipBuffer = buildSourceZip(
    files
      .filter((f) => filePaths.includes(f.path))
      .map((f) => ({ path: f.path, source: f.source, absPath: f.absPath })),
  );

  return { indexJson, zipBuffer };
}
