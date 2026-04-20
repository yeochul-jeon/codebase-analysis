# 세션 가이드 — 2026-04-20

이 문서는 2026-04-20 세션에서 다룬 주요 질문과 답변을 정리한 것입니다.

---

## 1. Claude Code CLI에서 MCP 등록하는 방법

### 프로젝트-스코프 (권장)

레포 루트의 `.mcp.json`이 있으면 해당 디렉터리에서 `claude`를 실행할 때 자동 인식됩니다.

```json
{
  "mcpServers": {
    "codebase-analysis": {
      "command": "node",
      "args": ["/절대경로/codebase-analysis/packages/mcp-server/dist/index.js"],
      "env": {
        "ANALYZE_SERVER_URL": "http://localhost:3000"
      }
    }
  }
}
```

> `args`의 경로는 본인 환경의 절대 경로로 수정. `~` 또는 상대 경로 사용 불가.

### 개인-스코프 등록

`.mcp.json` 없이 전역 등록하려면:

```bash
claude mcp add codebase-analysis \
  -- node /절대경로/packages/mcp-server/dist/index.js \
  -e ANALYZE_SERVER_URL=http://localhost:3000
```

### 빌드 전제

`dist/index.js`가 없으면 먼저 빌드:

```bash
pnpm -F @codebase-analysis/mcp-server build
```

### 연결 확인

```bash
claude mcp list   # codebase-analysis 항목 확인
```

세션 내에서 `/mcp` 입력 → `codebase-analysis` 아래 tool 4종 노출:

| tool | 역할 |
|---|---|
| `search_symbols` | 심볼 이름으로 검색 |
| `get_symbol_body` | 심볼 전체 코드 반환 |
| `get_references` | 심볼 참조 위치 목록 |
| `get_file_overview` | 파일 내 심볼 목록 |

---

## 2. PostgreSQL · S3 교체 가능 여부

**이미 구현되어 있습니다.** 환경변수만 바꾸면 됩니다.

### 설계 구조

| 레이어 | 파일 | 역할 |
|---|---|---|
| 인터페이스 | `packages/server/src/storage/db/types.ts:43–95` | `DbAdapter` — 20개 메서드 계약 |
| 인터페이스 | `packages/server/src/storage/blob/types.ts:1–16` | `BlobAdapter` — 3개 메서드 계약 |
| 구현체 | `SqliteAdapter`, `PgAdapter` | `DbAdapter` 구현 |
| 구현체 | `FsBlobAdapter`, `S3BlobAdapter` | `BlobAdapter` 구현 |
| 팩토리 | `packages/server/src/storage/factory.ts` | env 읽어서 구현체 선택 |
| 진입점 | `packages/server/src/dev.ts` → `createApp(AppDeps)` | 팩토리 결과를 DI |

### DB 교체: SQLite → PostgreSQL

```bash
DB_BACKEND=pg
PG_URL=postgresql://user:pass@host:5432/dbname
```

### Blob 교체: 로컬 FS → S3

```bash
STORAGE_BACKEND=s3
S3_BUCKET=my-bucket
S3_REGION=ap-northeast-2        # optional
S3_ENDPOINT=https://...         # optional (MinIO 등 호환 스토리지)
S3_FORCE_PATH_STYLE=true        # optional
# AWS 자격증명은 환경변수 또는 IAM role로 주입
```

코드 변경 없이 env 변수만으로 4가지 조합(SQLite+FS / SQLite+S3 / PG+FS / PG+S3) 전환이 가능합니다.

---

## 3. 전체 데이터 플로우

분석·업로드는 CLI가 담당하고, Claude Code(또는 Claude Desktop/Cursor)는 이미 인덱싱된 데이터를 MCP tool로 조회하는 역할입니다.

```
개발자 로컬 (또는 CI)             서버                      AI 클라이언트
──────────────────────           ──────────────────         ───────────────
1. pnpm cli analyze .
   └─ tree-sitter로 파싱
   └─ .codebase-analysis/
       ├── index.json
       └── source.zip

2. pnpm cli push
   ├─ POST /v1/repos/:name/indexes   → index_id 생성
   ├─ PUT  /v1/indexes/:id/index-json → SQLite에 심볼·참조 저장
   ├─ PUT  /v1/indexes/:id/source-zip → FS Blob에 소스 저장
   └─ PATCH /v1/indexes/:id          → status = 'ready'

                                                    3. Claude Code / Claude Desktop / Cursor
                                                       MCP tool 호출
                                                       └─ search_symbols
                                                       └─ get_symbol_body
                                                       └─ get_references
                                                       └─ get_file_overview
```

### 핵심 설계 결정

| 항목 | 현재 방식 | 의미 |
|---|---|---|
| 분석 위치 | 클라이언트(CLI) | 서버에 파서 불필요, 언어 추가는 CLI만 수정 |
| 파서 | tree-sitter (TS/JS/Java) | 서버 무관하게 로컬 실행 |
| 업로드 주체 | 개발자 또는 CI | AI 도구가 자동화 가능 |
| CI 연동 | 현재 없음 | GitHub Actions 추가 시 PR마다 자동 push 가능 |

---

## 4. 처음 인덱싱 절차

인덱싱된 데이터가 없으면 MCP tool 쿼리 결과가 비어 있습니다. 먼저 아래를 실행해야 합니다.

### 1단계: 환경변수 설정

```bash
export ANALYZE_UPLOAD_TOKEN=your-secret-token   # 서버의 ANALYZE_UPLOAD_TOKEN과 동일
export ANALYZE_SERVER_URL=http://localhost:3000  # 서버 주소
```

### 2단계: 분석 (로컬 파싱)

```bash
pnpm -F @codebase-analysis/cli dev -- analyze .
```

결과물:

```
.codebase-analysis/
├── index.json   ← 심볼·참조 데이터
└── source.zip   ← 원본 소스 압축본
```

### 3단계: 업로드

```bash
pnpm -F @codebase-analysis/cli dev -- push
```

### 이후 재인덱싱

코드 변경 후 동일하게 `analyze → push` 반복. 서버는 기존 인덱스를 reset하고 새 데이터로 교체합니다.

---

## 참조

- 전체 사용 가이드 → [docs/USAGE.md](USAGE.md)
- 초기 설치·기동 → [docs/GETTING-STARTED.md](GETTING-STARTED.md)
- 문제 해결 → [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- 팀 소개 자료 → [docs/TEAM-INTRO.md](TEAM-INTRO.md)
