# 트러블슈팅 — 증상별 디버깅 체크리스트

> 빠른 찾기: 증상을 아래 표에서 찾아 해당 섹션으로 이동.

| 증상 | 섹션 |
|---|---|
| Docker/서버 기동 실패, 포트 충돌, build 에러 | [§1 기동·설치 실패](#1-기동--설치-실패) |
| `push` 명령 실패 (401, 409, 400, timeout) | [§2 업로드 실패](#2-업로드-push-실패) |
| 검색 결과 0건 또는 404 | [§3 검색 결과 없음](#3-검색-결과-0건--404) |
| Claude Desktop에 tool이 안 보임 | [§4 MCP tool 미표시](#4-mcp-tool이-claude-desktop에-안-보임) |
| 웹 UI 빈 화면, `/s/<key>` 404 | [§5 웹 UI 문제](#5-웹-ui-빈-화면--404) |
| Postgres·MinIO 연결 실패 (Variant B) | [§6 Variant B 문제](#6-variant-b-postgresminio-연결-실패) |
| 어떤 에러인지 모르겠음 | [§7 로그 수집](#7-로그-수집) |

---

## 1. 기동 · 설치 실패

### `port 3000 already in use`

```bash
# 3000 포트 점유 프로세스 확인
lsof -ti:3000
# 프로세스 종료 (pid는 위 결과로 대체)
kill -9 <pid>
```

또는 `docker/docker-compose.yml`에서 포트를 바꾼다:
```yaml
ports:
  - "3001:3000"   # 호스트 3001 → 컨테이너 3000
```
이 경우 `ANALYZE_SERVER_URL`도 `http://localhost:3001`로 맞춰야 한다.

---

### `ANALYZE_UPLOAD_TOKEN must be set`

`docker/.env` 파일이 없거나 토큰이 기본값 그대로다.

```bash
cp docker/.env.example docker/.env
# 편집기로 docker/.env 열어 강한 토큰으로 교체
openssl rand -hex 32   # 토큰 생성 예시
```

---

### `better-sqlite3` / `tree-sitter` native build 실패 (`gyp ERR!`)

빌드 도구가 없는 경우:

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt-get install -y python3 make g++

# 이후 재설치
pnpm install
```

Node.js 버전 확인:
```bash
node --version   # 22.x.x 이어야 함
```

nvm 사용 시:
```bash
nvm use 22
```

---

### `SQLITE_CANTOPEN` (volume 권한 오류)

Docker volume `ca_data`의 파일 권한 문제.

```bash
# ⚠️ -v는 데이터를 삭제한다. 운영 환경에서 주의.
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up --build -d
```

---

### 컨테이너 unhealthy 상태

```bash
# 서버 로그 확인
docker compose -f docker/docker-compose.yml logs --tail=50 server

# 컨테이너 상태 상세
docker compose -f docker/docker-compose.yml ps
```

---

## 2. 업로드 (push) 실패

### `401 Unauthorized`

`push` 명령이 사용하는 토큰(`ANALYZE_UPLOAD_TOKEN`)이 서버와 불일치.

```bash
# 확인
echo $ANALYZE_UPLOAD_TOKEN

# 서버 토큰과 비교 (docker/.env)
cat docker/.env | grep ANALYZE_UPLOAD_TOKEN

# 재설정
export ANALYZE_UPLOAD_TOKEN=<정확한-토큰>
```

---

### `409 Conflict` — 같은 커밋 재업로드

**이것은 정상 동작이다.** 같은 `(repo_name, commit_sha)` 조합을 다시 push하면 서버가 409로 거부한다(멱등 보장).

재업로드가 필요하다면 두 가지 방법:
1. **새 커밋으로 push** — 코드를 수정하고 `git commit` 후 `analyze + push`
2. **기존 인덱스 삭제 후 재시도** — 현재 API는 수동 삭제 미지원. 전체 초기화 필요:
   ```bash
   docker compose -f docker/docker-compose.yml down -v
   docker compose -f docker/docker-compose.yml up -d
   ```

---

### `400 Bad Request` — schema_version 불일치

`index.json`의 `schema_version`이 서버 스키마와 다르다.

```bash
cat .codebase-analysis/index.json | head -5
# "schema_version": 1 이어야 함
```

CLI를 최신 버전으로 재빌드:
```bash
pnpm -F @codebase-analysis/cli build
```

---

### push 중 timeout / 대형 레포

zip 파일이 매우 크면(`> 50MB`) upload가 느려질 수 있다.

확인:
```bash
ls -lh .codebase-analysis/source.zip
```

압축 대상 파일 수 줄이기 — 레포 루트에 `.codebase-analysis-ignore` 패턴 추가 또는 `--out` 옵션으로 범위를 좁힌다.

---

### `ANALYZE_UPLOAD_TOKEN environment variable is not set` (push 실행 시)

```bash
export ANALYZE_UPLOAD_TOKEN=<토큰>
# 또는
set -a && source docker/.env && set +a
```

---

## 3. 검색 결과 0건 / 404

### repo 이름 불일치

push 시 사용한 repo 이름과 검색 시 `?repo=` 파라미터가 다른 경우:

```bash
# push 시 사용한 이름 확인
cat .codebase-analysis/index.json | grep repo_name

# 검색에서 정확히 일치시킴
curl "http://localhost:3000/v1/search?q=greet&repo=<정확한-이름>"
```

---

### commit SHA / branch 해석 실패 (ADR-009)

서버는 `commit 명시 > branch > default_branch HEAD` 순으로 인덱스를 찾는다.

detached HEAD 상태로 push하면 `branch=null`로 저장되어 branch 경로로 조회 불가:

```bash
# 확인 방법: push 시 출력에서 branch 값 확인
# 또는
cat .codebase-analysis/index.json | grep branch

# 해결: 검색 시 commit 명시
curl "http://localhost:3000/v1/search?q=greet&repo=my-app&commit=<sha>"

# 근본 해결: push 시 branch 명시
pnpm -F @codebase-analysis/cli dev -- analyze . --branch main
```

---

### `q` 파라미터 제약 위반 → `400`

`q`는 `[A-Za-z0-9_]+` 만 허용. 다음은 모두 에러:

| 잘못된 예 | 이유 |
|---|---|
| `user service` | 공백 포함 |
| `src/service.ts` | `/` 포함 |
| `get-by-id` | `-` 포함 |
| `사용자Service` | 한글 포함 |

CamelCase나 snake_case로 입력:
```bash
# ✅
curl ".../v1/search?q=UserService"
curl ".../v1/search?q=get_user"
```

---

### 경로·파일명 검색 안 됨

FTS는 **심볼 이름**만 색인한다. `src/service.ts`처럼 경로로 검색하면 0건.

파일 내 심볼을 보려면 파일 개요 API 사용:
```bash
curl "http://localhost:3000/v1/repos/my-app/file-symbols?path=src/service.ts"
```

또는 웹 UI의 `/f?repo=my-app&path=src/service.ts` 페이지.

---

### push는 성공했는데 검색이 안 됨

`PATCH /v1/indexes/:id` (finalize) 단계가 성공했는지 확인:

```bash
# push 직후 출력에 "status: ready" 있는지 확인
# 또는 healthz로 서버 정상 확인
curl http://localhost:3000/healthz
```

인덱스 상태가 `uploading`에 멈춰 있으면 서버 로그를 확인:
```bash
docker compose -f docker/docker-compose.yml logs --tail=30 server
```

---

## 4. MCP tool이 Claude Desktop에 안 보임

### 체크리스트 (순서대로)

**1. Claude Desktop 재시작**  
설정 변경 후 반드시 앱을 완전히 종료(`Cmd+Q` macOS) 후 재시작.

**2. `dist/index.js` 존재 확인**
```bash
ls packages/mcp-server/dist/index.js
# 없으면:
pnpm -F @codebase-analysis/mcp-server build
```

**3. 절대 경로 확인**
```bash
# 현재 위치 확인
pwd   # 이 값 + /packages/mcp-server/dist/index.js 로 설정
```

`claude_desktop_config.json` 예시:
```json
{
  "mcpServers": {
    "codebase-analysis": {
      "command": "node",
      "args": ["/Users/yourname/projects/codebase-analysis/packages/mcp-server/dist/index.js"],
      "env": {
        "ANALYZE_SERVER_URL": "http://localhost:3000"
      }
    }
  }
}
```

`~` (홈 디렉토리 단축) 사용 불가. 전체 경로 필수.

**4. JSON 문법 오류 확인**  
설정 파일을 열어 trailing comma, 따옴표 누락 등 확인:
```bash
# macOS
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python3 -m json.tool
```

**5. 서버 정상 기동 확인**
```bash
curl http://localhost:3000/healthz
# {"status":"ok"} 이어야 함
```

**6. MCP 로그 확인**

```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp-server-codebase-analysis.log
```

로그 파일 경로:
| OS | 경로 |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-codebase-analysis.log` |
| Windows | `%APPDATA%\Claude\logs\mcp-server-codebase-analysis.log` |

---

## 5. 웹 UI 빈 화면 · 404

### 서버 정상 여부 확인

```bash
curl http://localhost:3000/healthz
```

응답이 없으면 → [§1 기동·설치 실패](#1-기동--설치-실패) 참고.

---

### 검색 결과 빈 화면

인덱스가 없거나 `?repo=` 이름 불일치. [§3 검색 결과 없음](#3-검색-결과-0건--404) 참고.

---

### `/s/<key>` 404

심볼 key가 잘못됐거나 인덱스가 초기화됐다.  
검색(`/`)에서 결과를 클릭해 얻은 URL만 유효하다. URL을 직접 입력할 경우 64자 hex인지 확인:

```
/s/a1b2c3...  (64자 hex — 정상)
/s/UserService  (이름 직접 입력 — 동작 안 함)
```

---

### 정적 파일 캐시 문제

코드를 수정한 후 UI가 갱신이 안 될 때:
- macOS: `Cmd + Shift + R` (하드 리로드)
- Windows/Linux: `Ctrl + Shift + R`

---

## 6. Variant B (Postgres·MinIO) 연결 실패

### Postgres 연결 실패

```bash
# 컨테이너 상태 확인
docker compose --profile variant-b ps

# postgres 응답 확인
docker compose exec postgres pg_isready -U ca -d ca
# 출력: /var/run/postgresql:5432 - accepting connections

# 로그
docker compose logs --tail=30 postgres
```

---

### MinIO 연결 실패

```bash
# MinIO health 확인
curl -f http://localhost:9000/minio/health/live

# 버킷 생성 확인 (MinIO Console)
# 브라우저에서 http://localhost:9001 열기 (user: minioadmin / pw: minioadmin)
# ca-blobs 버킷 존재 여부 확인
```

`minio-init` 서비스가 실패했을 경우 수동으로 버킷 생성:
```bash
docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec minio mc mb local/ca-blobs
```

---

### migrations 실패

```bash
docker compose logs server | grep -i "migration\|error"
```

PG schema가 깨졌으면 DB를 초기화:
```bash
docker compose --profile variant-b down -v
docker compose --profile variant-b up -d
```

---

## 7. 로그 수집

문제를 보고하거나 디버깅할 때 수집할 로그:

```bash
# 서버 로그 (최근 100줄)
docker compose -f docker/docker-compose.yml logs --tail=100 server

# 특정 API 상세 호출 로그
curl -v "http://localhost:3000/v1/search?q=UserService&repo=my-app"

# MCP 로그 (macOS)
tail -50 ~/Library/Logs/Claude/mcp-server-codebase-analysis.log

# Variant B 전체 로그
docker compose --profile variant-b logs --tail=50 server postgres minio
```

---

## 참조

- 처음 설치·기동 → [docs/GETTING-STARTED.md](GETTING-STARTED.md)
- 일상 사용법 → [docs/USAGE.md](USAGE.md)
- REST/MCP 레퍼런스 → [docs/API.md](API.md)
