import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { extractFromJava } from '../extractors/java.js';
import { extractFromJS } from '../extractors/typescript.js';
import { detectLanguage, parseFile } from '../parser/parser.js';
import { pack } from '../packer/index.js';
import { collectFiles } from '../walker/collect.js';

function gitExec(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function getCommitSha(cwd: string): string | null {
  return gitExec(['rev-parse', 'HEAD'], cwd);
}

function getCurrentBranch(cwd: string): string | null {
  const branch = gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return branch === 'HEAD' ? null : branch;
}

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze [path]')
    .description('Extract symbols from a codebase and write index.json + source.zip')
    .option('--out <dir>', 'Output directory', '.codebase-analysis')
    .option('--repo-name <name>', 'Repository name (default: directory basename)')
    .option('--commit <sha>', 'Override git commit SHA')
    .option('--branch <name>', 'Override git branch name')
    .option('--no-branch', 'Set branch to null (detached / no branch)')
    .action((pathArg: string | undefined, opts: {
      out: string;
      repoName?: string;
      commit?: string;
      branch: string | boolean;
    }) => {
      const repoRoot = resolve(pathArg ?? '.');
      const repoName = opts.repoName ?? basename(repoRoot);
      const outDir = resolve(opts.out);

      // Resolve commit SHA
      const commitSha = opts.commit ?? getCommitSha(repoRoot);
      if (!commitSha) {
        console.error(
          'Error: could not determine commit SHA. Use --commit <sha> to specify it explicitly.',
        );
        process.exit(1);
      }

      // Resolve branch (opts.branch is false when --no-branch is passed)
      let branch: string | null;
      if (opts.branch === false) {
        branch = null;
      } else if (typeof opts.branch === 'string') {
        branch = opts.branch;
      } else {
        branch = getCurrentBranch(repoRoot);
      }

      // Walk and filter
      const allFiles = collectFiles(repoRoot);
      const sourceFiles = allFiles.filter((f) => detectLanguage(f.relPath) !== null);

      console.log(`Analyzing ${sourceFiles.length} source files in ${repoRoot}…`);

      const packInputFiles: Parameters<typeof pack>[0]['files'] = [];

      for (const { absPath, relPath } of sourceFiles) {
        let source: string;
        try {
          source = readFileSync(absPath, 'utf8');
        } catch {
          console.warn(`[analyze] could not read file, skipping: ${relPath}`);
          continue;
        }

        const tree = parseFile(relPath, source);
        if (!tree) continue;

        const lang = detectLanguage(relPath)!;
        const extraction =
          lang === 'java' ? extractFromJava(tree) : extractFromJS(tree, lang);

        if (extraction.symbols.length === 0) continue;

        packInputFiles.push({ path: relPath, absPath, source, extraction });
      }

      const { indexJson, zipBuffer } = pack({
        repoName,
        commitSha,
        branch,
        files: packInputFiles,
      });

      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'index.json'), JSON.stringify(indexJson, null, 2), 'utf8');
      writeFileSync(join(outDir, 'source.zip'), zipBuffer);

      console.log(
        `Wrote ${indexJson.symbols.length} symbols from ${indexJson.files.length} files → ${outDir}`,
      );
    });
}
