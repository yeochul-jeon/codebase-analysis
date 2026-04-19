# 사용 가이드 — 카테고리별 실사용 레퍼런스

> 처음 설치·기동은 [docs/GETTING-STARTED.md](GETTING-STARTED.md)를 먼저 완료할 것.  
> 이 문서는 **"기동 이후 매일 어떻게 쓰는가"** 를 다룬다.

---

## 1. CLI 일상 워크플로

### 처음 인덱싱

```bash
# analyze: 현재 디렉토리 소스 분석
pnpm -F @codebase-analysis/cli dev -- analyze .

# push: 서버에 업로드
export ANALYZE_UPLOAD_TOKEN=<토큰>
export ANALYZE_SERVER_URL=http://localhost:3000
pnpm -F @codebase-analysis/cli dev -- push
```

상세 설명 → [GETTING-STARTED.md Step 6~7](GETTING-STARTED.md#step-6--첫-인덱스-분석-analyze)

### 코드 변경 후 재인덱싱

코드를 수정하고 새 커밋을 만든 후 그대로 재실행:

```bash
git commit -am "feat: 변경사항"
pnpm -F @codebase-analysis/cli dev -- analyze .
pnpm -F @codebase-analysis/cli dev -- push
```

- 새 `commit_sha`이므로 새 인덱스가 생성되고 `repo_head`가 갱신된다.
- 서버에 데이터가 쌓이지만 **검색은 항상 최신 인덱스**를 반환한다.

**같은 커밋으로 재실행하면?** → `409 Conflict` (정상 동작). 멱등 보장.

### 브랜치별 인덱싱

```bash
# feature 브랜치 색인
pnpm -F @codebase-analysis/cli dev -- analyze . --branch feature/my-branch

# main 브랜치와 비교 검색
curl "http://localhost:3000/v1/search?q=UserService&repo=my-app"              # main HEAD
curl "http://localhost:3000/v1/search?q=UserService&repo=my-app&commit=abc123" # 특정 커밋
```

### Detached HEAD 대응

CI/CD나 `git checkout <sha>` 상태에서는 branch 이름이 없어 검색 시 `404`가 반환될 수 있다.

```bash
# branch 이름을 명시적으로 지정
pnpm -F @codebase-analysis/cli dev -- analyze . --branch main
pnpm -F @codebase-analysis/cli dev -- push
```

### 다른 레포 인덱싱

프로젝트마다 레포 이름이 다르다. `analyze` 결과물(`.codebase-analysis/`)을 그 위치에서 push:

```bash
cd /path/to/other-project
pnpm -F @codebase-analysis/cli dev -- analyze . --repo-name other-project
pnpm -F @codebase-analysis/cli dev -- push
```

---

## 2. 웹 UI 3페이지 투어

브라우저에서 `http://localhost:3000`을 열면 3가지 페이지를 사용할 수 있다.

### 페이지 1 — 검색 `/`

| 입력 필드 | 역할 |
|---|---|
| `repo` | 레포 이름 (push 시 `--repo-name` 또는 디렉토리 이름) |
| `q` | 심볼 이름 (영문·숫자·`_`만 허용) |
| `commit` | 특정 commit SHA 또는 브랜치 (비워두면 HEAD) |

**사용 흐름**:
1. `repo`와 `q`를 입력하고 Enter
2. 결과 목록(이름 · kind · 파일경로:라인)이 표시됨
3. 클릭 → 심볼 상세 페이지(`/s/<key>`)로 이동

**주의**: `q`에 공백·`-`·한글·경로(`src/`)를 입력하면 `400`이 반환된다.

### 페이지 2 — 심볼 상세 `/s/<symbol_key>`

이전 페이지에서 클릭하거나, 직접 key를 URL에 입력.

| 섹션 | 내용 |
|---|---|
| 헤더 | 심볼 이름 + kind + 파일경로:라인범위 |
| Signature | 함수 시그니처 / 클래스 선언 (syntax highlight) |
| Body | 전체 본문 코드 (syntax highlight) |
| References | 이 심볼을 참조하는 위치 목록 |

**References에서 추가 탐색**:
- callee_name 클릭 → 해당 이름으로 검색 (`/`)
- `파일경로:라인` 클릭 → 해당 파일 개요 (`/f`)

### 페이지 3 — 파일 개요 `/f?repo=&path=&commit=`

파일 내 모든 심볼을 목록으로 보여준다.

```
# 직접 접근 예시
http://localhost:3000/f?repo=my-app&path=src/service.ts
http://localhost:3000/f?repo=my-app&path=src/service.ts&commit=abc123
```

| 열 | 내용 |
|---|---|
| 이름 | 심볼명 |
| kind | function / class / interface / method 등 |
| 위치 | `:시작라인` |

심볼을 클릭하면 `/s/<key>` 심볼 상세로 이동.

### 페이지 간 이동 흐름

```
/ (검색)
  └─▶ /s/<key> (심볼 상세)
         ├─▶ / (References → callee_name 클릭 → 재검색)
         └─▶ /f (References → 파일경로 클릭 → 파일 개요)
                └─▶ /s/<key> (파일 내 심볼 클릭)
```

---

## 3. Claude Desktop MCP 실사용

### 연결 확인

Claude Desktop 하단에 **망치(🔨) 아이콘**이 보이면 MCP server가 연결된 것이다.  
아이콘 클릭 → `codebase-analysis` 항목 아래 tool 4종 확인:

| tool | 역할 |
|---|---|
| `search_symbols` | 심볼 이름으로 검색 |
| `get_symbol_body` | 심볼 전체 코드 반환 |
| `get_references` | 심볼 참조 위치 목록 |
| `get_file_overview` | 파일 내 심볼 목록 |

### 실제 대화 예시

**1. 심볼 검색**

```
사용자: UserService 클래스 정의 찾아줘 (repo: my-app)
Claude: [search_symbols 호출]
        → my-app 레포에서 UserService를 찾았습니다. src/services/user.ts:12에 있습니다.
```

**2. 코드 본문 조회**

```
사용자: UserService.getName 메서드 코드 보여줘
Claude: [먼저 search_symbols로 symbol_key 획득 → get_symbol_body 호출]
        → getName(user: User): string { ... } 본문을 반환합니다.
```

**3. 참조 위치 탐색**

```
사용자: UserService를 어디서 호출하는지 알려줘
Claude: [get_references 호출]
        → src/controllers/user.ts:45, src/middleware/auth.ts:12 등 3곳에서 참조됩니다.
        ⚠️ 이름 기반 매칭이므로 동명 심볼의 false positive가 있을 수 있습니다.
```

**4. 파일 구조 파악**

```
사용자: src/services/user.ts 파일에 뭐가 있어?
Claude: [get_file_overview 호출]
        → UserService (class), getName (method), updateUser (method) 등 총 8개 심볼이 있습니다.
```

### 연결이 안 될 때

→ [TROUBLESHOOTING.md — MCP tool이 Claude Desktop에 안 보임](TROUBLESHOOTING.md#4-mcp-tool이-claude-desktop에-안-보임)

---

## 4. Cursor MCP 연결

### 설정 방법

1. Cursor 앱 열기 → **Settings(⌘,)** → 왼쪽 메뉴에서 **"MCP"** 검색
2. "Add MCP Server" 클릭
3. 아래 JSON을 붙여넣기:

```json
{
  "codebase-analysis": {
    "command": "node",
    "args": ["/절대경로/codebase-analysis/packages/mcp-server/dist/index.js"],
    "env": {
      "ANALYZE_SERVER_URL": "http://localhost:3000"
    }
  }
}
```

> `args`의 경로는 본인 환경의 절대 경로로 수정. `~` 또는 상대 경로 사용 불가.

### 빌드 확인

`dist/index.js`가 없으면 먼저 빌드:

```bash
pnpm -F @codebase-analysis/mcp-server build
```

### 연결 확인

Cursor 채팅창에서:
```
@codebase-analysis search_symbols UserService
```
위처럼 tool을 직접 호출하거나, 자연어로 질문하면 Cursor가 자동으로 tool을 선택한다.

---

## 5. REST API 실사용

### 검색 → 상세 → 본문 파이프

```bash
# 1. 검색으로 symbol_key 획득
SYMBOL_KEY=$(curl -s "http://localhost:3000/v1/search?q=UserService&repo=my-app" \
  | jq -r '.symbols[0].symbol_key')

echo "Key: $SYMBOL_KEY"

# 2. 심볼 메타데이터
curl -s "http://localhost:3000/v1/symbols/$SYMBOL_KEY" | jq '.symbol'

# 3. 코드 본문
curl -s "http://localhost:3000/v1/symbols/$SYMBOL_KEY/body" | jq '.body'

# 4. 참조 목록
curl -s "http://localhost:3000/v1/symbols/$SYMBOL_KEY/references" | jq '.occurrences'
```

### OpenAPI 스펙 조회

```bash
curl -s http://localhost:3000/openapi.json | jq '.paths | keys'
```

### `q` 파라미터 제약

`q`는 `[A-Za-z0-9_]+` 정규식만 허용. 다음은 모두 `400`을 반환:

```bash
# ❌ 공백 포함
curl ".../v1/search?q=User Service"

# ❌ 경로 입력
curl ".../v1/search?q=src/service.ts"

# ❌ 특수문자
curl ".../v1/search?q=getUser-by-id"

# ✅ 허용
curl ".../v1/search?q=getUserById"
```

---

## 참조

- 설치·기동 → [docs/GETTING-STARTED.md](GETTING-STARTED.md)
- REST/MCP 전체 레퍼런스 → [docs/API.md](API.md)
- 문제 해결 체크리스트 → [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
