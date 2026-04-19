import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { extractFromJS } from '../../extractors/typescript.js';
import { extractFromJava } from '../../extractors/java.js';
import { parseFile } from '../../parser/parser.js';
import { pack } from '../index.js';

// Create temp dir for abs paths
const tmpDir = mkdtempSync(join(tmpdir(), 'packer-smoke-'));

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label}`);
    failed++;
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const tsSource = `
export class Foo {
  bar(): string { return 'baz'; }
}
`;

const javaSource = `
public class Counter {
  public void increment() {}
}
`;

// Write actual temp files so zip stat succeeds
const absFoo = join(tmpDir, 'foo.ts');
const absCounter = join(tmpDir, 'Counter.java');
writeFileSync(absFoo, tsSource, 'utf8');
writeFileSync(absCounter, javaSource, 'utf8');

// ─── Extract ─────────────────────────────────────────────────────────────────

const tsTree = parseFile('src/foo.ts', tsSource)!;
const tsExtraction = extractFromJS(tsTree, 'typescript');

const javaTree = parseFile('src/Counter.java', javaSource)!;
const javaExtraction = extractFromJava(javaTree);

const REPO = 'test-repo';
const SHA = 'aabbcc';
const SHA2 = 'ddeeff';

const output = pack({
  repoName: REPO,
  commitSha: SHA,
  branch: 'main',
  files: [
    { path: 'src/foo.ts', absPath: absFoo, source: tsSource, extraction: tsExtraction },
    { path: 'src/Counter.java', absPath: absCounter, source: javaSource, extraction: javaExtraction },
  ],
});

const { indexJson, zipBuffer } = output;

// ─── Basic shape ─────────────────────────────────────────────────────────────

check('schema_version is 1', indexJson.schema_version === 1);
check('repo_name matches', indexJson.repo_name === REPO);
check('commit_sha matches', indexJson.commit_sha === SHA);
check('branch matches', indexJson.branch === 'main');
check('symbols is array', Array.isArray(indexJson.symbols));
check('occurrences is array', Array.isArray(indexJson.occurrences));
check('files includes both paths', indexJson.files.includes('src/foo.ts') && indexJson.files.includes('src/Counter.java'));

// ─── symbol_key format ────────────────────────────────────────────────────────

const fooSym = indexJson.symbols.find(s => s.name === 'Foo' && s.kind === 'class');
const barSym = indexJson.symbols.find(s => s.name === 'bar' && s.kind === 'method');
const counterSym = indexJson.symbols.find(s => s.name === 'Counter' && s.kind === 'class');
const incrementSym = indexJson.symbols.find(s => s.name === 'increment' && s.kind === 'method');

check('Foo symbol found', fooSym !== undefined);
check('bar symbol found', barSym !== undefined);
check('Counter symbol found', counterSym !== undefined);
check('increment symbol found', incrementSym !== undefined);

for (const sym of indexJson.symbols) {
  check(`${sym.name} has 64-char hex key`, /^[0-9a-f]{64}$/.test(sym.symbol_key));
  check(`${sym.name}.modifiers is array`, Array.isArray(sym.modifiers));
  check(`${sym.name}.annotations is array`, Array.isArray(sym.annotations));
  check(`${sym.name} has no _nodeId leak`, !('_nodeId' in sym));
  check(`${sym.name} has no parent_id leak`, !('parent_id' in sym));
}

// ─── parent_key resolution ────────────────────────────────────────────────────

if (fooSym && barSym) {
  check('bar.parent_key === Foo.symbol_key', barSym.parent_key === fooSym.symbol_key);
}
if (counterSym && incrementSym) {
  check('increment.parent_key === Counter.symbol_key', incrementSym.parent_key === counterSym.symbol_key);
}
if (fooSym) {
  check('Foo.parent_key is null (top-level)', fooSym.parent_key === null);
}

// ─── determinism + isolation ──────────────────────────────────────────────────

const output2 = pack({
  repoName: REPO,
  commitSha: SHA2,
  branch: null,
  files: [
    { path: 'src/foo.ts', absPath: absFoo, source: tsSource, extraction: tsExtraction },
  ],
});

const fooSym2 = output2.indexJson.symbols.find(s => s.name === 'Foo' && s.kind === 'class');
if (fooSym && fooSym2) {
  check('same file different commit → different symbol_key', fooSym.symbol_key !== fooSym2.symbol_key);
}

// Verify determinism: same inputs → same key
const expectedFooKey = createHash('sha256')
  .update(`${REPO}\0${SHA}\0src/foo.ts\0Foo\0class\0${fooSym?.start_line}`)
  .digest('hex');
check('Foo.symbol_key matches expected sha256', fooSym?.symbol_key === expectedFooKey);

// ─── zip contents ─────────────────────────────────────────────────────────────

const zip = new AdmZip(zipBuffer);
const entries = zip.getEntries().map(e => e.entryName);
check('zip contains src/foo.ts', entries.includes('src/foo.ts'));
check('zip contains src/Counter.java', entries.includes('src/Counter.java'));
check('zip entry count matches files', entries.length === indexJson.files.length);

// ─── Result ───────────────────────────────────────────────────────────────────

rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
