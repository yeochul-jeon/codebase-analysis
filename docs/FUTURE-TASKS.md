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

## 공통 원칙

1. **primary store는 PostgreSQL/SQLite 유지** — 벡터·그래프는 파생 projection plane으로만 추가 (CMS ADR-015 정책 계승)
2. **어댑터 확장 우선** — `storage/db`, `storage/blob` 인터페이스에 `vector`, `graph` 메서드를 추가하는 형태로 통합. 코어 라우팅 로직 변경 최소화
3. **읽기 전용 유지** — MCP tool surface는 추가되지만 모두 read-only (ADR-011)
4. **트리거 없이 착수 금지** — "있으면 좋을 것" 수준 수요로는 도입하지 않는다. 실측 병목·사용자 피드백이 선행 조건
