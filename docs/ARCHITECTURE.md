# 아키텍처

> MVP 스택: **Node.js 22 LTS + TypeScript + Hono** (OQ-001 권고안 기준).
> 저장소 변형: Variant A(SQLite + 로컬 FS) 또는 Variant B(PostgreSQL + S3). 어댑터로 교체.

---

## 디렉토리 구조

```
codebase-analysis/
├── packages/
│   ├── server/              # Hono API 서버 (REST + MCP + 정적 UI)
│   │   ├── src/
│   │   │   ├── routes/      # /v1/indexes, /v1/search, /v1/symbols, /healthz
│   │   │   ├── mcp/         # MCP 읽기 전용 tool 핸들러 (4개)
│   │   │   ├── storage/
│   │   │   │   ├── db/      # SQLite / PG 어댑터 (공통 인터페이스)
│   │   │   │   └── blob/    # 로컬 FS / S3 어댑터 (공통 인터페이스)
│   │   │   ├── services/    # commit-resolver, fts-indexer 등
│   │   │   ├── schemas/     # zod 스키마 (API 계약 단일 출처)
│   │   │   └── web/         # 최소 웹 UI (vanilla HTML + JS)
│   │   └── migrations/      # DB 스키마 버전 관리
│   ├── cli/                 # analyze CLI (tree-sitter 인덱서)
│   │   └── src/
│   │       ├── extractors/  # 언어별 심볼 추출기 (codeatlas 이식)
│   │       │   ├── typescript.ts
│   │       │   ├── java.ts
│   │       │   └── python.ts
│   │       ├── parser/      # tree-sitter 통합 (32K 스트리밍 우회 포함)
│   │       ├── packer/      # index.json + source.zip 패키징
│   │       └── commands/    # analyze, push, status
│   ├── shared/              # 공통 타입 · zod 스키마 · 상수
│   └── mcp-server/          # 독립 실행 MCP stdio shim
├── docs/                    # ADR, PRD, ARCHITECTURE, work-log, OPEN-QUESTIONS
├── docker/                  # Dockerfile + docker-compose.yml (Variant A)
├── infra/                   # CDK/Terraform 스니펫 (Variant B, 선택)
└── scripts/                 # setup, backup, migration 헬퍼
```

**패키지 매니저**: `pnpm` workspace. `packages/*`가 내부 의존성을 `workspace:*`로 참조.

---

## 패턴

- **Storage Adapter Pattern** (ADR-003): `storage/db`와 `storage/blob`은 인터페이스로 정의되고, 런타임 환경변수(`DATABASE_URL`, `BLOBS_DIR`/`S3_BUCKET`)로 구현체 선택. 비즈니스 로직은 어댑터에 직접 의존하지 않는다.
- **단일 프로세스 + 멱등 핸들러** (ADR-001, ADR-010): 모든 요청은 stateless. `(repo_id, commit_sha)` 조합으로 멱등 보장.
- **zod 스키마 단일 출처**: REST API · MCP tool · DB row 타입을 zod 스키마 하나에서 파생. `@hono/zod-openapi`로 OpenAPI 자동 생성.
- **CI-wins 미적용**: 우리 MVP는 클라이언트 구분 없는 단일 `Authorization: Bearer` 모델 (ADR-007). CI/client 충돌 규칙은 SCIP 기반 CMS 본 프로젝트 전용.
- **선언형 파이프라인**: CLI `analyze .` → `index.json` + `source.zip` 생성 → `analyze push`로 `PUT /v1/indexes` 업로드. 각 단계가 idempotent.

---

## 데이터 흐름

### 업로드 경로 (개발자 / CI)

```
┌──────────┐   analyze .         ┌───────────────────┐
│ 소스 코드 │ ───────────────▶   │ CLI (tree-sitter) │
└──────────┘                     │  extractors/*     │
                                 └─────────┬─────────┘
                                           │ index.json + source.zip
                                           ▼
                                 ┌───────────────────┐
                                 │ analyze push      │
                                 │ PUT /v1/indexes   │
                                 └─────────┬─────────┘
                                           │ multipart (Bearer token)
                                           ▼
                                 ┌───────────────────┐
                                 │ Hono 서버         │
                                 │ routes/indexes.ts │
                                 └───────┬───┬───────┘
                                         │   │
                              storage/blob│   │storage/db
                                         ▼   ▼
                            [zip → FS/S3]   [symbols/refs/repo_head → SQLite/PG]
```

### 조회 경로 (IDE · AI 에이전트)

```
┌──────────┐  GET /v1/search       ┌───────────────────┐
│ 브라우저 │  GET /v1/symbols/:key │ Hono 서버         │
│ IDE/CLI  │ ──────────────────▶   │ commit-resolver   │ ─▶ [repo_head → commit_sha]
│ MCP cli  │  MCP tool call        │ FTS5 / tsvector   │ ─▶ [symbols 테이블]
└──────────┘                       │ zip entry 추출    │ ─▶ [source.zip]
                                   └───────────────────┘
MCP stdio (launched by Claude Desktop) → mcp-server → fetch → Hono 서버
```

**커밋 해석 규약** (ADR-009): `commit 지정 → branch 지정 → repos.default_branch`. 비결정적 `ORDER BY created_at DESC` 금지.

---

## 상태 관리

- **서버**: 완전 stateless. 요청별 DB 트랜잭션으로 일관성 보장.
  - 업로드 중 상태(`indexes.status`): `uploading` → `ready` | `failed`
  - 최신 포인터(`repo_head`): branch별 current commit 추적
- **CLI**: 로컬 `.analyze/` 폴더에 임시 `index.json`·`source.zip` 생성. push 성공 시 정리.
- **웹 UI**: URL query param 기반(`?q=&repo=&lang=`). 클라이언트 상태 저장소 없음.
- **MCP 서버**: 개별 호출당 HTTP API를 proxying. 세션 상태 없음.

---

## 코드 이식 출처 — codeatlas (MIT)

우리 MVP는 **`/Users/cjenm/cjenm/platform/codeatlas`**를 참고하여 다음을 선택 이식한다 (ADR-014 예정):

| 이식 대상 | 원본 경로 | 대상 경로 |
|---|---|---|
| tree-sitter 파서 래퍼 (32K 스트리밍 우회) | `src/indexer/tree-sitter/parser.ts:52-78` | `packages/cli/src/parser/` |
| Java 심볼 추출기 | `src/indexer/tree-sitter/java-extractor.ts` | `packages/cli/src/extractors/java.ts` |
| TS/JS 심볼 추출기 | `src/indexer/tree-sitter/js-extractor.ts` | `packages/cli/src/extractors/typescript.ts` |
| MCP tool 시그니처 참조 | `src/mcp/server.ts` (24개 중 탐색 계열) | `packages/server/src/mcp/` |

> **주의**: codeatlas `kotlin-extractor.ts`는 21줄 스텁·런타임 throw로 이식 불가. Kotlin extractor는 FT-004(신규 작성)로 이연.

**미이식 (우리 MVP 범위 밖)**: LanceDB 시맨틱 검색, Kuzu 그래프, Anthropic summarizer, 전역 SQLite 경로, stdio-only MCP, rename/replace/insert 편집 tool.
