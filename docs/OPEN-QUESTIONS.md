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

## OQ-004: DB 마이그레이션 툴 선택

**질문**: 스키마 마이그레이션 도구로 무엇을 선택하는가?

**후보**:
- Node.js → `umzug` (Sequelize 계열, 파일 기반 migration)
- Python → `alembic` (SQLAlchemy 연동)
- 언어 무관 → `flyway` (Java 기반이지만 standalone CLI 제공)

**결정 시 고려할 요소**: OQ-001 언어 선택에 종속. 언어 확정 후 결정.

**결정 필요 시점**: OQ-001 확정 직후

---

## OQ-005: 웹 UI 기술 스택

**질문**: 최소 웹 UI(검색창 + 결과 리스트 + 심볼 상세 페이지)를 어떻게 구현하는가?

**관련 설계 근거 (`01-design.md §14`)**:
- "최소 웹 UI: 검색창 + 결과 리스트 + 심볼 상세 페이지"가 2주 MVP 체크리스트에 포함
- 설계서에 UI 스택 명시 없음

**후보**:
- 서버 서빙 정적 HTML + vanilla JS (의존성 제로)
- React/Vue + Vite (빌드 파이프라인 추가)
- API 서버 내 정적 파일 서빙 (별도 배포 불필요)

**결정 시 고려할 요소**:
- MVP 기간 내 구현 가능성
- 팀의 프론트엔드 역량
- 정적 서빙 vs SPA 구분 (ADR-004에 따라 API 서버가 정적 파일도 서빙)

**결정 필요 시점**: 구현 착수 후 1주차

---

## OQ-006: 레포 구조 — 별도 레포 vs 모노레포

**질문**: MVP를 별도 독립 레포로 시작하는가, 기존 `codebase-memory-sync` 모노레포에 패키지로 추가하는가?

**관련 설계 근거 (`lightweight/README.md`)**:
- "구현 착수 시 별도 레포로 분리 검토 (`codebase-analysis-lite` 또는 팀 명명 기준)"

**결정 시 고려할 요소**:
- CMS 본 프로젝트는 현재 홀드 상태 — 모노레포 공유 이점이 낮음
- 별도 레포가 독립 CI/CD, 권한 관리, 배포 단위 분리에 유리
- 현재 cwd(`/codebase-analysis`)가 이미 별도 레포로 초기화된 것으로 보임

**결정 필요 시점**: 이미 별도 레포로 진행 중인 것으로 추정 — 확인만 필요
