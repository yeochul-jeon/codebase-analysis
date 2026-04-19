import { parseFile, detectLanguage } from '../parser.js';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) { console.log(`✓ ${label}`); passed++; }
  else { console.error(`✗ ${label}`); failed++; }
}

const cases: [string, string, string, boolean][] = [
  ['small TS', 'test.ts', 'const x: number = 1;', true],
  ['BOM+CRLF', 'test.ts', '\uFEFFconst y = 2;\r\n', true],
  ['Java', 'Hello.java', 'public class Hello { public static void main(String[] args) {} }', true],
  ['.d.ts skip', 'types.d.ts', 'export type X = string;', false],
  ['.py skip', 'test.py', 'x = 1', false],
];

for (const [label, path, src, expectTree] of cases) {
  const tree = parseFile(path, src);
  check(label, expectTree ? tree !== null : tree === null);
}

// large file test (>32K chars — triggers streaming callback)
const large = 'const z = 1;\n'.repeat(3000);
check('large precondition (>32K)', large.length > 32767);
check(`large (${large.length} chars > 32K)`, parseFile('large.ts', large) !== null);

// detectLanguage sanity checks
const expected: Record<string, string | null> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript',
  '.mjs': 'javascript', '.java': 'java', '.py': null, '.d.ts': null,
};
for (const [ext, lang] of Object.entries(expected)) {
  check(`detectLanguage(file${ext}) === ${lang ?? 'null'}`, detectLanguage(`file${ext}`) === lang);
}

console.log(`\nParser smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
