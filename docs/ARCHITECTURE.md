# 아키텍처

> MVP 스택: **Node.js 22 LTS + TypeScript + Hono** (OQ-001 결정, ADR-013).

> **구현 상태**: 현재 동작 경로는 **Variant A (SQLite + 로컬 FS)** 이다.  
> Variant B (PostgreSQL + S3)는 Contract MVP 완료 (OQ-008 Option B, 2026-04-19). `RUN_VARIANT_B=1`로 contract test 통과. 실레포 dogfooding은 별도 세션.  
> 상태 배지: ✅ 구현 완료 | 🔶 스텁/인터페이스만 | 🔜 계획 | ⛔ 범위 밖

---

## 현재 디렉토리 구조

아래 구조는 **현재 저장소에 실제로 존재하는** 경로만 포함한다.

```
codebase-analysis/
├── packages/
│   ├── shared/              ✅ 공통 타입 · Zod 스키마 (런타임 의존성 없음)
│   │   └── src/
│   │       ├── index.ts
│   │       └── types.ts
│   ├── cli/                 ✅ analyze · push 명령어
│   │   └── src/
│   │       ├── commands/
│   │       │   ├── analyze.ts
│   │       │   └── push.ts
│   │       ├── extractors/  ✅ 언어별 심볼 추출기 (codeatlas 이식)
│   │       │   ├── index.ts
│   │       │   ├── typescript.ts  (JS/TS/TSX 공용)
│   │       │   └── java.ts
│   │       ├── parser/      ✅ tree-sitter 통합 (32K 스트리밍 우회 포함)
│   │       ├── packer/      ✅ index.json + source.zip 생성
│   │       └── walker/      ✅ 파일 수집 · 언어 필터
│   ├── server/              ✅ Hono REST API + 정적 웹 UI
│   │   └── src/
│   │       ├── routes/      ✅ /v1/indexes, /v1/search, /v1/symbols, /healthz
│   │       ├── middleware/  ✅ bearer.ts (쓰기 엔드포인트 인증)
│   │       ├── schemas/     ✅ packed-index.ts (Zod 단일 출처)
│   │       ├── storage/
│   │       │   ├── db/
│   │       │   │   ├── types.ts    ✅ DbAdapter 인터페이스
│   │       │   │   ├── sqlite.ts   ✅ Variant A 구현
│   │       │   │   ├── pg.ts       ✅ Variant B 구현 (Contract MVP)
│   │       │   │   ├── migrate.ts  ✅ SQLite 마이그레이션 러너
│   │       │   │   ├── migrate-pg.ts ✅ PG 마이그레이션 러너
│   │       │   │   ├── migrations/ ✅ 번호 기반 SQL 파일 (SQLite)
│   │       │   │   └── migrations-pg/ ✅ 번호 기반 SQL 파일 (PG)
│   │       │   └── blob/
│   │       │       ├── types.ts    ✅ BlobAdapter 인터페이스
│   │       │       ├── fs.ts       ✅ Variant A 구현
│   │       │       └── s3.ts       ✅ Variant B 구현 (Contract MVP)
│   │       ├── public/      ✅ 정적 웹 UI (vanilla HTML/CSS/JS, 3 pages)
│   │       ├── app.ts       ✅ Hono 앱 팩토리
│   │       ├── dev.ts       ✅ 서버 진입점 (어댑터 wiring)
│   │       └── index.ts
│   └── mcp-server/          ✅ MCP stdio shim (Claude Desktop · Cursor)
│       └── src/
│           ├── tools/       ✅ 4개 MCP tool (search_symbols 등)
│           ├── client.ts    ✅ HTTP 클라이언트 → server 호출
│           └── index.ts     ✅ StdioServerTransport
├── docs/                    ✅ ADR, PRD, ARCHITECTURE, 작업 로그 등
├── docker/                  ✅ Dockerfile + docker-compose.yml (Variant A)
└── data/                    ✅ 런타임 SQLite + blobs (로컬 개발용)
```

### 목표 구조 (현재 미존재, 향후 착수 시 추가)

```
├── infra/                   🔜 CDK/Terraform 스니펫 (Variant B 전환 시)
└── scripts/                 🔜 setup, backup, migration 헬퍼
```

---

## 패턴

### Storage Adapter Pattern (ADR-003)

`storage/db`와 `storage/blob` 각각 인터페이스로 정의. `server/src/storage/factory.ts`가 `DB_BACKEND`(`sqlite`|`pg`) · `STORAGE_BACKEND`(`fs`|`s3`) 환경변수로 어댑터를 선택한다. 기본값은 `sqlite`·`fs` (ADR-022).

| 계층 | Variant A | 상태 | Variant B | 상태 |
|---|---|---|---|---|
| DB | `storage/db/sqlite.ts` | ✅ 구현 | `storage/db/pg.ts` | ✅ Contract MVP |
| Blob | `storage/blob/fs.ts` | ✅ 구현 | `storage/blob/s3.ts` | ✅ Contract MVP |

- **비즈니스 로직은 인터페이스에만 의존** — 라우트·쿼리 로직이 어댑터 구현 세부사항을 알지 않는다.
- **라우트는 그대로 두고 어댑터만 교체** — Variant B 전환 시 routes/*.ts 수정 없음.

### 단일 프로세스 + 멱등 핸들러 (ADR-001, ADR-010)

모든 요청은 stateless. `(repo_name, commit_sha)` 조합으로 업로드 멱등 보장.  
동일 조합 재업로드 시 이미 `ready`인 경우 `409`를 반환하고 스킵.

### Zod 스키마 단일 출처

REST API 요청 검증, MCP tool inputSchema, DB row 타입을 모두 Zod 스키마에서 파생.  
`@hono/zod-openapi`로 `/openapi.json` 자동 노출.

### 선언형 파이프라인

`analyze .` → `index.json` + `source.zip` → `push` → 서버 4단계 HTTP 업로드.  
각 단계가 독립적으로 멱등.

---

## 데이터 흐름

### 업로드 경로 (개발자 / CI)

`push` 명령은 단일 요청이 아니라 **4단계 REST 호출**로 업로드를 수행한다.  
`multipart` 업로드는 사용하지 않는다.

```
┌──────────┐   analyze .         ┌───────────────────┐
│ 소스 코드 │ ───────────────▶   │ CLI (tree-sitter) │
└──────────┘                     │  extractors/*     │
                                 └─────────┬─────────┘
                                           │ .codebase-analysis/
                                           │  index.json + source.zip
                                           ▼
                             ┌─────────────────────────────┐
                             │ analyze push                │
                             │                             │
                             │ 1. POST /v1/repos/:name/indexes     (Bearer)
                             │ 2. PUT  /v1/indexes/:id/index-json  (JSON)
                             │ 3. PUT  /v1/indexes/:id/source-zip  (binary)
                             │ 4. PATCH /v1/indexes/:id            (finalize)
                             └─────────┬───────────────────┘
                                       │
                                       ▼
                             ┌───────────────────┐
                             │ Hono 서버         │
                             │ routes/indexes.ts │
                             └───────┬───┬───────┘
                                     │   │
                          storage/   │   │ storage/
                          blob       │   │ db
                                     ▼   ▼
                       [zip → FS]   [symbols/occurrences/repo_head → SQLite]
```

### 조회 경로 (IDE · AI 에이전트)

```
┌──────────┐  GET /v1/search         ┌───────────────────┐
│ 브라우저 │  GET /v1/symbols/:key   │ Hono 서버         │
│ IDE/CLI  │ ──────────────────▶     │ commit-resolver   │ ──▶ [repo_head → commit_sha]
└──────────┘                         │ FTS5 검색         │ ──▶ [symbols 테이블]
                                     │ zip entry 추출    │ ──▶ [source.zip]
                                     └───────────────────┘

Claude Desktop → MCP stdio shim (packages/mcp-server)
             → HTTP fetch → Hono 서버 → 위 흐름과 동일
```

**커밋 해석 규약** (ADR-009): `commit 명시 → branch 지정 → repos.default_branch HEAD` 순서.  
비결정적 `ORDER BY created_at DESC` 금지.  
`branch=null`(detached HEAD)로 업로드한 인덱스는 branch 경로로 조회 불가 — 조회 시 `commit=<sha>` 명시 필요.

---

## 상태 관리

- **서버**: 완전 stateless. 요청별 DB 트랜잭션으로 일관성 보장.
  - 업로드 상태(`indexes.status`): `uploading` → `ready` | `failed`
  - 최신 포인터(`repo_head`): branch별 current index_id 추적
- **CLI**: `.codebase-analysis/` 폴더에 `index.json`·`source.zip` 생성. push 성공 후 잔존.
- **웹 UI**: URL query param 기반(`?q=&repo=`). 클라이언트 상태 없음.
- **MCP 서버**: 개별 호출당 HTTP 프록시. 세션 상태 없음.

---

## 코드 이식 출처 — codeatlas (MIT)

| 이식 대상 | 원본 경로 | 대상 경로 | 상태 |
|---|---|---|---|
| tree-sitter 파서 래퍼 (32K 스트리밍 우회) | `src/indexer/tree-sitter/parser.ts:52-78` | `packages/cli/src/parser/` | ✅ 이식 완료 |
| Java 심볼 추출기 | `src/indexer/tree-sitter/java-extractor.ts` | `packages/cli/src/extractors/java.ts` | ✅ 이식 완료 |
| TS/JS 심볼 추출기 | `src/indexer/tree-sitter/js-extractor.ts` | `packages/cli/src/extractors/typescript.ts` | ✅ 이식 완료 |
| MCP tool 시그니처 참조 | `src/mcp/server.ts` (24개 중 탐색 계열) | `packages/mcp-server/src/tools/` | ✅ 이식 완료 |

> **주의**: codeatlas `kotlin-extractor.ts`는 21줄 스텁·런타임 throw → 이식 불가. Kotlin은 FT-004로 이연.

**미이식 (MVP 범위 밖)**: LanceDB 시맨틱 검색, Kuzu 그래프, Anthropic summarizer, rename/replace/insert 편집 tool.
