# PRD: codebase-analysis (경량 코드 분석 플랫폼 MVP)

## 목표

**3~10명 소프트웨어 팀이 별도 SRE 없이 6개월간 운영 가능한 최소한의 코드 색인·검색 플랫폼을 제공한다.** 사내 다수 레포의 심볼 위치를 REST/MCP로 조회해 IDE와 AI 에이전트가 컨텍스트를 일관되게 얻도록 한다.

---

## 사용자

- **개발자**: IDE/브라우저에서 심볼 검색, 정의/참조 위치 탐색
- **CI 파이프라인**: 커밋마다 `analyze push`로 인덱스 업로드
- **AI 에이전트 (Claude/Cursor 등)**: MCP tool로 심볼 컨텍스트 조회
- **팀 리드**: 사내 레포 전반에서 심볼·파일 구조 탐색

**비-사용자 (명시적 제외)**: 사외 공개용 검색 서비스 사용자, 보안 감사자(SAST 대체 아님)

---

## 핵심 기능

1. **심볼 색인 업로드** — CI 또는 로컬에서 `analyze .` → `analyze push`로 4단계 REST 업로드 수행. tree-sitter 기반 심볼 선언·파일 구조·단순 참조 추출. (상세: [docs/API.md](API.md#rest--쓰기-엔드포인트-bearer-필요))
2. **심볼 검색 (FTS)** — `GET /v1/search?q=&repo=&lang=`로 이름·시그니처 전문 검색. SQLite FTS5 또는 PostgreSQL GIN.
3. **심볼 본문 조회** — `GET /v1/symbols/{key}/body`가 source.zip에서 해당 심볼 라인 범위를 추출해 반환.
4. **파일/참조 탐색** — `GET /v1/symbols/{key}/references`, `GET /v1/repos/{slug}/files`로 파일 목록·참조 후보 제공.
5. **MCP 읽기 전용 tool** — `search_symbols`, `get_symbol_body`, `get_references`, `get_file_overview` 4개 노출.
6. **최소 웹 UI** — 검색창 + 결과 리스트 + 심볼 상세 페이지 (vanilla HTML, 서버 정적 서빙).
7. **단일 배포 단위** — docker-compose 1개 파일(Variant A) 또는 App Runner 이미지(Variant B)로 전체 시스템 배포.

---

## MVP 제외 사항

- ❌ **정확 호출 그래프** — tree-sitter는 파서일 뿐. semantic resolver 없음 (ADR-002).
- ❌ **교차 파일·교차 레포 name resolution** — 동일 업로드 단위 내 탐색만 지원.
- ❌ **시맨틱(벡터) 검색** — LanceDB/임베딩은 FUTURE-TASKS.md의 확장 항목.
- ❌ **그래프 쿼리 (impact analysis, circular deps)** — Kuzu/Neo4j는 FUTURE-TASKS.md.
- ❌ **코드 편집 tool (rename/replace/insert)** — 중앙 서버에서 쓰기 tool 미노출 (ADR-011).
- ❌ **실시간 협업 편집, 코드 리뷰 워크플로** — GitHub/GitLab이 담당.
- ❌ **SAST / 보안 취약점 스캐닝** — 별도 도구 영역.
- ❌ **OIDC/SSO, RBAC** — 정적 Bearer token으로 시작 (ADR-007).
- ❌ **실시간 push-on-commit 인덱싱** — CI 배치 업로드 기반.
- ❌ **Kubernetes 기본 지원** — docker-compose가 기본 경로 (ADR-005).

---

## 디자인

- **웹 UI**: 기능 중심 미니멀. 페이지 3개(검색, 심볼 상세, 파일 개요)만 제공.
- **타이포그래피**: 시스템 폰트(-apple-system, Segoe UI 등) + `ui-monospace` 코드 블록.
- **색상**: 무채색 기본 + 포인트 1가지 (심볼 kind 강조용). 다크/라이트 모두 시스템 설정 추종(`prefers-color-scheme`).
- **인터랙션**: SPA 불필요. 폼 제출 + 서버 렌더. 클라이언트 JS는 검색 자동완성 수준으로 최소화.
- **CLI UX**: 진행률 표시(파일 수 기준), 에러는 컬러 + 원인 경로 함께 출력.
- **API 문서**: `/openapi.json` 자동 노출 + `/docs` Swagger UI(선택).

---

## 성공 지표 (MVP 기준)

- 레포 50개·합계 50만 심볼까지 p95 검색 latency < 300ms (Variant A SQLite, 단일 서버)
- 업로드 end-to-end < 60s (레포당 10만 라인 기준)
- MCP tool 왕복 < 500ms (Claude Desktop 기준)
- 2주 내 5개 레포 실환경 색인 · 팀 내부 dogfooding 완료

---

## 비-목표 (MVP 이후에도 스코프 아님)

- 사외 공개 SaaS
- 수백만 줄 모노레포 단일 처리 (Level 1+에서 워커 분리 필요)
- 다중 테넌트 격리 (단일 조직 전제)
