# 팀 내 소개 데모 스크립트 (10분)

**목표**: "AI 에이전트가 사내 코드베이스를 즉시 이해한다" 흐름 전달  
**핵심 순서**: 기동(2분) → 색인(2분) → Web UI 훑기(2분) → MCP 하이라이트(4분)

---

## 사전 준비 (발표 전)

```bash
# 1. 의존성 설치
cd /Users/cjenm/cjenm/platform/codebase-analysis
pnpm install

# 2. 토큰 설정
cp docker/.env.example docker/.env
# docker/.env → ANALYZE_UPLOAD_TOKEN=demo-secret-token 으로 수정

# 3. MCP 빌드
pnpm -F @codebase-analysis/mcp-server build

# 4. Claude Desktop MCP 설정 (~/.claude/claude_desktop_config.json)
# {
#   "mcpServers": {
#     "codebase-analysis": {
#       "command": "node",
#       "args": ["/Users/cjenm/cjenm/platform/codebase-analysis/packages/mcp-server/dist/index.js"],
#       "env": { "ANALYZE_SERVER_URL": "http://localhost:3000" }
#     }
#   }
# }
```

---

## [00:00] 오프닝 — 한 줄 설명

> "사내 코드를 색인하면 Claude가 레포를 체크아웃 없이 바로 조회할 수 있습니다. 오늘은 그 흐름을 보여드릴게요."

---

## [00:30] STEP 1 — 서버 기동 (1분 30초)

```bash
docker compose -f docker/docker-compose.yml up --build -d
curl http://localhost:3000/healthz
# → {"status":"ok"}
```

> "Docker 하나로 끝납니다. SQLite + 로컬 파일 저장 — 별도 DB 서버 없음."

브라우저: `http://localhost:3000` 열기 → 빈 검색창 보여주기

---

## [02:00] STEP 2 — 이 레포 자체 색인 (2분)

```bash
export ANALYZE_UPLOAD_TOKEN=demo-secret-token
export ANALYZE_SERVER_URL=http://localhost:3000

pnpm -F @codebase-analysis/cli dev -- analyze .
# → 463 symbols / 35 files

pnpm -F @codebase-analysis/cli dev -- push
# → index_id=1, status: ready

# 멱등성 시연 — 같은 커밋 재실행
pnpm -F @codebase-analysis/cli dev -- push
# → "already ready — skipping"
```

> "TypeScript, JavaScript, Java 3개 언어를 tree-sitter로 파싱합니다. 같은 커밋을 두 번 push해도 409로 안전하게 처리됩니다."

---

## [04:00] STEP 3 — Web UI (1분 30초)

브라우저에서 `http://localhost:3000`:

1. **검색**: `repo=codebase-analysis`, `q=createApp` → Enter
2. 결과에서 `createApp` 클릭 → **심볼 상세** (signature + body + references)
3. references에서 파일 경로 클릭 → **파일 개요**

> "이 정도면 팀원이 모르는 코드 진입점을 빠르게 파악할 수 있습니다."

---

## [05:30] STEP 4 — MCP 하이라이트 ★ 메인 (4분)

Claude Desktop 열기 → 하단 🔨 아이콘 클릭 → `codebase-analysis` tool 4종 확인

### 시나리오 1: 심볼 검색
```
"codebase-analysis 레포에서 SqliteAdapter 클래스가 어디 있는지 찾아줘"
```
→ Claude가 `search_symbols` 호출 → 파일 경로 + 라인 반환

### 시나리오 2: 코드 본문 조회
```
"SqliteAdapter의 searchSymbols 메서드 코드 보여줘"
```
→ `get_symbol_body` 호출 → 실제 소스 반환  
> "레포 클론 없이, IDE 없이 코드 본문을 가져옵니다."

### 시나리오 3: 참조 위치 탐색
```
"createApp이 어디서 호출되는지 알려줘"
```
→ `get_references` 호출 → 호출 위치 목록  
> "영향 분석의 첫 번째 단계입니다. semantic resolver가 아닌 이름 기반이라 false positive가 있을 수 있습니다."

### 시나리오 4: 파일 구조 파악
```
"packages/server/src/routes/reads.ts 파일에 어떤 함수들이 있어?"
```
→ `get_file_overview` 호출 → 파일 내 심볼 목록  
> "코드 리뷰 전 파일 구조 파악에 유용합니다."

---

## [09:30] 클로징 (30초)

> "CLI로 색인 → 서버 저장 → Claude/Cursor MCP로 조회. 팀 레포를 등록하면 AI 에이전트가 사내 코드 컨텍스트를 바로 씁니다. 3~10명 팀이 SRE 없이 self-host 가능하도록 설계했고, 현재 Java·TS 지원, 추후 Kotlin도 예정입니다."

---

## 예상 질문 & 답변

| 질문 | 답변 |
|---|---|
| 보안은? | 쓰기는 Bearer token 필수, 읽기는 사내망/VPN 전제로 공개. OIDC는 추후 예정 |
| 실시간 업데이트? | 커밋 후 `analyze && push` 재실행. CI 파이프라인에 연결 가능 |
| 대형 레포는? | 현재 500만 심볼 기준선 미측정 — FT-006 벤치마크 예정 |
| Kotlin/Python? | Kotlin은 FT-004(예정), Python은 FT-003(예정) |
| GitHub Actions 연동? | `push` 커맨드를 CI 스텝에 추가하면 됨. 예시는 GETTING-STARTED.md |
