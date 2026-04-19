# Test Results — 2026-04-19

## 목적

이 문서는 코드 리뷰 과정에서 수행한 테스트 추가 및 실행 결과를 정리한다.  
대상 범위는 이번 세션에서 수정한 `packages/server`와 `packages/cli`의 회귀 테스트다.

---

## 요약

이번 세션에서 다음 두 영역에 대해 테스트를 보강하고 통과를 확인했다.

- `server`: 업로드 무결성 및 finalize lifecycle 검증
- `cli`: refs-only 파일 보존, duplicate `symbol_key` 처리 후 parent 해석 정합성, `caller_key` 안정성 개선 검증

최종 상태:

- `pnpm -F @codebase-analysis/server test` 통과
- `pnpm -F @codebase-analysis/cli test` 통과

---

## 1. Server 테스트 결과

실행 명령:

```bash
pnpm -F @codebase-analysis/server test
```

최종 결과:

```text
63 checks: 63 passed, 0 failed
```

### 이번에 추가한 검증 항목

#### 1. `PUT /v1/indexes/:id/index-json` 무결성

- nonexistent `index_id` 업로드 시 `404`
- payload `repo_name` mismatch 시 `409`
- payload `commit_sha` mismatch 시 `409`
- payload `branch` mismatch 시 `409`

#### 2. `PATCH /v1/indexes/:id` lifecycle

- 이미 `ready`인 index 재확정 시 `409`
- nonexistent `index_id` patch 시 `404`
- 아무 업로드 없이 `ready` 시도 시 `409`
- `index-json`만 업로드된 상태에서 `ready` 시도 시 `409`
- `source-zip`만 업로드된 상태에서 `ready` 시도 시 `409`

### 의미

이 변경으로 업로드 대상 index와 payload 간 불일치가 더 이상 조용히 허용되지 않는다.  
또한 finalize는 이제 실제로 준비가 끝난 `uploading` index에만 허용된다.

---

## 2. CLI 테스트 결과

실행 명령:

```bash
pnpm -F @codebase-analysis/cli test
```

최종 결과:

```text
45 checks: 45 passed, 0 failed
```

### 이번에 추가한 검증 항목

#### 1. `analyze`의 refs-only 파일 보존

추가 파일:

- `packages/cli/src/commands/__tests__/analyze.ts`

검증 내용:

- symbols가 있으면 pack 대상
- refs만 있어도 pack 대상
- symbols와 refs가 모두 없으면 제외

#### 2. `pack`의 refs-only 파일 유지

검증 내용:

- refs-only 파일이 `indexJson.files`에 포함됨
- refs-only 파일의 occurrence가 `indexJson.occurrences`에 포함됨
- refs-only 파일이 `source.zip`에도 포함됨

#### 3. duplicate `symbol_key` 이후 parent 해석

검증 내용:

- duplicate parent symbol은 1개만 남음
- child symbol은 유지됨
- surviving child의 `parent_key`가 surviving parent의 `symbol_key`를 가리킴

#### 4. overloaded / 동명 caller의 안정적 `caller_key` 매핑

검증 내용:

- 동일 이름의 method가 여러 개 있어도 `callerNodeId` 기준으로 올바른 symbol에 매핑됨
- 기존 `callerName` fallback은 유지되지만, 가능한 경우 node id 기반 해석이 우선됨

### 의미

이 변경으로 symbol이 없는 호출 전용 파일도 검색/참조 데이터에 반영된다.  
또한 duplicate `symbol_key`가 발생해도 child-parent 관계가 조용히 깨지지 않고, 동명 caller가 있는 경우에도 `caller_key` 오매핑 가능성이 줄어든다.

---

## 3. 테스트 추가 파일

- [packages/server/src/routes/__tests__/smoke.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/server/src/routes/__tests__/smoke.ts)
- [packages/cli/src/commands/__tests__/analyze.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/commands/__tests__/analyze.ts)
- [packages/cli/src/packer/__tests__/smoke.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/packer/__tests__/smoke.ts)

관련 구현 변경 파일:

- [packages/server/src/routes/indexes.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/server/src/routes/indexes.ts)
- [packages/cli/src/commands/analyze.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/commands/analyze.ts)
- [packages/cli/src/packer/index.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/packer/index.ts)
- [packages/cli/src/packer/resolve.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/packer/resolve.ts)
- [packages/cli/src/extractors/typescript.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/extractors/typescript.ts)
- [packages/cli/src/extractors/java.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/cli/src/extractors/java.ts)
- [packages/shared/src/types.ts](/Users/cjenm/cjenm/platform/codebase-analysis/packages/shared/src/types.ts)

---

## 4. 참고

이번 테스트는 코드 리뷰에서 발견한 실제 리스크를 회귀 테스트로 고정하는 목적이었다.  
즉, 기존 스모크 테스트를 반복 실행한 것이 아니라, 문제 재현 케이스를 먼저 추가한 뒤 수정 후 통과를 확인한 흐름이다.
