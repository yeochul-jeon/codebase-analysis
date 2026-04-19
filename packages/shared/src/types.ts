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
  calleeName: string;
  kind: 'call' | 'field_access' | 'type_reference' | 'annotation';
}

export interface ExtractionResult {
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
  refs: ExtractedRef[];
}
