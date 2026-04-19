# Future Tasks — 추후 확장 태스크

> MVP 범위 밖이지만 설계상 확장 여지를 남겨두는 기능들.
> 각 태스크는 트리거 조건 도달 시 ADR로 승격해 착수한다.

---

## FT-001: 시맨틱 검색 (벡터 기반)

**목표**: 자연어 쿼리·유사 코드 검색을 지원하는 시맨틱 retrieval plane 추가.

**동기**:
- MCP 클라이언트(AI 에이전트)에서 "X와 유사한 함수 찾아줘" 같은 쿼리 수요
- codeatlas의 LanceDB + Xenova MiniLM(all-MiniLM-L6-v2, 384차원, 로컬 임베딩) 참고 가능

**후보 스택**:
| 후보 | 장점 | 단점 |
|---|---|---|
| **pgvector** (Variant B에 통합) | RDS 내 단일 DB · 백업·트랜잭션 통합 | 초대형(1M+ 벡터) 성능 열위 |
| **LanceDB** (embedded) | Arrow 기반 · Node.js 친화 · 로컬 파일 저장 | Variant A에서만 실용적, 멀티 노드 운영 복잡 |
| **외부 관리형** (Pinecone/Weaviate) | 운영 부담 낮음 | 비용 · 외부 의존성 |
| **임베딩 모델**: Xenova(`all-MiniLM-L6-v2`) 로컬 vs OpenAI/Voyage API | 로컬=비용 0, 원격=품질 우위 | — |

**범위 (최소 착수 스펙)**:
1. `symbols` 테이블에 `embedding_vector` 컬럼 추가 (pgvector) 또는 별도 LanceDB 테이블
2. 인덱스 업로드 시 심볼 signature + docstring을 임베딩해 저장
3. `GET /v1/search?mode=semantic&q=...` 신규 엔드포인트
4. MCP tool `semantic_search_symbols` 추가
5. 임베딩 실패/미지원 언어 fallback → 기존 FTS 결과 사용

**의존 결정**:
- OQ-002 (배포 변형) — Variant B면 pgvector, Variant A면 LanceDB 우세
- 임베딩 생성 위치 — CLI vs 서버 (CLI가 bulk 처리에 유리)

**트리거 조건** (`01-design.md §10` Level 3):
- MCP 클라이언트에서 자연어/유사 코드 쿼리 요청 발생
- FTS 검색 품질에 대한 명시적 사용자 피드백 축적
- 심볼 > 50만 개 + 레포 > 100개 규모 도달

**예상 공수**: 2주 (임베딩 파이프라인 1주 + 스토리지/쿼리 1주)

**참조**:
- `codeatlas/src/vectors/embedder.ts`, `codeatlas/src/vectors/vector-store.ts`
- CMS `docs/ADR.md:ADR-015` Phase 3(pgvector 확장 시나리오)
- `01-design.md §10` 성숙도 로드맵

---

## FT-002: 그래프 DB 기반 관계 쿼리

**목표**: 심볼 간 호출·구현·타입 관계를 다중 홉으로 순회하는 그래프 쿼리 plane 추가.

**동기**:
- 영향 분석(impact analysis), 순환 의존성 탐지, 구현체 매핑 등은 recursive CTE만으로는 성능·표현력 한계
- codeatlas의 Kuzu 통합 경험 참고 가능

**후보 스택**:
| 후보 | 장점 | 단점 |
|---|---|---|
| **PostgreSQL recursive CTE + materialized view** | 추가 DB 불필요 · MVP 스택 유지 | 3-4홉 초과 시 성능 열위 |
| **Kuzu** (embedded graph DB) | Arrow 기반 · 로컬 파일 · Cypher-like 쿼리 | 커뮤니티 성숙도 중간 |
| **Neo4j** | 업계 표준 Cypher · 도구 생태계 성숙 | 별도 서비스 운영 부담 · 라이선스 |
| **Apache AGE** (PG extension) | RDS 내 Cypher · 단일 DB | extension 가용성 제약 (RDS 정책 확인 필요) |

**범위 (최소 착수 스펙)**:
1. `symbol_relationships` 테이블 추가 (SCIP `Occurrence.role`의 구현·상속 관계 기록)
2. Phase 1: PostgreSQL recursive CTE로 3-홉 이내 쿼리 구현
3. `GET /v1/symbols/{key}/impact?depth=3` 엔드포인트
4. MCP tool `get_impact_analysis`, `find_implementors` 추가
5. Phase 2 (트리거 도달 시): Kuzu 또는 Neo4j로 projection 추가

**의존 결정**:
- FT-001과 분리 진행 가능 (벡터와 그래프는 독립)
- 관계 데이터 원천 — tree-sitter만으로는 구현 관계 추출 한계. SCIP/LSIF 수용 파이프라인과 연동 필요

**트리거 조건** (`01-design.md §10` Level 4):
- 멀티홉 CTE p99 > 2초 지속
- Cross-language 그래프 쿼리 수요 발생
- 관계 레코드 > 500만 건

**예상 공수**: 3주 (Phase 1 CTE 2주 + Phase 2 graph DB 평가·도입 1주+)

**참조**:
- `codeatlas/src/graph/` (Kuzu 통합 참고)
- CMS `docs/ADR.md:ADR-010` `symbol_relationships` 테이블 설계
- CMS `docs/ADR.md:ADR-015` Phase 4(graph projection 확장 시나리오)
- `01-design.md §10` 성숙도 로드맵

---

## FT-003: Python extractor 신규 작성

**목표**: `packages/cli/src/extractors/python.ts` 추가. tree-sitter-python grammar 기반 심볼 선언·참조 추출.

**동기**: ADR-016에서 초기 grammar를 TS/Java/Kotlin으로 확정하며 Python을 MVP 범위 밖으로 이연. codeatlas에 Python extractor가 부재하므로 TS extractor 구조를 템플릿으로 신규 작성 필요.

**범위 (최소 착수 스펙)**:
1. `tree-sitter-python` grammar 번들 추가
2. 함수 정의(`function_definition`), 클래스(`class_definition`), 임포트(`import_statement`) 심볼 추출
3. `packages/cli/src/extractors/typescript.ts` 구조를 템플릿으로 활용

**트리거 조건**: Python 주력 레포 색인 수요 발생 시.

**예상 공수**: 2~3일 (grammar 검증 포함)

---

## FT-004: Kotlin extractor 신규 작성

**목표**: `packages/cli/src/extractors/kotlin.ts` 추가. tree-sitter-kotlin grammar 기반 심볼 선언·참조 추출.

**동기**: ADR-016에서 codeatlas `kotlin-extractor.ts`가 21줄 스텁·런타임 throw임을 확인, Kotlin을 MVP 범위 밖으로 이연. Java extractor(244L) 구조를 템플릿으로 신규 작성 필요. JVM 계열 Android·백엔드 레포 지원을 위해 Python(FT-003)보다 우선 착수가 유력하다.

**범위 (최소 착수 스펙)**:
1. `tree-sitter-kotlin@^0.3.8` grammar 번들 추가
2. 함수(`function_declaration`), 클래스(`class_declaration`), 오브젝트(`object_declaration`), 임포트(`import_header`) 심볼 추출
3. `packages/cli/src/extractors/java.ts` 구조를 템플릿으로 활용

**트리거 조건**: Kotlin 주력 레포(Android·백엔드) 색인 수요 발생 시.

**예상 공수**: 2~3일 (grammar 검증 포함)

---

## FT-005: Variant B Contract Test ✅ 완료 (2026-04-19)

**목표**: `pg.ts`(PostgreSQL)와 `s3.ts`(S3) 어댑터가 `sqlite.ts`/`fs.ts`와 동일한 입력에 동일한 응답을 반환함을 자동 검증.

**완료된 작업 (ADR-022·023, OQ-008 Option B)**:
1. ✅ `packages/server/src/storage/__tests__/contract.ts` — `runDbContract`(11 checks) + `runBlobContract`(4 checks) 하네스
2. ✅ `smoke.ts`가 contract 하네스를 호출하도록 단순화
3. ✅ `packages/server/src/storage/__tests__/contract-variant-b.ts` — PgAdapter + S3BlobAdapter 실행 드라이버 (`RUN_VARIANT_B=1` 게이트)
4. ✅ `PgAdapter` 실구현 (DbAdapter async 전환 포함, ADR-023) + PG migrations (`migrations-pg/`)
5. ✅ `S3BlobAdapter` 실구현
6. ✅ docker-compose `variant-b` profile (postgres:16 + minio + minio-init)

**남은 작업 (후속 세션)**:
- CI에서 `PG_URL`/`S3_BUCKET` 주입 스크립트
- Variant B 모드 실레포 dogfooding E2E

**실행**: `RUN_VARIANT_B=1 PG_URL=... S3_BUCKET=... pnpm -F @codebase-analysis/server test:variant-b`  
→ 15 checks: 11 db + 4 blob

---

## FT-006: 성능 기준선 벤치마크

**목표**: 실측 데이터로 PRD 성능 목표(p95 < 300ms, 레포 50개·50만 심볼)의 실현 가능성 검증.

**동기**: 단일 프로세스 + `better-sqlite3` 동기 호출 + zip 본문 추출의 경합 지점이 설계상 위험으로 남아 있다. 실측 없이 목표를 약속할 수 없다.

**측정 대상**:
- FTS5 검색 latency — 50만 심볼 기준 p50/p95/p99
- `adm-zip getEntry()` 메모리 사용량 — 대형 zip (> 100MB) 기준
- 동시 업로드 + 조회 시 read latency 저하 (10 concurrent requests)
- FTS5 트리거 유지 비용 — 대용량 `insertSymbols` 후 검색 속도

**범위 (최소 착수 스펙)**:
1. `scripts/bench.ts` 작성 — k6 또는 autocannon 기반
2. 레포 10개·10만 심볼 fixture 생성 (실제 데이터 또는 합성)
3. 기준선 수치 `docs/BENCH-RESULTS.md`에 기록

**트리거 조건**: 레포 10개 이상 실운영 시작 또는 검색 latency 불만 보고 발생 시  
**예상 공수**: 2~3일 (fixture 생성 포함)

---

## FT-007: 검색 계약 확장

**목표**: `/v1/search`에 파일 경로 필터, 복합 쿼리 지원 추가.

**동기**: 현재 `q` 파라미터는 영문자·숫자·`_`만 허용. 실사용에서 "왜 이 검색은 안 되지?"가 반복될 수 있다.

**범위 (최소 착수 스펙)**:
1. `path=` 파라미터 추가 — `src/service.ts` 또는 `src/**/*.ts` glob 필터
2. FTS5 `MATCH` 문법에서 `AND` / `OR` 연산자 허용 (현재 단어 하나만)
3. 기존 `q` 제약 완화 — 대소문자 혼용, 특수문자 일부 허용
4. `GET /v1/repos/:name/file-symbols` 확장 — 여러 파일 경로 배열 지원 (선택)

**의존 결정**: OQ-009 합의 — 현상 유지 vs 확장  
**트리거 조건**: OQ-009가 "Option B"로 결정 시  
**예상 공수**: 1~2일

---

## FT-008: 감사 로그 · 토큰 회전

**목표**: 운영 환경에서 쓰기 이벤트 감사 가능성 확보 및 토큰 관리 개선.

**동기**: 현재 `ANALYZE_UPLOAD_TOKEN`은 단일 정적 문자열. 토큰 노출 시 서버 재시작 없이 무효화 불가. 사용자 단위 식별도 없다.

**범위 (최소 착수 스펙)**:
1. 쓰기 요청마다 `repo_name`, 타임스탬프, IP를 서버 로그에 기록 (감사 로그 v1)
2. `ANALYZE_UPLOAD_TOKEN`을 쉼표 구분 다중 값으로 확장 (토큰 교체 시 downtime 없음)
3. 토큰별 별칭(`token_id`) 지정 → 감사 로그에 token_id 포함

**의존 결정**: OQ-008 (사외망 운영 수요 발생 여부)  
**트리거 조건**: 사외망 또는 다중 팀 운영 수요 발생 시. 사내망 전용 운영에서는 불필요.  
**예상 공수**: 1~2일

---

## 공통 원칙

1. **primary store는 PostgreSQL/SQLite 유지** — 벡터·그래프는 파생 projection plane으로만 추가 (CMS ADR-015 정책 계승)
2. **어댑터 확장 우선** — `storage/db`, `storage/blob` 인터페이스에 `vector`, `graph` 메서드를 추가하는 형태로 통합. 코어 라우팅 로직 변경 최소화
3. **읽기 전용 유지** — MCP tool surface는 추가되지만 모두 read-only (ADR-011)
4. **트리거 없이 착수 금지** — "있으면 좋을 것" 수준 수요로는 도입하지 않는다. 실측 병목·사용자 피드백이 선행 조건
