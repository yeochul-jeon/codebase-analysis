# Getting Started — 단계별 실행 가이드

> 이 문서만 보고 처음부터 끝까지 따라하면 로컬에서 서버가 기동되고, 첫 인덱스를 업로드하고, Claude Desktop에서 MCP tool을 쓸 수 있다.

---

## Step 0 — 사전 요구사항

| 도구 | 최소 버전 | 확인 명령 |
|---|---|---|
| Node.js | 22 LTS | `node --version` |
| pnpm | 10 | `pnpm --version` |
| Docker + Compose | 24+ | `docker compose version` |
| Git | 2.x | `git --version` |

**Node 22 설치 팁 (nvm 사용 시)**:
```bash
nvm install 22
nvm use 22
```

**pnpm 설치**:
```bash
corepack enable
corepack prepare pnpm@10 --activate
```

---

## Step 1 — 레포 클론 + 의존성 설치

```bash
git clone <레포-URL> codebase-analysis
cd codebase-analysis

pnpm install
```

> `pnpm install`은 `better-sqlite3`, `tree-sitter-*` 등 **native addon**을 빌드한다.
> 빌드 실패 시 → [트러블슈팅 #1](#trouble-1-native-build-실패)

설치 후 구조 확인:
```
packages/
├── cli/          ← analyze · push 명령어
├── server/       ← Hono REST API 서버
├── mcp-server/   ← Claude Desktop용 MCP stdio 서버
└── shared/       ← 공통 타입·스키마
```

---

## Step 2 — 토큰 설정 (`.env`)

서버는 업로드 요청을 Bearer token으로 인증한다. **토큰을 먼저 설정해야 Docker 컨테이너가 정상 기동된다.**

```bash
cp docker/.env.example docker/.env
```

`docker/.env`를 열어 토큰 값 변경:

```dotenv
# docker/.env
ANALYZE_UPLOAD_TOKEN=my-super-secret-token-change-me
```

> ⚠️ 기본값 `change-me-to-a-strong-random-string`을 그대로 두면 서버가 기동을 거부한다.
> 길고 무작위적인 문자열을 사용할 것 (`openssl rand -hex 32` 등).

---

## Step 3 — Docker 서버 기동

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

처음 실행 시 이미지를 빌드하므로 2~3분 소요. 이후 기동은 수초.

기동 확인:
```bash
docker compose -f docker/docker-compose.yml ps
# server   Up (healthy)   0.0.0.0:3000->3000/tcp
```

로그 확인:
```bash
docker compose -f docker/docker-compose.yml logs -f server
```

---

## Step 4 — 헬스 체크 + 웹 UI

**헬스 체크**:
```bash
curl http://localhost:3000/healthz
# {"status":"ok"}
```

**웹 UI**: 브라우저에서 <http://localhost:3000> 열기.

검색창이 보이면 서버가 정상이다. 아직 인덱스가 없으므로 결과는 비어 있음.

---

## Step 5 — CLI 빌드

> Docker 서버와 별개로, 소스를 분석하는 `analyze` CLI는 **로컬**에서 실행된다.

```bash
pnpm -F @codebase-analysis/cli build
```

빌드 산출물: `packages/cli/dist/index.js`

개발 중이라면 빌드 없이 직접 실행 가능:
```bash
# tsx를 통해 TypeScript 소스를 직접 실행
pnpm -F @codebase-analysis/cli dev -- --help
```

---

## Step 6 — 첫 인덱스 분석 (`analyze`)

현재 디렉토리(codebase-analysis 레포 자체)를 색인해본다:

```bash
pnpm -F @codebase-analysis/cli dev -- analyze .
```

성공 시 출력 예시:
```
Analyzing 42 source files in /your/path/codebase-analysis…
Wrote 215 symbols from 42 files → .codebase-analysis/
```

생성 파일:
```
.codebase-analysis/
├── index.json    ← 심볼·참조 목록 (JSON)
└── source.zip    ← 원본 소스 압축본
```

**주요 옵션**:
| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--out <dir>` | 출력 디렉토리 | `.codebase-analysis` |
| `--repo-name <name>` | 레포 이름 | 디렉토리 이름 |
| `--commit <sha>` | commit SHA 수동 지정 | `git rev-parse HEAD` |
| `--branch <name>` | branch 이름 수동 지정 | `git rev-parse --abbrev-ref HEAD` |

---

## Step 7 — 서버에 업로드 (`push`)

환경 변수 설정:
```bash
export ANALYZE_UPLOAD_TOKEN=my-super-secret-token-change-me  # Step 2와 동일
export ANALYZE_SERVER_URL=http://localhost:3000
```

업로드:
```bash
pnpm -F @codebase-analysis/cli dev -- push
```

성공 시 출력:
```
Pushed 215 symbols from 42 files → http://localhost:3000 (index_id=1)
```

> 같은 `(repo_name, commit_sha)` 조합을 다시 push하면 `409 Conflict` 응답으로 스킵된다 (멱등). 강제 재업로드가 필요하면 서버에서 해당 인덱스를 삭제 후 재시도.

> ⚠️ **Detached HEAD 주의**: `--branch` 옵션 없이 detached HEAD 상태에서 업로드하면 `branch=null`로 기록된다.  
> 이 경우 `GET /v1/search?repo=...` 요청이 `404`를 반환할 수 있다. `repo_head` 조회 경로(`branch → HEAD`)가 없기 때문이다.  
> **해결**: 조회 시 `commit=<sha>` 파라미터를 명시하거나, 업로드 시 `--branch main`처럼 branch를 지정한다.

---

## Step 8 — REST 검색 테스트

```bash
# 심볼 검색 (q는 영문자·숫자·_ 만 허용)
curl "http://localhost:3000/v1/search?q=resolve&repo=codebase-analysis"

# 특정 심볼 본문 조회 (symbol_key는 위 검색 결과에서 복사)
curl "http://localhost:3000/v1/symbols/<symbol_key>/body"
```

웹 UI에서도 동일하게 검색 가능: <http://localhost:3000>

---

## Step 9 — Claude Desktop MCP 연결

MCP server를 먼저 빌드:
```bash
pnpm -F @codebase-analysis/mcp-server build
```

Claude Desktop 설정 파일 수정:
- macOS: `~/.claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "codebase-analysis": {
      "command": "node",
      "args": ["/절대경로/codebase-analysis/packages/mcp-server/dist/index.js"],
      "env": {
        "ANALYZE_SERVER_URL": "http://localhost:3000"
      }
    }
  }
}
```

Claude Desktop 재시작 후, 대화에서 아래처럼 사용:
```
UserService 클래스 정의 찾아줘.
→ search_symbols({q: "UserService", repo: "codebase-analysis"})
```

사용 가능한 MCP tool 4종 → [docs/API.md#mcp-tool](API.md#mcp-tool)

---

## Step 10 — 재인덱싱·초기화

### 코드 변경 후 재인덱싱

새 커밋을 만들고 `analyze + push`를 다시 실행하면 새 인덱스가 생성되고 검색이 최신 코드를 가리킨다.

```bash
git commit -am "feat: 변경사항"
pnpm -F @codebase-analysis/cli dev -- analyze .
pnpm -F @codebase-analysis/cli dev -- push
```

**같은 커밋 재업로드** → `409 Conflict` (정상 동작, 데이터 불변 보장).

### 전체 데이터 초기화 (개발 환경)

```bash
# ⚠️ -v 옵션은 모든 데이터(SQLite + blob)를 삭제한다
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up --build -d
```

### 토큰 재설정

```bash
# docker/.env 편집 후
docker compose -f docker/docker-compose.yml restart server
```

---

## 트러블슈팅

자주 발생하는 문제 요약. 상세 체크리스트 및 추가 증상(검색 0건·MCP 미표시·웹 UI 빈 화면 등)은 **[docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)** 참고.

| 증상 | 빠른 해결 |
|---|---|
| `gyp ERR!` native build 실패 | macOS: `xcode-select --install` / Ubuntu: `apt-get install python3 make g++` |
| `ANALYZE_UPLOAD_TOKEN must be set` | `cp docker/.env.example docker/.env` 후 토큰 설정 |
| `port 3000 already in use` | `lsof -ti:3000` 으로 프로세스 확인 후 종료 |
| `push` 시 토큰 환경변수 없음 | `export ANALYZE_UPLOAD_TOKEN=<토큰>` 또는 `source docker/.env` |
| `SQLITE_CANTOPEN` | `docker compose down -v && docker compose up --build -d` (⚠️ 데이터 삭제) |

---

## Variant B — PostgreSQL + S3 (MinIO) 구동

> 기본 구성(Variant A)은 SQLite + 로컬 FS다. 수평 확장이 필요하거나 PostgreSQL·S3 어댑터를 검증할 때 아래 절차를 따른다.

### 사전 요구사항

`docker/.env`에 토큰이 설정되어 있어야 한다 (Step 2 완료 상태).

### 1. Variant B 스택 기동

```bash
docker compose -f docker/docker-compose.yml --profile variant-b up -d
```

시작되는 서비스:
- `postgres` — PostgreSQL 16 (포트 5432)
- `minio` — S3 호환 오브젝트 스토리지 (API: 9000, Console: 9001)
- `minio-init` — `ca-blobs` 버킷 자동 생성 (1회성 job)

기동 확인:
```bash
docker compose -f docker/docker-compose.yml ps
# postgres    Up (healthy)
# minio       Up (healthy)
```

### 2. `docker/.env`에 Variant B 환경변수 추가

```dotenv
# Variant B 활성화
DB_BACKEND=pg
STORAGE_BACKEND=s3

# PostgreSQL
PG_URL=postgres://ca:ca@localhost:5432/ca

# MinIO (S3 호환)
S3_BUCKET=ca-blobs
S3_REGION=us-east-1
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=1
```

### 3. 서버 재기동 (Variant B 모드)

```bash
docker compose -f docker/docker-compose.yml up --build -d server
curl http://localhost:3000/healthz
# {"status":"ok"}
```

### 4. Contract Test 실행 (선택)

PgAdapter + S3BlobAdapter가 SQLite/FS 어댑터와 동일한 결과를 반환하는지 검증한다:

```bash
RUN_VARIANT_B=1 \
  PG_URL=postgres://ca:ca@localhost:5432/ca \
  S3_BUCKET=ca-blobs \
  S3_ENDPOINT=http://localhost:9000 \
  S3_ACCESS_KEY_ID=minioadmin \
  S3_SECRET_ACCESS_KEY=minioadmin \
  pnpm -F @codebase-analysis/server test:variant-b
# → 15 checks: 11 db + 4 blob
```

### Variant A로 되돌리기

`docker/.env`에서 `DB_BACKEND`·`STORAGE_BACKEND` 줄을 삭제(또는 주석 처리)하고 서버를 재시작한다. SQLite 데이터(`ca_data` volume)는 유지된다.

---

## 다음 단계

- **일상 사용법 (웹 UI·MCP 예시·재인덱싱·curl)** → [docs/USAGE.md](USAGE.md)
- **문제 해결 체크리스트** → [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- REST/MCP 전체 레퍼런스 → [docs/API.md](API.md)
- 새 언어(Kotlin 등) 추가 방법 → [docs/LANGUAGES.md](LANGUAGES.md)
- 아키텍처 상세 → [docs/OVERVIEW.md](OVERVIEW.md)
