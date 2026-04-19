import type { ExtractedRef, ExtractedSymbol, PackedOccurrence, PackedSymbol } from '@codebase-analysis/shared';
import { computeSymbolKey } from './symbol-key.js';

const CALLER_KINDS = new Set(['method', 'function', 'constructor', 'getter', 'setter', 'arrow_function']);

export function resolveFileSymbols(
  repoName: string,
  commitSha: string,
  filePath: string,
  extracted: ExtractedSymbol[],
): { symbols: PackedSymbol[]; callerMap: Map<string, string>; callerNodeMap: Map<number, string> } {
  // Pass 1: compute symbol_key per _nodeId; also build caller name→key map.
  const nodeIdMap = new Map<number, string>();
  const callerMap = new Map<string, string>();
  const callerNodeMap = new Map<number, string>();
  const keySet = new Set<string>();
  const accepted: Array<{ original: ExtractedSymbol; packed: PackedSymbol }> = [];

  for (const sym of extracted) {
    const key = computeSymbolKey({
      repoName,
      commitSha,
      filePath,
      name: sym.name,
      kind: sym.kind,
      startLine: sym.start_line,
    });

    if (keySet.has(key)) {
      console.warn(`[packer] duplicate symbol_key dropped: ${sym.name} ${sym.kind} ${filePath}:${sym.start_line}`);
      continue;
    }
    keySet.add(key);

    if (sym._nodeId !== undefined && sym._nodeId !== null) {
      nodeIdMap.set(sym._nodeId, key);
    }

    if (CALLER_KINDS.has(sym.kind)) {
      if (sym._nodeId !== undefined && sym._nodeId !== null) {
        callerNodeMap.set(sym._nodeId, key);
      }
      if (!callerMap.has(sym.name)) {
        callerMap.set(sym.name, key);
      }
    }

    accepted.push({
      original: sym,
      packed: {
        symbol_key: key,
        parent_key: null, // resolved in pass 2
        file_path: filePath,
        name: sym.name,
        kind: sym.kind,
        signature: sym.signature ?? null,
        start_line: sym.start_line,
        end_line: sym.end_line,
        modifiers: sym.modifiers ?? [],
        annotations: sym.annotations ?? [],
      },
    });
  }

  // Pass 2: resolve parent_key using nodeIdMap.
  for (const entry of accepted) {
    const orig = entry.original;
    if (orig.parent_id !== null && orig.parent_id !== undefined) {
      const parentKey = nodeIdMap.get(orig.parent_id);
      if (parentKey) {
        entry.packed = { ...entry.packed, parent_key: parentKey };
      } else {
        console.warn(`[packer] unresolved parent_id ${orig.parent_id} for ${orig.name} in ${filePath}`);
      }
    }
  }

  return { symbols: accepted.map((entry) => entry.packed), callerMap, callerNodeMap };
}

export function resolveFileOccurrences(
  filePath: string,
  refs: ExtractedRef[],
  callerMap: Map<string, string>,
  callerNodeMap: Map<number, string>,
): PackedOccurrence[] {
  return refs.map((ref) => ({
    caller_key:
      (ref.callerNodeId !== undefined && ref.callerNodeId !== null
        ? callerNodeMap.get(ref.callerNodeId)
        : undefined) ??
      callerMap.get(ref.callerName) ??
      null,
    callee_name: ref.calleeName,
    kind: ref.kind,
    file_path: filePath,
    line: ref.line,
  }));
}
