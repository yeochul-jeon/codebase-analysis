# Open Questions — 미결 사항 목록

> 설계서(`01-design.md`)에서 "팀 친숙도 우선", "착수 시 결정" 등으로 명시적으로 연기된 항목들.
> 각 항목은 구현 착수 전 또는 해당 단계 진입 시 ADR로 확정한다.

---

## OQ-001: 언어 · 프레임워크 선택 ✅ 해결 (2026-04-19)

**결정**: Node.js 22 LTS + TypeScript + Hono + pnpm workspace → **ADR-013 참조**.

**근거 요약**:
- MCP 공식 SDK가 Node/TS 기준 → ADR-011 구현 최단 경로
- AWS cold-start 우위 + CLI/서버 단일 런타임 공유
- zod 스키마가 REST/MCP/DB 계약 단일 출처

**참조**: `/Users/cjenm/.claude/plans/oq-001-snoopy-swan.md`, `docs/ADR.md:ADR-013`

---

## OQ-002: 배포 변형 선택 (Variant A vs B) ✅ 해결 (2026-04-19)

**결정**: Variant A·B 병행, Variant A 우선 구현 → **ADR-015 참조**.

**근거 요약**:
- Variant A(SQLite + 로컬 FS)로 먼저 dogfooding. 어댑터 파리티 유지해 A 완성 후 B로 전환 비용 최소화
- ADR-003 어댑터 패턴으로 비즈니스 로직 재작성 불필요

**참조**: `docs/ADR.md:ADR-015`

---

## OQ-003: 초기 tree-sitter grammar 선정 ✅ 해결 (2026-04-19, 수정 2026-04-19)

**결정**: TypeScript · Java 2종 → **ADR-016 참조**.

**근거 요약**:
- codeatlas `src/indexer/tree-sitter/`의 js-extractor(638L)·java-extractor(244L)를 선택 이식 (ADR-014 정합)
- codeatlas `kotlin-extractor.ts`는 21줄 스텁·런타임 throw → 이식 후 미동작. 신규 작성 공수 2~3일 → FT-004로 이연
- Python은 codeatlas에 부재 → FT-003으로 이관

**참조**: `docs/ADR.md:ADR-016`, `docs/FUTURE-TASKS.md:FT-003`, `docs/FUTURE-TASKS.md:FT-004`

---

## OQ-004: DB 마이그레이션 툴 선택 ✅ A 해결 / B skeleton 완료 (2026-04-19)

**결정 (Variant A)**: 번호 기반 SQL 파일 + 자체 러너 → **ADR-017 참조**.

**결정 (Variant B skeleton)**: `PgAdapter` + `S3BlobAdapter` 스텁 신설. 실제 pg/s3 의존성은 Variant B 전환 트리거 도달 시 추가.
- `packages/server/src/storage/db/pg.ts` — `PgAdapter implements DbAdapter` (throw not-implemented)
- `packages/server/src/storage/blob/s3.ts` — `S3BlobAdapter implements BlobAdapter` (throw not-implemented)

**완료된 B-variant 준비 작업 (ADR-022)**:
- ✅ `storage/factory.ts` — `DB_BACKEND`/`STORAGE_BACKEND` env 기반 factory 신설 (`dev.ts`가 factory 사용)
- ✅ `storage/__tests__/contract.ts` — 공유 contract test 하네스 (FT-005 부분 완료)
- ✅ `storage/__tests__/contract-variant-b.ts` — `RUN_VARIANT_B=1` 게이트 스켈레톤

**남은 B-variant 작업** (OQ-008 "조건부 착수" 결정 후):
- `pg`/`@aws-sdk/client-s3` 의존성 추가
- 마이그레이션 툴로 `node-pg-migrate` 도입, PG 마이그레이션 SQL 재작성
- `PgAdapter`·`S3BlobAdapter` 실구현 (DbAdapter async 전환 포함 — 별도 ADR)
- docker-compose `variant-b` profile (postgres:16 + minio) 추가

**참조**: `docs/ADR.md:ADR-017`, ADR-015(Variant A·B 병행)

---

## OQ-005: 웹 UI 기술 스택 ✅ 해결 (2026-04-19)

**결정**: Option A — vanilla HTML/CSS/JS를 `packages/server/src/public/`에서 정적 서빙, MPA 라우팅, Prism.js(CDN)로 syntax highlighting.

**근거 요약**:
- ADR-004 "API 서버가 정적 파일도 서빙" 제약과 정합 — 별도 배포 불필요
- 의존성 추가 0, 빌드 파이프라인 변경 최소 (cp 한 줄)
- MVP 3화면 범위에서 Vite+React는 CLAUDE.md §2 YAGNI 위반 (12~20h vs 4~6h)
- `@hono/node-server/serve-static`으로 기존 의존성 내 구현

**구현 범위**: 검색창 + 결과 리스트 + 심볼 상세(signature · body · references) + 파일 개요(`/f?repo=&path=`). 인증·파일트리·커밋 선택 UI·키보드 단축키는 YAGNI로 제외.

**참조**: `packages/server/src/public/`, `packages/server/src/app.ts`

---

## OQ-007: `dependencies` 데이터 — 스키마 승격 vs 내부 산출물 유지

**상태**: 🔜 미결 — 팀 논의 필요

**배경**: 현재 extractor는 `dependencies`(import/extends/implements 관계)를 계산하지만, `PackedIndex` 스키마와 서버 저장 경로에는 포함되지 않는다. 즉 파일 간 관계 데이터는 추출까지만 되고 인덱스에 남지 않는다.

**선택지**:

- **Option A (현상 유지)**: `dependencies`는 extractor 내부 산출물로만 남긴다. 문서에서 "파일 간 관계 분석 불가"를 명시. 공수 0.
- **Option B (MVP+1 승격)**: `PackedIndex`에 `dependencies` 필드 추가. 서버 DB 스키마 확장. FT-002(그래프 쿼리) 전진 기지. 공수 2~3일.

**트리거**: 파일 간 의존성 시각화 또는 impact analysis 수요 발생 시.

**참조**: `docs/FINAL-RISKS-20260419.md §1`, `docs/FUTURE-TASKS.md FT-002`

---

## OQ-008: Variant B 활성화 시점 · 조건

**상태**: ✅ Option B (조건부 착수) — 2026-04-19

**결정 근거**: Contract MVP 선행 — Variant A 3개 레포 dogfooding으로 어댑터 인터페이스 안정성 확인. 수평 확장 수요 발생 전 PgAdapter·S3BlobAdapter parity 확보 + contract-variant-b.ts 전량 통과를 목표로 착수. 실레포 dogfooding(Variant B 모드 E2E)은 범위 외 — 트리거 도달 후 별도 세션.

**배경**: Variant B (PostgreSQL + S3)는 `DbAdapter`/`BlobAdapter` 인터페이스와 스텁(`throw not-implemented`)만 존재한다. 문서 일부가 A/B를 동등한 완성 수준으로 서술하고 있어 독자가 오해할 수 있다.

**선택지**:

- **Option A (현상 유지)**: 당분간 skeleton으로 명시. 활성화 전까지 모든 문서·ADR에서 "Variant B = 스텁"으로 표기. Variant A 안정화 우선.
- **Option B (조건부 착수)**: 아래 트리거 도달 시 FT-005 착수. ← **채택**

**Variant B 착수 트리거 후보**:
- 단일 서버 SQLite의 동시 부하 한계 실측 (p95 > 300ms)
- 팀이 AWS/GCP 운영 환경으로 전환 결정
- 다중 서버 수평 확장 수요 발생

**참조**: `docs/FINAL-RISKS-20260419.md §4`, `docs/CONTRACT-TESTS.md CT-005`, ADR-023

---

## OQ-009: 검색 계약 확장 여부 (`/v1/search` 쿼리 surface)

**상태**: 🔜 미결 — UX 피드백 축적 필요

**배경**: 현재 `/v1/search?q=`는 영문자·숫자·`_`만 허용한다. 파일 경로 필터, 복합 쿼리, 한국어 식별자 검색을 지원하지 않는다. 사용자가 "왜 이 검색은 안 되지?"를 반복할 가능성이 있다.

**선택지**:

- **Option A (현상 유지)**: 현재 제약을 `GETTING-STARTED.md`와 `API.md`에 전면 표기하여 UX로 설명. 공수 0.
- **Option B (점진 확장)**: FT-007로 추적. `path=src/**` 필터 및 복합 쿼리(`AND`) 지원. SQLite FTS5 `MATCH` 문법 확장. 공수 1~2일.

**트리거**: 팀원·AI 에이전트의 검색 실패 피드백이 3회 이상 반복 시.

**참조**: `docs/FINAL-RISKS-20260419.md §3`, `docs/FUTURE-TASKS.md FT-007`

---

## OQ-006: 레포 구조 — 별도 레포 vs 모노레포 ✅ 해결 (2026-04-19)

**결정**: 별도 독립 레포(`github.com/yeochul-jeon/codebase-analysis`) → **ADR-021 참조**.

**근거 요약**:
- Session 1부터 이미 별도 레포로 진행 중 (git remote 확인)
- CMS 홀드 상태로 모노레포 통합 이점 없음
- 독립 CI/CD·배포·권한 분리에 유리

**참조**: `docs/ADR.md:ADR-021`
