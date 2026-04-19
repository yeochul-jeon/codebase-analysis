import { parseFile } from '../../parser/parser.js';
import { extractFromJava } from '../java.js';

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

// ─── Case 1: class + method + field + constructor + annotation ────────────────

const javaSource = `
import com.example.Service;
import com.example.Repository;

@Entity
public class UserService extends Service implements Repository {
    private String name;

    public UserService(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void process() {
        getName();
    }
}
`;

const javaTree = parseFile('UserService.java', javaSource);
check('Java tree parsed', javaTree !== null);

if (javaTree) {
  const r = extractFromJava(javaTree);

  const names = r.symbols.map(s => s.name);
  check('UserService class', names.includes('UserService'));
  check('name field', names.includes('name'));
  check('UserService constructor', names.includes('UserService') && r.symbols.some(s => s.kind === 'constructor'));
  check('getName method', names.includes('getName'));
  check('process method', names.includes('process'));

  const cls = r.symbols.find(s => s.name === 'UserService' && s.kind === 'class');
  check('UserService is class kind', cls?.kind === 'class');
  check('@Entity annotation on UserService', cls?.annotations?.includes('@Entity') ?? false);

  const field = r.symbols.find(s => s.name === 'name' && s.kind === 'field');
  check('name field found', field !== undefined);
  check('name field has private modifier', field?.modifiers?.includes('private') ?? false);

  // _nodeId + parent_id chain
  check('UserService _nodeId defined', cls?._nodeId !== undefined);
  const children = r.symbols.filter(s => s.parent_id === cls?._nodeId);
  check('UserService has child symbols', children.length >= 2);
}

// ─── Case 2: call refs ────────────────────────────────────────────────────────

const refSource = `
public class Caller {
    public void run() {
        doSomething();
        helper.process();
    }
}
`;

const refTree = parseFile('Caller.java', refSource);
if (refTree) {
  const r = extractFromJava(refTree);
  check('doSomething call ref', r.refs.some(ref => ref.calleeName === 'doSomething' && ref.kind === 'call'));
  check('process call ref', r.refs.some(ref => ref.calleeName === 'process' && ref.kind === 'call'));
}

// ─── Case 3: dependencies (import + extends + implements) ────────────────────

const depsSource = `
import com.example.Service;
import com.example.Repository;

public class MyService extends Service implements Repository {}
`;

const depsTree = parseFile('MyService.java', depsSource);
if (depsTree) {
  const r = extractFromJava(depsTree);
  check('import com.example.Service', r.dependencies.some(d => d.kind === 'import' && d.targetFqn.includes('Service')));
  check('extends Service', r.dependencies.some(d => d.kind === 'extends'));
  check('implements Repository', r.dependencies.some(d => d.kind === 'implements'));
}

// ─── Case 4: _nodeId integrity ────────────────────────────────────────────────

const hierarchySource = `
public class Outer {
    private int value;
    public int getValue() { return value; }
}
`;

const hierarchyTree = parseFile('Outer.java', hierarchySource);
if (hierarchyTree) {
  const r = extractFromJava(hierarchyTree);
  const outer = r.symbols.find(s => s.name === 'Outer' && s.kind === 'class');
  check('Outer _nodeId defined', outer?._nodeId !== undefined);

  const getValue = r.symbols.find(s => s.name === 'getValue');
  check('getValue parent_id === Outer._nodeId', getValue?.parent_id === outer?._nodeId);

  const value = r.symbols.find(s => s.name === 'value' && s.kind === 'field');
  check('value field parent_id === Outer._nodeId', value?.parent_id === outer?._nodeId);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nJava extractor smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
