import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { extractFromJS } from '../../extractors/typescript.js';
import { extractFromJava } from '../../extractors/java.js';
import { parseFile } from '../../parser/parser.js';
import { pack } from '../index.js';
import { resolveFileOccurrences, resolveFileSymbols } from '../resolve.js';

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

const refsOnlySource = `
hello();
`;

// Write actual temp files so zip stat succeeds
const absFoo = join(tmpDir, 'foo.ts');
const absCounter = join(tmpDir, 'Counter.java');
const absRefsOnly = join(tmpDir, 'calls.ts');
writeFileSync(absFoo, tsSource, 'utf8');
writeFileSync(absCounter, javaSource, 'utf8');
writeFileSync(absRefsOnly, refsOnlySource, 'utf8');

// ─── Extract ─────────────────────────────────────────────────────────────────

const tsTree = parseFile('src/foo.ts', tsSource)!;
const tsExtraction = extractFromJS(tsTree, 'typescript');

const javaTree = parseFile('src/Counter.java', javaSource)!;
const javaExtraction = extractFromJava(javaTree);

const refsOnlyExtraction = {
  symbols: [],
  dependencies: [],
  refs: [{
    callerName: 'top-level',
    calleeName: 'hello',
    kind: 'call' as const,
    line: 1,
  }],
};

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
    { path: 'src/calls.ts', absPath: absRefsOnly, source: refsOnlySource, extraction: refsOnlyExtraction },
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
check(
  'files includes symbol and refs-only paths',
  indexJson.files.includes('src/foo.ts') &&
    indexJson.files.includes('src/Counter.java') &&
    indexJson.files.includes('src/calls.ts'),
);
check(
  'refs-only file occurrences are preserved',
  indexJson.occurrences.some((o) => o.file_path === 'src/calls.ts' && o.callee_name === 'hello'),
);

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

// ─── duplicate symbol_key should not orphan surviving children ──────────────

const duplicateResolved = resolveFileSymbols('dup-repo', 'dup-sha', 'src/dup.ts', [
  {
    name: 'Outer',
    kind: 'class',
    signature: null,
    parent_id: null,
    start_line: 1,
    end_line: 10,
    modifiers: [],
    annotations: [],
    _nodeId: 1,
  },
  {
    name: 'Outer',
    kind: 'class',
    signature: null,
    parent_id: null,
    start_line: 1,
    end_line: 10,
    modifiers: [],
    annotations: [],
    _nodeId: 99,
  },
  {
    name: 'child',
    kind: 'method',
    signature: 'child(): void',
    parent_id: 1,
    start_line: 2,
    end_line: 3,
    modifiers: [],
    annotations: [],
    _nodeId: 2,
  },
]);

const dupOuter = duplicateResolved.symbols.find((s) => s.name === 'Outer' && s.kind === 'class');
const dupChild = duplicateResolved.symbols.find((s) => s.name === 'child' && s.kind === 'method');
check('duplicate parent survives once', duplicateResolved.symbols.filter((s) => s.name === 'Outer').length === 1);
check('duplicate child remains present', dupChild !== undefined);
check('duplicate child keeps surviving parent_key', dupChild?.parent_key === dupOuter?.symbol_key);

const overloadedResolved = resolveFileSymbols('dup-repo', 'dup-sha', 'src/overload.ts', [
  {
    name: 'run',
    kind: 'method',
    signature: 'run(): void',
    parent_id: null,
    start_line: 1,
    end_line: 2,
    modifiers: [],
    annotations: [],
    _nodeId: 10,
  },
  {
    name: 'run',
    kind: 'method',
    signature: 'run(value: string): void',
    parent_id: null,
    start_line: 5,
    end_line: 6,
    modifiers: [],
    annotations: [],
    _nodeId: 11,
  },
]);
const overloadedOccurrences = resolveFileOccurrences(
  'src/overload.ts',
  [{ callerName: 'run', callerNodeId: 11, calleeName: 'helper', kind: 'call', line: 5 }],
  overloadedResolved.callerMap,
  overloadedResolved.callerNodeMap,
);
const secondRun = overloadedResolved.symbols.find((s) => s.name === 'run' && s.start_line === 5);
check('callerNodeId maps occurrence to correct overloaded symbol', overloadedOccurrences[0]?.caller_key === secondRun?.symbol_key);

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
check('zip contains src/calls.ts', entries.includes('src/calls.ts'));
check('zip entry count matches files', entries.length === indexJson.files.length);

// ─── Result ───────────────────────────────────────────────────────────────────

rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
