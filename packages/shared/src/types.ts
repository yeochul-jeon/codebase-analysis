/**
 * 추출기가 산출하는 심볼 엔트리.
 * `_nodeId`는 extractor 내부의 로컬 카운터로, 소비자(packer)가
 * localId → stable symbol_key(ADR-008) 맵을 구성해 parent_id를 해석한다.
 * 삭제 시 부모-자식 계층이 조용히 깨지므로 유지 필수.
 */
export interface ExtractedSymbol {
  name: string;
  kind: string;
  signature?: string | null;
  parent_id?: number | null;
  start_line: number;
  end_line: number;
  modifiers?: string[] | null;
  annotations?: string[] | null;
  _nodeId?: number;
}

export interface ExtractedDependency {
  targetFqn: string;
  kind: 'import' | 'extends' | 'implements';
}

export interface ExtractedRef {
  callerName: string;
  callerNodeId?: number | null;
  calleeName: string;
  kind: 'call' | 'field_access' | 'type_reference' | 'annotation';
  line: number;  // 1-based source line of the reference node
}

export interface PackedSymbol {
  symbol_key: string;         // sha256 hex 64 chars
  parent_key: string | null;
  file_path: string;          // repo-relative POSIX path
  name: string;
  kind: string;
  signature: string | null;
  start_line: number;
  end_line: number;
  modifiers: string[];
  annotations: string[];
}

export interface PackedOccurrence {
  caller_key: string | null;
  callee_name: string;
  kind: 'call' | 'field_access' | 'type_reference' | 'annotation';
  file_path: string;
  line: number;
}

export interface PackedIndex {
  schema_version: 1;
  repo_name: string;
  commit_sha: string;
  branch: string | null;
  generated_at: number;       // unix seconds
  symbols: PackedSymbol[];
  occurrences: PackedOccurrence[];
  files: string[];            // POSIX paths that contributed symbols
}

export interface ExtractionResult {
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
  refs: ExtractedRef[];
}
