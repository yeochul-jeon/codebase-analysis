# Contract Tests — 검증 계획 카탈로그

> 이 시스템의 핵심 신뢰 기반은 "정확한 해석"이 아니라 **"같은 입력에 같은 결과"** 다.  
> 아래 카탈로그는 그 결정론을 검증하는 테스트 항목을 정의한다.  
> **현재 상태는 카탈로그 문서** — 실제 구현은 FINAL-RISKS §5 논의 후 FT-005~008로 착수한다.

기준 시점: 2026-04-19  
관련 ADR: ADR-009, ADR-010, ADR-012

---

## 상태 범례

| 상태 | 의미 |
|---|---|
| ✅ | 기존 smoke test에서 검증됨 |
| 🔶 | 부분 검증 (경로 일부만) |
| 🔜 | 미구현 — 카탈로그에만 존재 |

---

## CT-001 — IDEMPOTENT-UPLOAD (멱등 업로드)

**목적**: 동일 `(repo_name, commit_sha)` 조합 재업로드 시 `409` 반환 및 기존 데이터 불변 보장.

**ADR 근거**: ADR-010 — 멱등 업로드

**현재 상태**: 🔶 부분 검증

- ✅ 이미 `ready` 인덱스에 `POST /v1/repos/:name/indexes` 시 `409` 반환 — `routes/__tests__/smoke.ts`
- 🔜 `409` 이후에도 심볼 데이터 불변 검증 (DB 재조회로 확인)
- 🔜 `uploading` 상태 인덱스 재업로드 시 reset 후 재진행 경로 검증

**검증 방법**:
```bash
# 1. analyze + push (index_id=1, ready)
# 2. 동일 commit SHA로 다시 push
# → 409 응답, DB symbols 수 불변 확인
curl -X POST .../v1/repos/my-app/indexes -d '{"commit_sha":"abc"}'
# → 409 { "index_id": 1, "status": "ready" }
```

**테스트 파일 후보**: `packages/server/src/routes/__tests__/smoke.ts` 확장

---

## CT-002 — REPO-HEAD-RESOLUTION (커밋 해석 우선순위)

**목적**: ADR-009의 `commit 명시 > branch > default_branch HEAD` 우선순위가 모든 조회 엔드포인트에서 준수됨을 검증.

**ADR 근거**: ADR-009 — commit 해석 규약

**현재 상태**: 🔜 미구현

**필요 시나리오**:

1. **commit 명시**: `GET /v1/search?repo=A&commit=<sha>` → 해당 sha의 index 반환
2. **branch 지정 (commit 미입력)**: 특정 branch로 push한 후 `?repo=A` 요청 → `repo_head`로 해석
3. **default_branch fallback**: `repo_head`에 branch 없을 때 `default_branch` 사용
4. **detached HEAD 조회 실패**: `branch=null` 업로드 후 `?repo=A` → `404` 반환 (정상 동작)
5. **비결정적 ORDER BY 금지**: 최신 인덱스가 순서 기반으로 무작위 선택되지 않는지 확인

**테스트 파일 후보**: `packages/server/src/routes/__tests__/smoke.ts` 확장  
`src/routes/reads.ts:resolveIndex()` 함수 직접 단위 테스트 가능

---

## CT-003 — FTS-CONSISTENCY (검색 결과 재현성)

**목적**: 동일 심볼 집합 업로드 후 동일 쿼리의 결과 순서·개수가 재현됨을 검증.

**현재 상태**: 🔜 미구현

**필요 시나리오**:

1. 고정 fixture(`symbols: [{name:"UserService",...}, ...]`) 업로드
2. `GET /v1/search?q=User&repo=test` 반복 호출
3. 결과 `symbols` 배열의 순서·길이 일치 확인
4. FTS5 랭킹이 결정론적인지 — 동일 score 심볼의 정렬 기준 확인

**주의**: SQLite FTS5는 기본적으로 BM25 랭킹. 동일 score 시 row 순서는 삽입 순서 의존 가능.  
→ `limit` + `ORDER BY rank` 명시 여부를 `storage/db/sqlite.ts:searchSymbols()`에서 확인 필요.

**테스트 파일 후보**: `packages/server/src/storage/__tests__/smoke.ts` 확장

---

## CT-004 — ZIP-BODY-ACCURACY (소스 본문 슬라이스 정확성)

**목적**: `GET /v1/symbols/:key/body` 응답의 `body` 텍스트가 원본 파일의 `start_line ~ end_line` 범위와 일치함을 검증.

**ADR 근거**: ADR-012 (zip entry 기반 본문 추출)

**현재 상태**: 🔜 미구현

**필요 시나리오**:

1. 알려진 소스 파일 fixture 업로드 (라인 번호를 정확히 알고 있는 간단한 Java/TS 파일)
2. 검색으로 `symbol_key` 획득
3. `/body` 응답의 `start_line`, `end_line`, `body` 검증
4. `body`의 실제 텍스트가 fixture 원본과 일치하는지 확인

**경계 케이스**:
- 파일 마지막 라인에 있는 심볼 (개행 처리)
- 빈 라인이 포함된 메서드 바디
- 멀티바이트 문자 포함 파일 (UTF-8)

**테스트 파일 후보**: `packages/server/src/routes/__tests__/smoke.ts` (e2e) 또는  
`packages/server/src/storage/__tests__/smoke.ts` (blob + db 통합)

---

## CT-005 — VARIANT-PARITY (어댑터 동등성)

**목적**: Variant B(PG + S3)가 Variant A(SQLite + FS)와 동일한 입력에 동일한 응답을 반환함을 검증.

**현재 상태**: ✅ 구현 완료 — 2026-04-19 (OQ-008 Option B 결정 후 착수, ADR-022·023)

**구현 현황**:
- ✅ `packages/server/src/storage/__tests__/contract.ts` — `runDbContract`(11 checks) + `runBlobContract`(4 checks) 공유 하네스
- ✅ `packages/server/src/storage/__tests__/contract-variant-b.ts` — PgAdapter + S3BlobAdapter 실행 드라이버 (`RUN_VARIANT_B=1` 게이트)
- ✅ `PgAdapter` 실구현 (`storage/db/pg.ts`) + PG migrations (`migrations-pg/`)
- ✅ `S3BlobAdapter` 실구현 (`storage/blob/s3.ts`)
- ✅ `docker-compose --profile variant-b` (postgres:16 + minio + minio-init)

**실행 방법**:
```bash
docker compose --profile variant-b up -d postgres minio minio-init
RUN_VARIANT_B=1 \
  PG_URL=postgres://ca:ca@localhost:5432/ca \
  S3_BUCKET=ca-blobs \
  S3_ENDPOINT=http://localhost:9000 \
  S3_ACCESS_KEY_ID=minioadmin \
  S3_SECRET_ACCESS_KEY=minioadmin \
  pnpm -F @codebase-analysis/server test:variant-b
# → 15 checks: 11 db + 4 blob
```

**미완료 항목 (향후)**:
- CI에서 `PG_URL`/`S3_BUCKET` 주입 스크립트 (현재 수동 실행)
- Variant B 모드 실레포 dogfooding E2E

---

## 우선순위 제안

| 순위 | 항목 | 이유 |
|---|---|---|
| 1 | CT-004 ZIP-BODY-ACCURACY | 사용자가 직접 보는 기능, 오류 시 즉시 신뢰 손상 |
| 2 | CT-002 REPO-HEAD-RESOLUTION | ADR-009 규약 위반 시 "push 됐는데 검색 안 됨" 발생 |
| 3 | CT-001 IDEMPOTENT-UPLOAD | CI 재실행 안전성 — 현재 partially covered |
| 4 | CT-003 FTS-CONSISTENCY | 검색 UX 예측 가능성 |
| 5 | CT-005 VARIANT-PARITY | Variant B 착수 후 |

---

## 참조

- 기존 smoke 테스트 목록: `docs/TEST-RESULTS-20260419.md §3`
- 잔여 리스크: `docs/FINAL-RISKS-20260419.md §5`
- 관련 ADR: `docs/ADR.md` ADR-009, ADR-010, ADR-012
