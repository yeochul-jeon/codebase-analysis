import { parseFile, detectLanguage } from '../parser.js';

const cases: [string, string, string][] = [
  ['small TS', 'test.ts', 'const x: number = 1;'],
  ['BOM+CRLF', 'test.ts', '\uFEFFconst y = 2;\r\n'],
  ['Java', 'Hello.java', 'public class Hello { public static void main(String[] args) {} }'],
  ['.d.ts skip', 'types.d.ts', 'export type X = string;'],
  ['.py skip', 'test.py', 'x = 1'],
];

for (const [label, path, src] of cases) {
  const tree = parseFile(path, src);
  const expected = path.endsWith('.d.ts') || path.endsWith('.py') ? null : 'tree';
  const result = expected === null ? tree === null : tree !== null;
  console.log(`${result ? '✓' : '✗'} ${label}`);
}

// large file test (>32K chars — triggers streaming callback)
const large = 'const z = 1;\n'.repeat(3000);
console.assert(large.length > 32767, 'large must exceed 32K');
const largeTree = parseFile('large.ts', large);
console.log(`${largeTree !== null ? '✓' : '✗'} large (${large.length} chars > 32K)`);

console.log('\ndetectLanguage checks:');
const langs = ['.ts', '.tsx', '.js', '.mjs', '.java', '.py', '.d.ts'];
for (const ext of langs) {
  const lang = detectLanguage(`file${ext}`);
  console.log(`  file${ext} → ${lang ?? 'null'}`);
}
