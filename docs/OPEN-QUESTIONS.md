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

**남은 B-variant 작업** (트리거 도달 시):
- `pg`/`@aws-sdk/client-s3` 의존성 추가
- 마이그레이션 툴로 `node-pg-migrate` 도입
- `PgAdapter`·`S3BlobAdapter` 실구현
- `app.ts` 환경변수 기반 어댑터 선택 로직 추가

**참조**: `docs/ADR.md:ADR-017`, ADR-015(Variant A·B 병행)

---

## OQ-005: 웹 UI 기술 스택 ✅ 해결 (2026-04-19)

**결정**: Option A — vanilla HTML/CSS/JS를 `packages/server/src/public/`에서 정적 서빙, MPA 라우팅, Prism.js(CDN)로 syntax highlighting.

**근거 요약**:
- ADR-004 "API 서버가 정적 파일도 서빙" 제약과 정합 — 별도 배포 불필요
- 의존성 추가 0, 빌드 파이프라인 변경 최소 (cp 한 줄)
- MVP 3화면 범위에서 Vite+React는 CLAUDE.md §2 YAGNI 위반 (12~20h vs 4~6h)
- `@hono/node-server/serve-static`으로 기존 의존성 내 구현

**구현 범위**: 검색창 + 결과 리스트 + 심볼 상세(signature · body · references). 인증·파일트리·커밋 선택 UI·키보드 단축키는 YAGNI로 제외.

**참조**: `packages/server/src/public/`, `packages/server/src/app.ts`

---

## OQ-006: 레포 구조 — 별도 레포 vs 모노레포 ✅ 해결 (2026-04-19)

**결정**: 별도 독립 레포(`github.com/yeochul-jeon/codebase-analysis`) → **ADR-021 참조**.

**근거 요약**:
- Session 1부터 이미 별도 레포로 진행 중 (git remote 확인)
- CMS 홀드 상태로 모노레포 통합 이점 없음
- 독립 CI/CD·배포·권한 분리에 유리

**참조**: `docs/ADR.md:ADR-021`
