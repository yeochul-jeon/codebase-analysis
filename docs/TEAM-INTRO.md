# codebase-analysis — 팀 소개 자료

> **한 줄 요약**: 사내 코드를 색인하면 Claude·Cursor 같은 AI 에이전트가 레포를 체크아웃 없이 즉시 조회할 수 있습니다.

---

## 왜 만들었나

AI 에이전트(Claude, Cursor 등)에 코드 컨텍스트를 주려면 보통 전체 파일을 프롬프트에 붙여넣어야 합니다. 레포가 크면 컨텍스트 한도를 초과하고, 어디를 잘라 붙여넣을지도 매번 판단해야 합니다.

**codebase-analysis**는 이 문제를 해결합니다.

- CLI가 코드를 심볼 단위로 색인해 서버에 업로드
- AI 에이전트는 MCP tool 4종으로 "필요한 심볼만" 정확하게 조회
- 팀 레포를 등록해두면 Claude가 "그 함수 어디 있어?"를 즉시 답할 수 있음

---

## 시스템 구성

```
개발자 / CI
    │  analyze . && push
    ▼
 CLI (pnpm)
    │  4단계 HTTP 업로드 (Bearer token)
    ▼
Hono 서버 ─── SQLite (심볼 FTS5 인덱스)
    │       └── zip 파일 (소스 본문)
    ├── REST API  ←── 브라우저 / curl
    ├── Web UI    ←── 검색 · 심볼 상세 · 파일 개요
    └── MCP stdio ←── Claude Desktop / Cursor
```

| 컴포넌트 | 기술 |
|---|---|
| 서버 | Node.js 22 + Hono + TypeScript |
| DB | SQLite (FTS5 전문 검색) |
| 파서 | tree-sitter (TS · JS · Java) |
| 배포 | Docker Compose 단일 컨테이너 |
| AI 연동 | MCP (Model Context Protocol) stdio |

---

## 핵심 기능

### 1. 심볼 색인 · 업로드

```bash
pnpm -F @codebase-analysis/cli dev -- analyze .   # 심볼 추출
pnpm -F @codebase-analysis/cli dev -- push         # 서버에 업로드
```

- TypeScript · JavaScript · Java 지원
- 함수 · 클래스 · 인터페이스 · 메서드 · 변수 추출
- 동일 커밋 재실행 시 409 (안전한 멱등 처리)

### 2. Web UI 검색

`http://localhost:3000` 에서 심볼 이름 검색 → 상세 조회

| 페이지 | 내용 |
|---|---|
| `/` | 심볼 이름 검색 |
| `/s/<key>` | signature · body · references |
| `/f?repo=&path=` | 파일 내 심볼 목록 |

### 3. MCP tool 4종 — AI 에이전트 직접 연동

Claude Desktop · Cursor에 등록하면 자연어로 코드 조회 가능.

| tool | 역할 | 예시 질문 |
|---|---|---|
| `search_symbols` | 심볼 이름으로 검색 | "UserService 어디 있어?" |
| `get_symbol_body` | 심볼 코드 본문 반환 | "getUserById 코드 보여줘" |
| `get_references` | 심볼 참조 위치 목록 | "createApp이 어디서 호출돼?" |
| `get_file_overview` | 파일 내 심볼 목록 | "routes/reads.ts에 뭐가 있어?" |

### 4. REST API

```bash
GET /v1/search?q=UserService&repo=my-app
GET /v1/symbols/:key/body
GET /v1/symbols/:key/references
GET /v1/repos/:name/file-symbols?path=src/service.ts
```

---

## 10분 데모 시나리오

> **발표자 준비**: 발표 전 아래 사전 설정을 완료할 것.

### 사전 설정

```bash
# 1. 서버 기동
cd /Users/cjenm/cjenm/platform/codebase-analysis
cp docker/.env.example docker/.env   # ANALYZE_UPLOAD_TOKEN=demo-secret-token
docker compose -f docker/docker-compose.yml up --build -d

# 2. MCP 서버 빌드 (최초 1회)
pnpm -F @codebase-analysis/mcp-server build

# 3. Claude Desktop MCP 설정 등록
# 파일: ~/.claude/claude_desktop_config.json
{
  "mcpServers": {
    "codebase-analysis": {
      "command": "node",
      "args": ["/Users/cjenm/cjenm/platform/codebase-analysis/packages/mcp-server/dist/index.js"],
      "env": { "ANALYZE_SERVER_URL": "http://localhost:3000" }
    }
  }
}
# → Claude Desktop 재시작 필요

# 4. 색인 미리 실행 (발표 중 기다리지 않도록)
export ANALYZE_UPLOAD_TOKEN=demo-secret-token
export ANALYZE_SERVER_URL=http://localhost:3000
pnpm -F @codebase-analysis/cli dev -- analyze .
pnpm -F @codebase-analysis/cli dev -- push
```

---

### STEP 1 · 서버 기동 확인 [00:00 — 01:30]

```bash
curl http://localhost:3000/healthz
# → {"status":"ok"}
```

브라우저에서 `http://localhost:3000` 열기.

> 💬 "Docker 하나로 끝납니다. DB 서버, 별도 인프라 없이 SQLite + 로컬 파일 저장."

---

### STEP 2 · 이 레포 색인 [01:30 — 03:30]

```bash
pnpm -F @codebase-analysis/cli dev -- analyze .
# → 463 symbols / 35 files 추출

pnpm -F @codebase-analysis/cli dev -- push
# → index_id=1, status: ready

# 멱등성 시연 — 같은 커밋 재실행
pnpm -F @codebase-analysis/cli dev -- push
# → "already ready — skipping"
```

> 💬 "TS·JS·Java를 tree-sitter로 파싱합니다. 같은 커밋을 두 번 올려도 데이터가 깨지지 않습니다."

---

### STEP 3 · Web UI 투어 [03:30 — 05:30]

브라우저 `http://localhost:3000`:

1. `repo=codebase-analysis`, `q=createApp` 입력 → Enter
2. 결과 클릭 → 심볼 상세 (signature + body + references)
3. references의 파일 경로 클릭 → 파일 개요

> 💬 "팀원이 처음 보는 코드 파일의 구조를 IDE 없이 파악할 수 있습니다."

---

### STEP 4 · MCP 하이라이트 ★ [05:30 — 09:30]

Claude Desktop 열기 → 하단 🔨 아이콘 → `codebase-analysis` tool 4종 확인.

#### 시나리오 A — 심볼 검색
```
"codebase-analysis 레포에서 SqliteAdapter 클래스 찾아줘"
```
→ `search_symbols` 자동 호출 → 파일 경로 + 라인 반환

#### 시나리오 B — 코드 본문 조회
```
"SqliteAdapter의 searchSymbols 메서드 코드 보여줘"
```
→ `get_symbol_body` 호출 → 실제 소스 코드 반환

> 💬 "레포 클론 없이, IDE 없이 코드 본문을 가져옵니다."

#### 시나리오 C — 참조 위치 탐색
```
"createApp을 어디서 호출하는지 알려줘"
```
→ `get_references` 호출 → 파일경로 + 라인 목록

> 💬 "영향 분석의 첫 단계입니다. tree-sitter 기반 이름 매칭이므로 false positive가 있을 수 있습니다."

#### 시나리오 D — 파일 구조 파악
```
"packages/server/src/routes/reads.ts 파일에 어떤 함수들이 있어?"
```
→ `get_file_overview` 호출 → 파일 내 심볼 목록

> 💬 "코드 리뷰 전 파일 구조 파악, PR 리뷰 보조에 유용합니다."

---

### 클로징 [09:30 — 10:00]

> 💬 "CLI로 색인 → 서버 저장 → Claude/Cursor MCP로 조회. 팀 레포를 등록해두면 AI 에이전트가 사내 코드 컨텍스트를 바로 씁니다. 현재 TS·JS·Java 지원, Kotlin도 추가 예정입니다."

---

## 예상 Q&A

| 질문 | 답변 |
|---|---|
| 보안은 어떻게 되나요? | 업로드는 Bearer token 필수. 조회는 사내망·VPN 전제로 공개. OIDC는 추후 예정. |
| 코드 변경되면 어떻게 업데이트하나요? | 커밋 후 `analyze && push` 재실행. CI 파이프라인 스텝으로 자동화 가능. |
| 대형 레포는 얼마나 빠른가요? | 현재 SQLite FTS5 기반. 대규모 성능 기준선은 측정 예정 (FT-006). |
| Kotlin이나 Python은요? | Kotlin은 FT-004, Python은 FT-003으로 추가 예정. |
| 외부 서비스 의존성이 있나요? | 없습니다. Docker 하나로 self-host, 외부 API 호출 없음. |
| Cursor에서도 되나요? | 네. Cursor MCP 설정에 동일한 stdio 서버를 등록하면 됩니다. |

---

## 다음 단계

- **팀 레포 등록**: 색인할 레포에서 `analyze . && push` 실행
- **CI 연동**: push 커맨드를 GitHub Actions 스텝에 추가
- **Claude Desktop 설정**: 위 MCP 설정 JSON을 팀원에게 공유
- **Cursor 설정**: `docs/USAGE.md §4` 참고

---

*문서 위치: `docs/TEAM-INTRO.md` · 마지막 업데이트: 2026-04-20*
