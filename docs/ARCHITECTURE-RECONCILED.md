# Architecture Reconciled — 실제 코드 기준 정합 정리

## 목적

이 문서는 `docs/ARCHITECTURE.md`를 직접 수정하지 않고, 현재 저장소의 실제 코드 구조를 기준으로 아키텍처 서술을 다시 정렬한 결과를 기록한다. 목표는 "현재 구현"과 "목표 구조"를 분리해, 이후 `ARCHITECTURE.md` 개정 시 기준 문서로 사용하는 것이다.

기준 시점: 2026-04-19  
검토 기준: `docs/ARCHITECTURE.md` + 현재 `packages/*` 실제 파일 구조

---

## 1. 현재 구현 기준 요약

현재 시스템은 `packages/shared`, `packages/cli`, `packages/server`, `packages/mcp-server`의 4개 패키지로 구성된다.

- `shared`: 공통 타입과 패킹 결과 타입 정의를 제공한다.
- `cli`: `analyze`, `push` 두 명령을 제공한다.
- `server`: Hono 기반 REST API와 정적 웹 UI를 제공한다.
- `mcp-server`: stdio 기반 MCP 서버이며, 내부적으로 HTTP로 `server`를 호출한다.

현재 구현은 Variant A(SQLite + 로컬 FS)에 맞춰 동작하며, Variant B(PostgreSQL + S3)는 인터페이스와 스텁 수준만 존재한다.

---

## 2. 실제 디렉토리 구조

`ARCHITECTURE.md`에 적힌 목표 구조보다, 현재 코드는 아래 구조로 이해하는 편이 정확하다.

```text
codebase-analysis/
├── packages/
│   ├── shared/
│   │   └── src/
│   │       ├── index.ts
│   │       └── types.ts
│   ├── cli/
│   │   └── src/
│   │       ├── commands/
│   │       │   ├── analyze.ts
│   │       │   └── push.ts
│   │       ├── extractors/
│   │       │   ├── index.ts
│   │       │   ├── java.ts
│   │       │   └── typescript.ts
│   │       ├── packer/
│   │       ├── parser/
│   │       ├── walker/
│   │       └── index.ts
│   ├── server/
│   │   └── src/
│   │       ├── middleware/
│   │       │   └── bearer.ts
│   │       ├── public/
│   │       │   ├── app.js
│   │       │   ├── index.html
│   │       │   ├── style.css
│   │       │   └── symbol.html
│   │       ├── routes/
│   │       │   ├── health.ts
│   │       │   ├── indexes.ts
│   │       │   └── reads.ts
│   │       ├── schemas/
│   │       │   └── packed-index.ts
│   │       ├── storage/
│   │       │   ├── blob/
│   │       │   └── db/
│   │       ├── app.ts
│   │       ├── dev.ts
│   │       └── index.ts
│   └── mcp-server/
│       └── src/
│           ├── tools/
│           │   └── index.ts
│           ├── client.ts
│           └── index.ts
├── docs/
├── docker/
└── data/
```

---

## 3. 현재 코드 기준 컴포넌트 설명

### 3.1 CLI

CLI는 현재 `analyze`와 `push` 두 명령만 제공한다.

- `analyze`: 파일 수집 → 언어 감지 → tree-sitter 파싱 → 심볼/참조 추출 → `index.json` + `source.zip` 생성
- `push`: 생성된 산출물을 HTTP로 서버에 업로드

중요한 점은, `push`가 DB에 직접 쓰지 않고 다음 4단계를 REST로 수행한다는 점이다.

1. `POST /v1/repos/:name/indexes`
2. `PUT /v1/indexes/:id/index-json`
3. `PUT /v1/indexes/:id/source-zip`
4. `PATCH /v1/indexes/:id`

따라서 `ARCHITECTURE.md`의 `PUT /v1/indexes` 단일 업로드 표현은 현재 구현과 맞지 않는다.

### 3.2 Server

`packages/server/src/app.ts`는 Hono 앱을 조립하는 진입점이다.

- `routes/health.ts`: 헬스 체크
- `routes/indexes.ts`: 업로드 관련 쓰기 API
- `routes/reads.ts`: 검색/본문/파일 개요/참조 조회 API
- `middleware/bearer.ts`: 쓰기 엔드포인트용 Bearer 인증
- `public/`: 정적 웹 UI

현재 구조에는 문서가 말하는 `mcp/` 디렉토리나 `services/` 디렉토리가 없다. commit 해석과 검색 처리도 별도 서비스 계층이 아니라 라우트와 어댑터 호출 안에서 직접 수행된다.

### 3.3 Storage

스토리지 경계는 실제로 잘 구현돼 있다.

- `storage/db/types.ts`: `DbAdapter`
- `storage/db/sqlite.ts`: 실제 Variant A 구현
- `storage/db/pg.ts`: Variant B 스텁
- `storage/blob/types.ts`: `BlobAdapter`
- `storage/blob/fs.ts`: 실제 Variant A 구현
- `storage/blob/s3.ts`: Variant B 스텁

즉, "어댑터 패턴"은 현재 코드에 존재하지만, "런타임에서 A/B를 자유롭게 선택하는 완성된 다형성"까지 구현된 것은 아니다. 현재 `server/src/dev.ts`는 SQLite + FS를 직접 선택한다.

### 3.4 MCP Server

MCP는 `packages/server` 안에 포함된 것이 아니라 별도 패키지 `packages/mcp-server`로 구현돼 있다.

현재 tool 4종은 다음과 같다.

- `search_symbols`
- `get_symbol_body`
- `get_references`
- `get_file_overview`

이 서버는 stdio transport를 사용하고, 내부적으로 `ServerClient`를 통해 HTTP API를 호출한다.

---

## 4. `ARCHITECTURE.md`와의 주요 불일치

### 4.1 `server` 패키지 설명

현재 문서:
- `server`를 "REST + MCP + 정적 UI" 서버로 설명

실제 코드:
- `server`는 REST + 정적 UI
- MCP는 별도 `packages/mcp-server`

권장 표현:
- `server`: REST API + 정적 웹 UI
- `mcp-server`: MCP stdio shim, HTTP로 server 호출

### 4.2 존재하지 않는 디렉토리

현재 문서에는 아래 경로가 현재 구조처럼 적혀 있으나, 실제로는 아직 없다.

- `packages/server/src/mcp/`
- `packages/server/src/services/`
- `packages/server/migrations/`
- `packages/cli/src/extractors/python.ts`
- `packages/cli/src/commands/status`
- `infra/`
- `scripts/`

이들은 삭제하거나, 별도 "목표 구조" 섹션으로 이동하는 편이 정확하다.

### 4.3 업로드 플로우 설명

현재 문서:
- `analyze push`가 `PUT /v1/indexes`로 업로드하는 것처럼 축약
- `multipart` 표현 사용

실제 코드:
- 업로드는 4단계 REST 호출
- `index-json`은 JSON PUT
- `source-zip`은 binary PUT
- multipart는 사용하지 않음

### 4.4 상태 관리 설명

현재 문서:
- CLI가 `.analyze/`를 사용한다고 적혀 있음

실제 코드:
- 기본 출력 디렉토리는 `.codebase-analysis`

### 4.5 웹 UI 설명

현재 문서:
- `web/` 디렉토리 표현 사용

실제 코드:
- `public/` 디렉토리에 정적 파일 존재
- 서버가 `serveStatic`으로 직접 서빙

### 4.6 Variant B 표현 강도

현재 문서:
- Variant A/B가 거의 동등한 준비 상태처럼 읽힘

실제 코드:
- Variant A만 동작 경로가 완성
- Variant B는 인터페이스 파리티와 스텁 수준

따라서 현재 문서에는 "현재 구현은 Variant A, Variant B는 skeleton"이라는 문장을 전면에 두는 편이 맞다.

---

## 5. 현재 기준으로 다시 쓰면 좋은 핵심 문장

아래 문장들은 `ARCHITECTURE.md` 개정 시 바로 반영 가능한 수준의 정합 문구다.

### 5.1 상단 소개

```md
> 현재 구현 기준 MVP 스택: Node.js 22 LTS + TypeScript + Hono
> 현재 동작 경로는 Variant A(SQLite + 로컬 FS)이며, Variant B(PostgreSQL + S3)는 어댑터 스텁만 준비되어 있다.
```

### 5.2 서버 설명

```md
packages/server는 Hono 기반 REST API와 정적 웹 UI를 제공한다.
MCP는 packages/mcp-server의 별도 stdio 서버에서 제공하며, 내부적으로 server의 HTTP API를 호출한다.
```

### 5.3 CLI 설명

```md
CLI는 analyze와 push 두 명령을 제공한다.
analyze는 index.json과 source.zip을 생성하고, push는 이를 4단계 HTTP 업로드 플로우로 서버에 전송한다.
```

### 5.4 업로드 흐름 설명

```md
업로드는 단일 PUT이 아니라 다음 순서로 진행된다:
POST /v1/repos/:name/indexes
PUT /v1/indexes/:id/index-json
PUT /v1/indexes/:id/source-zip
PATCH /v1/indexes/:id
```

### 5.5 상태 설명

```md
CLI의 기본 출력 디렉토리는 .codebase-analysis 이다.
서버는 indexes.status(uploading, ready, failed)와 repo_head를 통해 인덱스 상태와 branch별 최신 포인터를 관리한다.
```

---

## 6. 권장 개정 원칙

`ARCHITECTURE.md`를 다음 원칙으로 정리하면 실제 코드와의 정합성이 크게 좋아진다.

### 원칙 1. 현재 구조와 목표 구조를 분리

- 현재 존재하는 디렉토리만 "현재 아키텍처"에 적는다.
- 없는 디렉토리와 계획 모듈은 "목표 구조"나 "향후 분리 후보"로 내린다.

### 원칙 2. Variant A와 Variant B의 상태를 분리

- Variant A: 구현됨
- Variant B: 인터페이스/스텁만 존재

이 표기가 빠지면 독자가 구현 범위를 잘못 해석한다.

### 원칙 3. 데이터 흐름은 실제 엔드포인트 기준으로 쓴다

- 축약 표현보다 현재 코드에서 실제 호출되는 경로를 적는 편이 낫다.
- 특히 업로드는 단일 요청처럼 서술하면 안 된다.

### 원칙 4. 추상 서비스 계층을 가정하지 않는다

- 현재 `services/`가 없으므로, commit resolver나 FTS indexer를 독립 컴포넌트처럼 그리지 않는 편이 맞다.
- 지금은 "라우트가 어댑터를 직접 호출한다"가 더 정확한 서술이다.

---

## 7. 결론

현재 아키텍처의 강점은 실제 코드에도 반영된 경계가 있다는 점이다. 특히 `cli -> server -> storage adapters` 구조와 `mcp-server -> server` 구조는 이미 선명하다.

문제는 방향이 아니라 문서의 시제다. `ARCHITECTURE.md`는 일부를 현재형으로 쓰고 있지만, 실제로는 "구현 완료", "스텁 존재", "향후 구조"가 혼재해 있다. 따라서 다음 개정에서는 설계의 비전을 줄일 필요는 없고, 구현 상태 표기를 더 엄격하게 붙이는 것이 핵심이다.
