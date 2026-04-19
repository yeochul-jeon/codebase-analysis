import { parseFile } from '../../parser/parser.js';
import { extractFromJS } from '../typescript.js';

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

// ─── Case 1: basic TS declarations ───────────────────────────────────────────

const tsSource = `
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export class User {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet(): string {
    return \`Hello \${this.name}\`;
  }
}

export interface IUser {
  name: string;
  greet(): string;
}

export type UserId = string | number;
`;

const tsTree = parseFile('test.ts', tsSource);
check('TS tree parsed', tsTree !== null);

if (tsTree) {
  const r = extractFromJS(tsTree, 'typescript');

  const names = r.symbols.map(s => s.name);
  check('greet function', names.includes('greet'));
  check('User class', names.includes('User'));
  check('IUser interface', names.includes('IUser'));
  check('UserId type_alias', names.includes('UserId'));

  const userClass = r.symbols.find(s => s.name === 'User' && s.kind === 'class');
  check('User is class kind', userClass?.kind === 'class');

  const greetFn = r.symbols.find(s => s.name === 'greet' && s.kind === 'function');
  check('greet start_line is positive', (greetFn?.start_line ?? 0) > 0);

  // IUser interface members (name field, greet method_signature)
  const iUserSym = r.symbols.find(s => s.name === 'IUser');
  const iUserChildren = r.symbols.filter(s => s.parent_id === iUserSym?._nodeId);
  check('IUser has children', iUserChildren.length >= 1);
}

// ─── Case 2: _nodeId + parent_id chain ───────────────────────────────────────

const parentChildSource = `
class Outer {
  method(): void {}
}
`;

const parentTree = parseFile('parent.ts', parentChildSource);
if (parentTree) {
  const r = extractFromJS(parentTree, 'typescript');
  const outer = r.symbols.find(s => s.name === 'Outer' && s.kind === 'class');
  check('Outer _nodeId defined', outer?._nodeId !== undefined);

  const method = r.symbols.find(s => s.name === 'method');
  check('method parent_id === Outer._nodeId', method?.parent_id === outer?._nodeId);
}

// ─── Case 3: TSX / JSX component ref ─────────────────────────────────────────

const tsxSource = `
import React from 'react';

function App() {
  return <MyButton onClick={() => {}} />;
}
`;

const tsxTree = parseFile('App.tsx', tsxSource);
check('TSX tree parsed', tsxTree !== null);

if (tsxTree) {
  const r = extractFromJS(tsxTree, 'tsx');
  const appFn = r.symbols.find(s => s.name === 'App');
  check('App function found in TSX', appFn !== undefined);

  const jsxRef = r.refs.find(ref => ref.calleeName === 'MyButton');
  check('JSX ref to MyButton captured', jsxRef !== undefined && jsxRef.kind === 'call');
}

// ─── Case 4: CJS exports ─────────────────────────────────────────────────────

const cjsSource = `
module.exports = function handler(req, res) {
  res.send('ok');
};
`;

const cjsTree = parseFile('handler.js', cjsSource);
check('CJS tree parsed', cjsTree !== null);

if (cjsTree) {
  const r = extractFromJS(cjsTree, 'javascript');
  const exportSym = r.symbols.find(s => s.name === 'default' && s.kind === 'function');
  check('CJS module.exports = fn → default function', exportSym !== undefined);
  check('default has export modifier', exportSym?.modifiers?.includes('export') ?? false);
}

// ─── Case 5: dependencies (import + extends + implements) ────────────────────

const depsSource = `
import { Foo } from './foo';
import Bar from './bar';

class Child extends Foo implements Bar {}
`;

const depsTree = parseFile('deps.ts', depsSource);
if (depsTree) {
  const r = extractFromJS(depsTree, 'typescript');
  check('ESM import ./foo captured', r.dependencies.some(d => d.targetFqn === './foo' && d.kind === 'import'));
  check('ESM import ./bar captured', r.dependencies.some(d => d.targetFqn === './bar' && d.kind === 'import'));
  check('extends Foo captured', r.dependencies.some(d => d.targetFqn === 'Foo' && d.kind === 'extends'));
  check('implements Bar captured', r.dependencies.some(d => d.targetFqn === 'Bar' && d.kind === 'implements'));
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nTS extractor smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
