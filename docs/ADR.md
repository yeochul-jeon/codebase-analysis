# Architecture Decision Records

## 철학

MVP 속도 최우선. 외부 의존성 최소화. 작동하는 최소 구현을 선택하고, 복잡성은 실측 병목이 트리거가 될 때만 추가한다. tree-sitter는 파서다 — semantic resolver가 아니다. 두 배포 변형(on-prem / AWS)의 비즈니스 로직은 동일하게 유지한다.

---

### ADR-001: 단일 프로세스 + 최소 저장소로 MVP 시작

**결정**: 앱 서버 1개 프로세스, DB 1개, blob 저장소 1개로 시작한다. 서비스 분리는 실측 병목 발생 시점에만 수행한다.

**이유**: 3~10명 팀이 별도 SRE 없이 6개월간 운영 가능한 최소 구성이 목표다. 분산 구조는 운영 역량 대비 과잉이다.

**트레이드오프**: 단일 프로세스이므로 CPU-heavy 인덱싱과 읽기 트래픽이 경합한다. Level 1(업로드 워커 분리) 전환 전까지 허용 범위.

---

### ADR-002: tree-sitter를 파서로 사용, 정확도 범위 고정

**결정**: 코드 인덱싱에 tree-sitter를 사용한다. 제공 범위는 선언 위치·파일 구조·단순 참조 후보·FTS 심볼 검색에 한정한다.

**이유**: 언어별 자체 파서를 만들면 유지비용이 폭발한다. tree-sitter grammar는 잘 유지되는 OSS 생태계다. 정확 호출 그래프·cross-file name resolution은 이 시스템의 범위 밖이다.

**트레이드오프**: "누가 이 함수를 호출하지?"는 "같은 파일에서 이 이름이 어디 나오지?" 수준에 머문다. 정확 semantic 분석이 필요해지면 Level 2+ SCIP/LSIF 수용으로 확장한다.

---

### ADR-003: storage/db · storage/blob 어댑터 인터페이스 분리

**결정**: DB 접근과 blob 저장소 접근을 각각 독립 인터페이스(`storage/db`, `storage/blob`)로 추상화한다. 나머지 비즈니스 로직은 두 인터페이스에만 의존한다.

**이유**: Variant A(SQLite + 로컬 FS)와 Variant B(PostgreSQL + S3)의 배포 변형을 어댑터 교체만으로 지원하기 위해서다. Level 0→1 전환 시 코드 수정도 최소화된다.

**트레이드오프**: 인터페이스 설계를 잘못 잡으면 어댑터 경계가 누수된다. 처음부터 최소한의 메서드만 포함하고 확장은 필요 시점에 한다.

---

### ADR-004: 두 배포 변형의 API · 데이터 모델 · MCP는 동일

**결정**: Variant A(on-prem: SQLite + 로컬 FS)와 Variant B(AWS: PostgreSQL + S3)는 저장소 어댑터만 다르고, REST API · MCP tool · 데이터 스키마 · CLI는 완전히 동일하다.

**이유**: 두 변형을 별개 시스템으로 분기시키면 유지보수 비용이 2배가 된다. 팀이 A로 시작해 B로 전환할 때 비즈니스 로직 재작성이 불필요해야 한다.

**트레이드오프**: 공통 인터페이스가 Variant B의 S3 고유 기능(range request 최적화 등)을 즉시 활용하지 못할 수 있다. 실측 필요 시 어댑터 내부에서 처리한다.

---

### ADR-005: docker-compose를 기본 배포 경로로 채택

**결정**: Variant A의 기본 배포는 docker-compose 단일 컨테이너다. Kubernetes/Helm은 지원 옵션이지만 기본 경로가 아니다.

**이유**: 저성숙도 팀에게 Kubernetes는 과잉이다. `docker compose pull && up -d`로 배포·업데이트가 완결되어야 한다.

**트레이드오프**: 수평 확장(컨테이너 복수 실행)이 제한된다. Level 1 이상에서 Compose → ECS/Fargate 전환이 필요하다.

---

### ADR-006: source blob 형식으로 zip 채택 (tar.zst 기각)

**결정**: 소스 아카이브는 zip 포맷으로 저장한다. `tar.zst`는 사용하지 않는다.

**이유**: zip central directory는 단일 파일 entry 추출에 O(1) 랜덤 액세스를 제공한다. `tar.zst`는 단일 파일 추출에 O(N) 전체 스트림 디코딩이 필요하다. `/v1/symbols/{key}/body` 구현 시 zip entry 직접 추출이 가능하다.

**트레이드오프**: zip은 `tar.zst` 대비 압축률이 낮다. 저장 비용이 소폭 증가하지만 파일별 접근 성능이 운영상 더 중요하다.

---

### ADR-007: 정적 Bearer token 인증 (MVP)

**결정**: 업로드 인증은 단일 `ANALYZE_UPLOAD_TOKEN` Bearer token으로 처리한다. 읽기는 사내망/VPN 전제로 초기 공개다. OIDC·SSO는 MVP 범위 밖이다.

**이유**: OIDC 통합은 사내 IdP 연동이 선행되어야 한다. 정적 token은 CI secret 또는 Secrets Manager로 관리하면 MVP 수준 보안을 충족한다.

**트레이드오프**: token 탈취 시 즉시 무효화 불가. 개별 사용자·파이프라인 단위 접근 제어 불가. Level 3 이상에서 RBAC·OIDC 도입 예정.

---

### ADR-008: symbol_key를 stable hash ID로 사용

**결정**: 심볼 식별자로 `symbol_key = sha256(repo_name + commit_sha + file_path + name + kind + start_line)` hex(64자)를 사용한다. `symbol_name` 단순 문자열 soft FK는 사용하지 않는다.

> **Session 5 clarification**: 원문은 `repo_id`였으나 CLI/패커 시점에 서버 autoincrement id를 알 수 없어 `repo_name`으로 변경했다. `repo_name`은 사람이 지정하는 안정 식별자이며, Variant A↔B 간 이식성도 보장된다. 필드 구분자는 NUL(\0)을 사용해 경계 모호성을 방지한다. (Session 5, 2026-04-19)

**이유**: 이름만으로는 동명 심볼의 충돌을 막을 수 없다. stable hash ID는 `occurrences` 테이블에서 심볼 참조의 안정성을 보장한다.

**트레이드오프**: 리팩터링(파일 이동·이름 변경)으로 `symbol_key`가 바뀌면 이전 참조가 끊긴다. commit 단위 전체 스냅샷 모델이므로 허용 범위다.

---

### ADR-009: repo_head 테이블로 branch/latest 해석 규약 고정

**결정**: commit/branch 미지정 조회의 인덱스 해석 순서를 `commit 지정 → branch 지정 → repo.default_branch` 순으로 고정한다. `repo_head(repo_id, branch)` 테이블이 브랜치별 최신 commit을 관리한다. `ORDER BY created_at DESC` 같은 비결정적 해석은 금지한다.

**이유**: 조회 시점에 따라 다른 commit을 반환하면 AI 에이전트·도구 간 결과 불일치가 발생한다. `repo_head`로 결정론적 해석을 보장한다.

**트레이드오프**: branch 없이 업로드된 인덱스는 `repo_head`에 기록되지 않아 commit-less 조회가 실패한다. 업로드 시 `branch` 필드 필수화가 전제다.

---

### ADR-010: (repo_id, commit_sha) 조합으로 멱등 업로드

**결정**: `(repo_id, commit_sha)` 조합이 이미 `ready` 상태이면 기존 `index_id`를 반환하고 전체 교체를 수행하지 않는다. `uploading` 또는 `failed` 상태이면 full replace한다.

**이유**: CI 재실행·네트워크 재시도 시 중복 인덱싱을 방지한다. "다시 실행"이 부작용 없이 복구 수단이 되어야 한다.

**트레이드오프**: 같은 commit의 인덱스를 강제 갱신하려면 기존 record를 `failed`로 전이시키는 별도 절차가 필요하다.

---

### ADR-011: MCP는 읽기 전용 tool만 노출

**결정**: MCP server는 `search_symbols`, `get_symbol_body`, `get_references`, `get_file_overview` 4개의 읽기 전용 tool만 노출한다. 쓰기 도구는 MCP로 노출하지 않는다.

**이유**: 중앙 공유 인덱스에서 AI 에이전트가 코드를 직접 수정하는 위험을 차단한다. 읽기 전용으로 제한하면 MCP 클라이언트 권한 관리가 단순해진다.

**트레이드오프**: AI 에이전트가 심볼 위치 정보는 얻지만 소스 파일을 직접 수정하지는 못한다. 이는 의도된 제약이다.

**구현 완료**: Session 7, `packages/mcp-server` + REST wrap, stdio transport.

---

### ADR-012: FTS 전략을 Variant별로 분기

**결정**: Variant A(SQLite)는 FTS5 virtual table + INSERT/UPDATE/DELETE trigger로 동기화한다. Variant B(PostgreSQL)는 `tsvector GENERATED ALWAYS AS ... STORED` + GIN 인덱스를 사용한다.

**이유**: 두 엔진의 FTS 메커니즘이 다르며, 각 엔진의 native 방식이 외부 동기화 로직보다 안정적이다. ADR-003 어댑터 분리로 비즈니스 로직은 FTS 구현에 무관하다.

**트레이드오프**: SQLite trigger는 별도 유지보수 대상이다. Variant B는 trigger 없이 자동 동기화된다. 운영 단순도에서 B가 우위다.

---

### ADR-013: Node.js 22 LTS + TypeScript + Hono 스택 확정 (OQ-001 해결)

**결정**: 서버·CLI·MCP 모두 Node.js 22 LTS + TypeScript로 작성한다. HTTP 프레임워크는 Hono, 패키지 매니저는 pnpm workspace를 사용한다.

**이유**:
- MCP 공식 SDK가 `@modelcontextprotocol/sdk` (Node/TS) 기준이라 ADR-011 읽기 전용 tool 구현에 마찰이 최소
- AWS App Runner/Fargate cold-start에서 Python 대비 우위 (Variant B `§9` 구성에 유리)
- CLI(`analyze .`)와 서버가 tree-sitter WASM 로딩 로직을 공유 가능
- zod 스키마 하나로 REST API·MCP tool·DB row 타입이 단일 출처로 파생

**트레이드오프**: Hono 생태계는 Express/Fastify 대비 얇다. Python 친화 팀에게는 학습 비용이 있으나, MVP 범위의 기능은 표준 미들웨어로 충족 가능. 참조: `/Users/cjenm/.claude/plans/oq-001-snoopy-swan.md`.

---

### ADR-014: codeatlas는 런타임 의존 X, 코드 레퍼런스로 선택 이식

**결정**: `/Users/cjenm/cjenm/platform/codeatlas`(MIT)를 의존성으로 추가하지 않는다. tree-sitter 추출기(`src/indexer/tree-sitter/*-extractor.ts`), 32K 스트리밍 우회 로직(`parser.ts:52-78`), MCP tool 시그니처(탐색 계열)만 선택 이식한다.

**이유**:
- 전역 단일 SQLite(`~/.codeatlas/index.db`) 하드코딩이 우리 multi-repo/commit 모델과 충돌
- HTTP REST·zip blob export·멀티 commit indexes 스키마·Python extractor가 모두 부재 → 재작성 비용이 포크 유지 비용과 대등
- 1인 저자 · 6일차 프로젝트 · LanceDB/Kuzu/Anthropic SDK 등 무거운 런타임을 함께 끌고 옴 → 경량 MVP 철학과 상충
- MIT 라이선스라 선택 이식에 법적 제약 없음

**트레이드오프**: 이식한 코드의 업스트림 변경을 자동 추적 불가. 추출기 버그 수정도 자체 부담. Python extractor 등 미존재 부분은 신규 작성 필요.

---

### ADR-015: 배포 변형은 A·B 병행, Variant A 우선 구현

**결정**: Variant A(SQLite + 로컬 FS)를 1차 구현 대상으로 한다. Variant B(PostgreSQL + S3)는 `storage/db`·`storage/blob` 어댑터 인터페이스 파리티만 유지하고, B 어댑터 구현은 Variant A 완성 및 첫 배포 이후로 이연한다. B skeleton은 미구현 메서드에 `throw new Error("not implemented")`를 남겨 CI 타입 체크는 통과시킨다.

**이유**: ADR-001/005(단일 프로세스 + docker-compose)와 정합하며, 팀이 AWS 계정 없이 즉시 dogfooding 가능하다. ADR-003 어댑터 패턴이 이미 B 전환 비용을 최소화하므로 양쪽 동시 구현은 과잉 투자다.

**트레이드오프**: Variant B 실배포는 A 완성 후 별도 사이클이 필요하다. 어댑터 인터페이스가 A 편향으로 누수되지 않도록 B skeleton 메서드 시그니처 대응을 PR 리뷰에서 체크해야 한다.

---

### ADR-016: 초기 tree-sitter grammar는 TypeScript · Java 2종

**결정**: MVP 초기 grammar 2종은 TypeScript(tsx/js 포함), Java로 확정한다. Kotlin·Python·Go는 FUTURE-TASKS(FT-003·FT-004)로 유보한다.

**이유**: codeatlas(`src/indexer/tree-sitter/`)의 js-extractor.ts(638L) · java-extractor.ts(244L)를 선택 이식하면 2종 extractor를 신규 작성 없이 확보 가능하다 (ADR-014 정합). codeatlas `kotlin-extractor.ts`는 21줄짜리 스텁으로 런타임에서 `throw new Error("Kotlin extraction not implemented")`를 발생시켜 이식 후에도 미동작한다. Kotlin extractor 신규 작성은 추가 2~3일 공수로 MVP 2주 일정과 충돌한다. Python도 codeatlas에 부재해 신규 작성 필요. codeatlas `package.json`이 `tree-sitter-typescript@^0.21.2`, `tree-sitter-java@^0.23.5`를 검증된 조합으로 사용 중이다.

**트레이드오프**: Kotlin·Python 주력 레포는 1차 인덱싱 대상에서 제외된다. Kotlin은 FT-004, Python은 FT-003으로 각각 트리거 조건 도달 시 착수한다.

---

### ADR-017: SQLite 마이그레이션 전략 — 번호 기반 SQL 파일 + 자체 러너 (OQ-004 Variant A 해결)

**결정**: Variant A(SQLite) DB 마이그레이션은 `packages/server/src/storage/db/migrations/` 하위 번호 기반 SQL 파일(`001_*.sql`, `002_*.sql`, …)과 자체 러너(`migrate.ts`)를 사용한다. `node-pg-migrate`는 Variant B(PostgreSQL) 구현 시점으로 이연한다.

**이유**: `node-pg-migrate`는 PostgreSQL 전용이다. SQLite용 외부 마이그레이션 라이브러리는 `better-sqlite3.exec()` 위에 얇은 래퍼에 불과해 외부 의존성 대비 이득이 없다. 번호 기반 SQL 파일은 가장 단순하고 검토하기 쉬우며, `schema_migrations` 테이블로 적용 여부를 추적한다.

**트레이드오프**: 롤백 자동화가 없다. SQLite 특성상 `ALTER TABLE` 제약이 있어 일부 마이그레이션은 테이블 재생성이 필요할 수 있다. Variant B 전환 시 마이그레이션 파일을 재작성해야 한다.

---

### ADR-018: SQLite 드라이버 — `better-sqlite3` 채택

**결정**: Variant A DB 접근 라이브러리로 `better-sqlite3`를 사용한다. `sqlite3`(async callback)·`@libsql/client`는 채택하지 않는다.

**이유**: `better-sqlite3`의 동기 API는 단일 프로세스 모델(ADR-001)과 정합한다. 비동기 callback/Promise 래핑 없이 쿼리를 트랜잭션 내에서 직렬로 실행할 수 있어 FTS5 트리거 동기화(ADR-012)가 단순해진다. TypeScript 타입 정의(`@types/better-sqlite3`)가 공식 제공된다.

**트레이드오프**: 동기 I/O는 대용량 인덱싱 중 이벤트 루프를 차단한다. Level 1 이상(업로드 워커 분리)으로 전환하기 전까지 허용 범위다.

---

### ADR-019: zip 라이브러리 — `adm-zip` 채택

**결정**: `source.zip` 생성(CLI 패커)·단일 파일 추출(서버 `/v1/symbols/:key/body`)에 `adm-zip`을 사용한다. `yazl`/`yauzl` 쌍은 채택하지 않는다.

**이유**: `adm-zip`은 쓰기·읽기를 단일 라이브러리로 처리한다. 랜덤 액세스 단일 entry 추출(`getEntry()`)을 지원하며, ADR-006(zip 중앙 디렉터리 O(1) 접근)을 충족한다. MVP 규모(3~10인 팀 레포)에서 순수 JS 성능이 병목이 아니다.

**트레이드오프**: `yazl`/`yauzl` 대비 성능이 낮다. 메모리 내 전체 zip 로드 방식으로 엔트리 수가 많은 레포에서 메모리 사용량이 증가할 수 있다. 실측 병목 발생 시 `yauzl` 스트리밍 모드로 교체한다.

---

### ADR-020: `analyze push`는 HTTP 전용 — CLI 직접 DB 쓰기 금지

**결정**: `analyze push`는 Variant A·B 모두 동일하게 HTTP(`POST /v1/repos/:name/indexes`, upload, `PATCH /v1/indexes/:id`) 경로를 사용한다. CLI가 `better-sqlite3`를 직접 임포트해 SQLite에 쓰는 방식은 채택하지 않는다.

**이유**: ADR-004("두 배포 변형의 API·CLI는 완전히 동일")를 준수하기 위해서다. CLI가 SQLite에 직접 쓰면 Variant A·B 분기가 CLI 레이어까지 침투해 ADR-003 어댑터 경계가 무력화된다. REST API는 Session 5에서 구현하므로, `analyze push` 명령어도 Session 5로 이연한다. Session 4는 스토리지 레이어(4.5~4.9)와 패커(4.10)만 구현한다.

**트레이드오프**: Session 4에서 `analyze push`를 실행 불가. 패커 출력물(`.codebase-analysis/index.json`, `source.zip`)은 생성되지만 실제 업로드는 Session 5 REST API 완성 후 가능하다.

---

### ADR-021: 별도 독립 레포로 운영 (OQ-006 해결)

**결정**: `codebase-analysis`는 `codebase-memory-sync`(CMS)와 분리된 독립 Git 레포(`github.com/yeochul-jeon/codebase-analysis`)로 운영한다. CMS 모노레포에 패키지로 병합하지 않는다.

**이유**: CMS 본 프로젝트가 현재 홀드 상태이므로 모노레포 통합의 공유 이점(shared tooling, CI 재사용)이 실질적으로 없다. 독립 레포는 CI/CD 파이프라인, 접근 권한, 배포 단위를 분리해 운영 복잡성을 낮춘다. 이미 Session 1부터 별도 레포로 진행 중이며 전환 비용이 크다.

**트레이드오프**: CMS가 재개될 경우 공통 타입·유틸리티 공유에 npm 패키지 배포 또는 git submodule이 필요해진다. 현 시점에서는 두 프로젝트 간 공유 코드가 없으므로 트레이드오프 비용 0.

---

### ADR-022: Variant B 준비 — env 기반 factory + contract test 하네스 + PG FTS 전략 확정

**결정**: (1) `packages/server/src/storage/factory.ts`에 `createDbAdapter()`·`createBlobAdapter()` factory를 신설해 `DB_BACKEND`(`sqlite`|`pg`)·`STORAGE_BACKEND`(`fs`|`s3`) 환경변수로 어댑터를 선택한다. 기본값은 `sqlite`·`fs`. `dev.ts`는 factory만 호출한다. (2) `packages/server/src/storage/__tests__/contract.ts`에 공유 contract test 하네스(`runDbContract`·`runBlobContract`)를 신설하고, 기존 `smoke.ts`는 이를 호출하도록 단순화한다. (3) PostgreSQL 전환 시 전문검색은 `tsvector + GIN`(prefix, `to_tsquery('Foo:*')`)을 사용한다.

**이유**:
- **Factory**: `dev.ts`에 하드코딩된 `SqliteAdapter`/`FsBlobAdapter`는 OQ-004 남은 작업에서 "환경변수 기반 어댑터 선택 로직"으로 명시된 사항이다. B 선택 시 현재 stub이 `notImplemented()` throw를 통해 즉시 노출되어 "겉으로 전환 가능한 척"하는 리스크(FINAL-RISKS §4)를 줄인다.
- **Contract test**: FINAL-RISKS §5가 지적한 "smoke 중심, A 편향 로직 유입 자동 감지 불가" 문제에 대응한다. `runDbContract`/`runBlobContract`를 분리하면 향후 PgAdapter 실구현 시 동일 하네스로 즉시 계약 검증 가능하다(FT-005 부분 완료).
- **FTS5→tsvector**: `to_tsquery('Foo:*')` prefix 토큰 매칭은 FTS5 `name:Foo*` 컬럼 스코프와 의미적으로 가장 근접하다. `pg_trgm` substring은 별도 수요(OQ-009 / FT-007 범위) 확인 시 추가한다.

**트레이드오프**: factory는 런타임에 `DB_BACKEND=pg`를 설정하면 즉시 stub throw가 발생한다 — 이는 의도된 동작으로, 실구현 전 B 선택을 명확히 차단한다. `DbAdapter` 인터페이스 sync/async 전환은 OQ-008 착수 트리거 도달 시 별도 ADR로 결정한다(현재 이연). contract-variant-b.ts는 `RUN_VARIANT_B=1` 없이는 즉시 종료하므로 CI 영향 없다.

---

### ADR-023: `DbAdapter` 인터페이스 sync → async 전환

**결정**: `DbAdapter`의 20개 메서드 반환 타입을 `Promise<T>`로 통일한다. `SqliteAdapter` 내부 구현은 `better-sqlite3` sync 호출을 그대로 유지하고 각 메서드 앞에 `async` 키워드만 추가한다. `PgAdapter`는 처음부터 `pg.Pool` async API로 구현한다.

**이유**: `pg` 드라이버는 본질적으로 async-only다. 인터페이스가 sync이면 `PgAdapter`에서 Promise를 반환하면서 동시에 `DbAdapter`를 구현할 수 없다. ADR-022는 이 전환을 "OQ-008 착수 트리거 도달 시 별도 ADR"로 이연했으며, OQ-008이 Option B로 결정됨에 따라 본 ADR이 그 후속이다.

**영향 범위**:
- `packages/server/src/storage/db/types.ts` — 20 메서드 반환형 변경
- `packages/server/src/storage/db/sqlite.ts` — `async` 키워드 20곳 추가 (내부 sync 유지)
- `packages/server/src/routes/indexes.ts` — `await` 약 15 지점
- `packages/server/src/routes/reads.ts` — `resolveIndex` async 전환 + `await` 약 18 지점
- `packages/server/src/routes/__tests__/smoke.ts` — `await` 3 지점
- `packages/server/src/storage/__tests__/contract.ts` — `await` 약 15 지점 (이미 `async function`)

**트레이드오프**: SQLite 경로에서 microtask 1회/호출 오버헤드가 추가된다 — 무시 가능. 호출부 변경이 기계적(await 추가)이므로 회귀 위험 낮음. 변경 후 `pnpm typecheck`가 누락된 await를 즉시 검출한다.

**Alternatives rejected**:
- `DbAdapterSync`/`DbAdapterAsync` 분리 — factory 반환형이 유니온으로 오염되어 호출부가 타입 가드를 요구함.
- SQLite만 sync, PG만 async — 동일 문제. 라우트 핸들러가 런타임 백엔드에 따라 분기해야 함.

**롤백**: `git revert` 가능. 내부 sync 구현이 유지되므로 인터페이스만 되돌리면 기능 회귀 없음.
