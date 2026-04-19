# API 참조

> REST 엔드포인트 전수 + MCP tool 4종 + curl 예시.
> 런타임 OpenAPI 스펙: `GET http://localhost:3000/openapi.json`

---

## 인증

쓰기(업로드) 엔드포인트는 **Bearer token** 인증이 필요하다.

```
Authorization: Bearer <ANALYZE_UPLOAD_TOKEN>
```

`ANALYZE_UPLOAD_TOKEN`은 서버 환경변수(`docker/.env`)에서 설정. 읽기 엔드포인트는 인증 불필요.

---

## 운영 제약 · 보안 한계

> 이 섹션을 먼저 읽을 것. 제약을 이해하지 않고 사용하면 보안 사고 또는 잘못된 결과를 야기할 수 있다.

| 항목 | 내용 |
|---|---|
| **사내망/VPN 전제** | 읽기 엔드포인트는 **무인증**. 공개 인터넷에 노출하지 말 것. Variant A 기본 설정은 방화벽/VPN 뒤를 가정. |
| **정적 Bearer token** | 쓰기는 단일 `ANALYZE_UPLOAD_TOKEN`. 토큰 교체 시 서버 재시작 필요. 감사 로그 없음. → FT-008 |
| **사용자 단위 식별 없음** | 모든 쓰기는 단일 CI 주체로 기록. 레포별·사용자별 권한 분리 없음. |
| **references = 이름 기반 매칭** | `/v1/symbols/:key/references`는 tree-sitter 이름 매칭. 동명 심볼 false positive 빈번. **정확한 호출 그래프가 아니다.** |
| **commit 해석 순서** | `commit 파라미터 명시 > branch > default_branch HEAD`. `branch=null`(detached HEAD) 업로드는 branch 경로로 조회 불가 → 반드시 `commit=<sha>` 명시. |
| **검색 쿼리 제약** | `q`는 영문자·숫자·`_` 만 허용. 파일 경로·복합 쿼리 미지원. → FT-007 |

---

## 에러 코드 매트릭스

| 코드 | 의미 | 주요 발생 상황 |
|---|---|---|
| `400` | 잘못된 요청 | 파라미터 형식 오류, JSON 파싱 실패, Zod 검증 실패 |
| `401` | 인증 실패 | Bearer token 누락 또는 불일치 |
| `404` | 리소스 없음 | 레포·인덱스·심볼 미존재, 아직 ready 아님 |
| `409` | 충돌 | 동일 (repo, commit_sha) 인덱스가 이미 `ready` 상태 |
| `5xx` | 서버 오류 | DB 오류, blob I/O 오류 |

---

## REST — 쓰기 엔드포인트 (Bearer 필요)

### POST `/v1/repos/:name/indexes`

새 인덱스를 생성하거나, 기존 실패/진행 중 인덱스를 초기화한다.

| 항목 | 값 |
|---|---|
| Method | POST |
| Auth | Bearer |
| Content-Type | application/json |

**Request Body**:
```json
{
  "commit_sha": "a1b2c3d4...",
  "branch": "main"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `commit_sha` | string | ✅ | Git commit SHA |
| `branch` | string \| null | — | 브랜치명. null이면 detached HEAD |

**Response `200`**:
```json
{ "index_id": 1, "status": "uploading" }
```

**Response `409`** (이미 ready인 경우):
```json
{ "index_id": 1, "status": "ready" }
```

**curl 예시**:
```bash
curl -X POST http://localhost:3000/v1/repos/my-app/indexes \
  -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{"commit_sha":"a1b2c3d4e5f6","branch":"main"}'
```

---

### PUT `/v1/indexes/:id/index-json`

파싱된 심볼·참조 JSON을 업로드한다. Body는 `packedIndexSchema` 형식.

| 항목 | 값 |
|---|---|
| Method | PUT |
| Auth | Bearer |
| Content-Type | application/json |

**Request Body** (`PackedIndex` 스키마):
```json
{
  "schema_version": 1,
  "repo_name": "my-app",
  "commit_sha": "a1b2c3d4...",
  "branch": "main",
  "generated_at": 1713600000,
  "files": ["src/index.ts", "src/service.ts"],
  "symbols": [
    {
      "symbol_key": "a3f9...（64자 hex）",
      "parent_key": null,
      "file_path": "src/service.ts",
      "name": "UserService",
      "kind": "class",
      "signature": "class UserService",
      "start_line": 10,
      "end_line": 80,
      "modifiers": ["export"],
      "annotations": []
    }
  ],
  "occurrences": [
    {
      "caller_key": null,
      "callee_name": "UserService",
      "kind": "type_reference",
      "file_path": "src/index.ts",
      "line": 5
    }
  ]
}
```

**`occurrence.kind` 허용값**: `call` | `field_access` | `type_reference` | `annotation`

**Response `200`**:
```json
{ "symbol_count": 42, "occurrence_count": 18 }
```

---

### PUT `/v1/indexes/:id/source-zip`

소스 ZIP 바이너리를 업로드한다. 이후 심볼 본문 조회(`/body`)에 사용.

| 항목 | 값 |
|---|---|
| Method | PUT |
| Auth | Bearer |
| Content-Type | application/octet-stream |

**curl 예시**:
```bash
curl -X PUT http://localhost:3000/v1/indexes/1/source-zip \
  -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @.codebase-analysis/source.zip
```

**Response `200`**:
```json
{ "bytes": 204800 }
```

---

### PATCH `/v1/indexes/:id`

인덱스를 최종 확정한다. `ready`로 설정 시 `repo_head`도 갱신.

| 항목 | 값 |
|---|---|
| Method | PATCH |
| Auth | Bearer |
| Content-Type | application/json |

**Request Body**:
```json
{ "status": "ready", "file_count": 42 }
```

| 필드 | 타입 | 허용값 |
|---|---|---|
| `status` | string | `"ready"` \| `"failed"` |
| `file_count` | number | 0 이상 정수, optional |

**Response `200`**:
```json
{ "status": "ready" }
```

---

## REST — 읽기 엔드포인트 (인증 불필요)

### GET `/v1/search`

FTS5(SQLite) 기반 심볼 이름·시그니처 전문 검색.

**Query Parameters**:
| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `q` | string | ✅ | 검색어. 영문자·숫자·_ 만 허용 |
| `repo` | string | ✅ | 레포 이름 |
| `commit` | string | — | commit SHA. 생략 시 default branch HEAD |
| `limit` | number | — | 결과 수 (1~100, 기본 20) |

**curl 예시**:
```bash
curl "http://localhost:3000/v1/search?q=UserService&repo=my-app&limit=5"
```

**Response**:
```json
{
  "symbols": [
    {
      "symbol_key": "a3f9...",
      "name": "UserService",
      "kind": "class",
      "file_path": "src/service.ts",
      "start_line": 10,
      "end_line": 80,
      "signature": "class UserService"
    }
  ]
}
```

---

### GET `/v1/symbols/:key`

심볼 메타데이터 조회. `key`는 64자 hex.

```bash
curl "http://localhost:3000/v1/symbols/a3f9..."
# → { "symbol": { ...메타데이터... } }
```

---

### GET `/v1/symbols/:key/body`

심볼의 소스 본문을 반환. source.zip에서 해당 파일을 꺼내 `start_line ~ end_line` 슬라이스.

```bash
curl "http://localhost:3000/v1/symbols/a3f9.../body"
```

**Response**:
```json
{
  "symbol_key": "a3f9...",
  "file_path": "src/service.ts",
  "start_line": 10,
  "end_line": 80,
  "body": "export class UserService {\n  ..."
}
```

---

### GET `/v1/symbols/:key/references`

해당 심볼 이름과 일치하는 참조(occurrence) 목록 반환.

> ⚠️ tree-sitter 이름 매칭 기반 — 동명 함수의 다른 정의를 포함할 수 있음 (ADR-002).

```bash
curl "http://localhost:3000/v1/symbols/a3f9.../references"
# → { "symbol_key": "...", "occurrences": [...] }
```

---

### GET `/v1/repos/:name/files`

레포의 색인된 파일 목록 반환.

**Query Parameters**:
| 파라미터 | 설명 |
|---|---|
| `commit` | commit SHA. 생략 시 HEAD |

```bash
curl "http://localhost:3000/v1/repos/my-app/files"
# → { "files": ["src/index.ts", "src/service.ts", ...] }
```

---

### GET `/v1/repos/:name/file-symbols`

특정 파일에 정의된 심볼 목록.

**Query Parameters**:
| 파라미터 | 필수 | 설명 |
|---|---|---|
| `path` | ✅ | 파일 경로 (레포 루트 기준) |
| `commit` | — | commit SHA. 생략 시 HEAD |

```bash
curl "http://localhost:3000/v1/repos/my-app/file-symbols?path=src/service.ts"
# → { "repo": "my-app", "commit_sha": "...", "file_path": "...", "symbols": [...] }
```

---

### GET `/healthz`

서버 헬스 체크.

```bash
curl http://localhost:3000/healthz
# → {"status":"ok"}
```

---

### GET `/openapi.json`

런타임 OpenAPI 3.x 스펙 JSON.

---

## MCP tool

MCP stdio 서버(`analyze-mcp`)가 Claude Desktop/Cursor에 노출하는 4개 읽기 전용 tool.

> 연결 설정 방법 → [GETTING-STARTED.md#step-9](GETTING-STARTED.md#step-9----claude-desktop-mcp-연결)

---

### `search_symbols`

FTS 심볼 검색. `/v1/search`를 내부적으로 호출.

| 입력 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `q` | string | ✅ | 검색어 |
| `repo` | string | ✅ | 레포 이름 |
| `commit` | string | — | commit SHA 또는 브랜치 (기본: HEAD) |
| `limit` | integer | — | 최대 결과 수 (1~100, 기본 20) |

**사용 예 (Claude 대화)**:
```
UserService 어디 있어?
→ search_symbols({q: "UserService", repo: "my-app"})
```

---

### `get_symbol_body`

심볼 소스 본문 조회. `/v1/symbols/:key/body` 호출.

| 입력 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `symbol_key` | string | ✅ | 64자 hex 심볼 키 |

**사용 예**:
```
UserService 전체 코드 보여줘.
→ get_symbol_body({symbol_key: "a3f9..."})
```

---

### `get_references`

심볼 참조 목록. `/v1/symbols/:key/references` 호출.

| 입력 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `symbol_key` | string | ✅ | 64자 hex 심볼 키 |

> ⚠️ **semantic resolver가 아니다** (ADR-002).
> - `callee_name` 문자열만 일치하면 occurrence로 기록. 오버로드·동명 메서드·같은 import 별칭에서 false positive 빈번.
> - "정확한 호출 그래프"로 해석하지 말 것. AI 에이전트가 이 결과를 수정 작업의 근거로 삼으면 잘못된 컨텍스트를 소비할 수 있다.
> - 향후 SCIP/LSIF 수용 여부는 FINAL-RISKS §2에서 논의 중.

---

### `get_file_overview`

파일 내 심볼 목록. `/v1/repos/:name/file-symbols` 호출.

| 입력 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `repo` | string | ✅ | 레포 이름 |
| `path` | string | ✅ | 파일 경로 (레포 루트 기준) |
| `commit` | string | — | commit SHA 또는 브랜치 (기본: HEAD) |

**사용 예**:
```
src/service.ts 파일 구조 알려줘.
→ get_file_overview({repo: "my-app", path: "src/service.ts"})
```

---

## 웹 UI 라우트

브라우저에서 직접 접근 가능한 HTML 페이지. 모두 query string 기반.

| 경로 | 설명 |
|---|---|
| `/` | 검색 페이지. `?repo=&q=&commit=` |
| `/s/<symbol_key>` | 심볼 상세 (signature · body · references). `?repo=&commit=` |
| `/f` | 파일 개요 — 파일 내 심볼 목록. `?repo=&path=&commit=` |

### `/f` — 파일 개요 페이지

```
GET /f?repo=my-app&path=src/service.ts
GET /f?repo=my-app&path=src/service.ts&commit=abc123
```

`/v1/repos/:name/file-symbols` API를 호출해 심볼 목록을 렌더링. 각 심볼 클릭 시 `/s/<key>` 심볼 상세로 이동.

### 정적 자산 캐시 정책

| 자산 | `Cache-Control` |
|---|---|
| `app.js`, `style.css` | `public, max-age=300, stale-while-revalidate=60` |
| HTML 페이지 (`/`, `/f`, `/s/*`) | `no-cache` |

모든 정적 파일은 `ETag` 헤더 포함. `If-None-Match` 일치 시 `304 Not Modified` 반환.
