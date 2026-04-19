# 언어 지원 & 확장 가이드

> 현재 지원 언어 매트릭스와 새 언어(Kotlin 등)를 추가하는 단계별 방법.

---

## 현재 지원 매트릭스

| 언어 | 상태 | grammar 패키지 | 버전 | 추출 파일 |
|---|---|---|---|---|
| TypeScript | ✅ 지원 | `tree-sitter-typescript` | 0.21.2 | `extractors/typescript.ts` |
| JavaScript | ✅ 지원 | `tree-sitter-javascript` | 0.21.4 | `extractors/typescript.ts` (공유) |
| TSX | ✅ 지원 | `tree-sitter-typescript` | 0.21.2 | `extractors/typescript.ts` (공유) |
| Java | ✅ 지원 | `tree-sitter-java` | 0.23.5 | `extractors/java.ts` |
| Kotlin | 🔜 이연 | 미설치 | — | FT-004 (신규 작성 필요) |
| Python | ⛔ 미포함 | 미설치 | — | MVP 범위 밖 |

**JS/TS/TSX**는 `extractors/typescript.ts` 한 파일이 3가지 grammar를 모두 처리한다. 별도 파일을 만들지 말 것.

---

## 언어별 추출 대상

### TypeScript / JavaScript / TSX

`extractors/typescript.ts` (`packages/cli/src/extractors/typescript.ts`)

| 심볼 kind | tree-sitter 노드 타입 | 예시 |
|---|---|---|
| `class` | `class_declaration` | `export class UserService` |
| `function` | `function_declaration`, `arrow_function` | `export function parse()` |
| `method` | `method_definition` | `async getUser()` |
| `field` | `public_field_definition` | `private name: string` |
| `interface` | `interface_declaration` | `interface DbAdapter` |
| `type_alias` | `type_alias_declaration` | `type SymbolKey = string` |
| `enum` | `enum_declaration` | `enum Status` |

추출 제외: primitive type references (`string`, `number`, `Promise` 등), import 구문.

**modifiers 추출**: `static`, `async`, `abstract`, `override`, `readonly`, `public`, `private`, `protected`

---

### Java

`extractors/java.ts` (`packages/cli/src/extractors/java.ts`)

| 심볼 kind | tree-sitter 노드 타입 | 예시 |
|---|---|---|
| `class` | `class_declaration`, `record_declaration` | `public class UserRepository` |
| `interface` | `interface_declaration` | `public interface Indexable` |
| `enum` | `enum_declaration` | `public enum Status` |
| `method` | `method_declaration`, `constructor_declaration` | `public User getById(Long id)` |
| `field` | `field_declaration` | `private final String name` |

**modifiers 추출**: `public`, `private`, `protected`, `static`, `final`, `abstract`, `synchronized`, `native`  
**annotations 추출**: `@Override`, `@Autowired`, `@Entity` 등 (marker_annotation + annotation 노드)

---

## 파일 확장자 매핑

`packages/cli/src/parser/parser.ts`의 `detectLanguage()` 함수가 확장자 → grammar를 결정한다.

현재 매핑:
```
.ts, .tsx       → typescript
.js, .mjs, .cjs → javascript
.java           → java
기타            → null (스킵)
```

---

## Kotlin 미지원 이유 (FT-004)

codeatlas 원본(`kotlin-extractor.ts`)이 **21줄 스텁 + 런타임 throw** 상태여서 이식 불가.  
Kotlin 지원은 **신규 작성**이 필요하다. 착수 조건:

- `tree-sitter-kotlin` npm 패키지 안정성 확인 (현재 community 유지)
- 사내 Kotlin 코드베이스 색인 수요 발생
- 작업은 FT-004로 추적

---

## 새 언어 추가 — 6단계 가이드

아래 예시는 **Python** 추가를 가정한다. 다른 언어도 동일 패턴.

---

### Step 1 — tree-sitter grammar 패키지 추가

```bash
cd packages/cli
pnpm add tree-sitter-python
```

`packages/cli/package.json`에 `"tree-sitter-python": "^..."` 추가 확인.

> native addon이므로 `pnpm install` 후 node-gyp 빌드가 실행된다. 실패 시 Python 3, C++ 빌드 도구 필요.

---

### Step 2 — 추출기 파일 생성

`packages/cli/src/extractors/python.ts` 신규 생성. **`typescript.ts` 또는 `java.ts`를 복제해 시작**한다.

최소 구현 구조:
```typescript
import type Parser from 'tree-sitter';
import type { ExtractionResult } from '@codebase-analysis/shared';

export function extractFromPython(tree: Parser.Tree): ExtractionResult {
  const symbols = [];
  const occurrences = [];
  // ... tree-sitter 노드 순회 ...
  return { symbols, occurrences };
}
```

**추출 대상 결정 기준** (PRD §핵심기능):
- `class` — 클래스 선언
- `function` — 최상위 함수 및 메서드 정의 (`def` 노드)
- `field` — 클래스 레벨 속성 (가능하면)

심볼 `kind` 값은 위 테이블의 기존 kind와 일치시킬 것. 신규 kind 도입은 팀 논의 필요.

---

### Step 3 — `detectLanguage()` + `commands/analyze.ts` 연결

`packages/cli/src/parser/parser.ts`에 확장자 매핑 추가:
```typescript
// 기존
case '.ts': case '.tsx': return 'typescript';
case '.java': return 'java';
// 추가
case '.py': return 'python';
```

`packages/cli/src/commands/analyze.ts`에 새 언어 분기 추가:
```typescript
// 기존
const extraction =
  lang === 'java' ? extractFromJava(tree) : extractFromJS(tree, lang);
// 수정 후
const extraction =
  lang === 'java'   ? extractFromJava(tree) :
  lang === 'python' ? extractFromPython(tree) :
  extractFromJS(tree, lang);
```

---

### Step 4 — 스모크 테스트 작성

`packages/cli/src/extractors/__tests__/python.ts` 생성. `typescript.ts` 또는 `java.ts` 테스트를 참고.

최소 검증:
```typescript
// 기본 class + function 파싱이 심볼 ≥ 1개를 반환하는지 확인
const src = `
class Foo:
    def bar(self):
        pass
`;
const result = extractFromPython(parseSource(src, 'python'));
assert(result.symbols.length >= 2, 'class + method 추출 실패');
```

실행:
```bash
pnpm -F @codebase-analysis/cli tsx src/extractors/__tests__/python.ts
```

---

### Step 5 — `extractors/index.ts` 등록

`packages/cli/src/extractors/index.ts`에 새 추출기 export 추가:
```typescript
export { extractFromPython } from './python.js';
```

---

### Step 6 — 엔드-투-엔드 검증

실제 Python 레포를 대상으로 전체 파이프라인 테스트:

```bash
# 1. 서버 기동 확인
curl http://localhost:3000/healthz

# 2. Python 레포 분석
cd /path/to/python-project
pnpm -F @codebase-analysis/cli dev -- analyze . --repo-name python-test

# 3. 업로드
pnpm -F @codebase-analysis/cli dev -- push --server http://localhost:3000

# 4. 검색 확인
curl "http://localhost:3000/v1/search?q=Foo&repo=python-test"
# symbols 배열이 비어 있지 않아야 함
```

---

## 32K 스트리밍 우회 패턴

`packages/cli/src/parser/parser.ts`는 codeatlas에서 이식한 **tree-sitter 32K 바이트 스트리밍 우회 로직**을 포함한다.

tree-sitter의 `parse()` 함수는 기본적으로 소스를 문자열로 받지만, **32,768 바이트 이상 파일**은 스트리밍 API(`parser.parse(callback)` 형태)가 필요하다. 이를 무시하면 파싱 결과가 잘리거나 오동작한다.

신규 언어 추출기에서 파서를 직접 호출하지 말고, **반드시 `parser/parser.ts`의 `parseFile()` 함수를 경유**할 것:

```typescript
import { parseFile, detectLanguage } from '../parser/parser.js';

const tree = parseFile(filePath, sourceCode);  // 32K 우회 포함
if (!tree) continue;  // 파싱 실패 (지원 언어 아님 등)
```

---

## 확장 가능성 (추후)

| 작업 | 트래킹 | 내용 |
|---|---|---|
| 시맨틱 검색 | FT-001 | LanceDB/pgvector + 임베딩 모델 추가 |
| 그래프 관계 쿼리 | FT-002 | Kuzu 또는 Neo4j로 impact analysis |
| Kotlin 추출기 | FT-004 | `tree-sitter-kotlin` 신규 구현 |
| Python 추출기 | 미추적 | 수요 발생 시 본 가이드 참고해 착수 |

상세 → [FUTURE-TASKS.md](FUTURE-TASKS.md)
