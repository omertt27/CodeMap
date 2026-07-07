import type { CodeGraph } from "../graph/model.js";
import type { DependencyIndex } from "../analysis/index.js";

// Symbol search over the generic graph. "references" is approximated by the
// files that import the symbol's file (we don't build a call graph), which is
// enough for an agent to see where a symbol's module is used.

const SYMBOL_TYPES = new Set(["Class", "Function", "Method", "Interface", "Enum", "Variable"]);

export interface SymbolHit {
  name: string;
  kind: string;
  path: string;
  line: number;
  exported: boolean;
  references: string[];
}

export function searchSymbols(codeGraph: CodeGraph, index: DependencyIndex, name: string, limit = 25): SymbolHit[] {
  const q = name.trim().toLowerCase();
  if (!q) return [];
  const hits: SymbolHit[] = [];
  for (const n of codeGraph.nodes) {
    if (!SYMBOL_TYPES.has(n.type) || !n.name.toLowerCase().includes(q)) continue;
    const references = (index.in.get(`file:${n.path}`) ?? []).map((id) => index.path(id));
    hits.push({ name: n.name, kind: n.type, path: n.path ?? "", line: n.line ?? 0, exported: !!n.exported, references });
    if (hits.length >= limit * 2) break;
  }
  // Exact-name matches first, then shorter names (more specific).
  return hits
    .sort((a, b) => Number(b.name.toLowerCase() === q) - Number(a.name.toLowerCase() === q) || a.name.length - b.name.length)
    .slice(0, limit);
}
