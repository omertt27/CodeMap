import type { Graph, SymbolGraph, SymbolNode, ContainsEdge } from "./types.js";

/**
 * Promote the functions/classes stored on each file node into first-class
 * symbol nodes plus file→symbol containment edges. Derived on demand so the
 * stored graph stays small; both the UI (symbol view) and `export` use this.
 */
export function deriveSymbols(graph: Graph): SymbolGraph {
  const symbols: SymbolNode[] = [];
  const contains: ContainsEdge[] = [];

  for (const file of graph.nodes) {
    const decls = [...file.functions, ...file.classes];
    for (const d of decls) {
      const id = `sym:${file.path}#${d.kind}:${d.name}@${d.line}`;
      symbols.push({
        id,
        name: d.name,
        kind: d.kind,
        file: file.id,
        path: file.path,
        lang: file.lang,
        line: d.line,
        exported: d.exported,
      });
      contains.push({ id: `${file.id}=>${id}`, source: file.id, target: id, type: "contains" });
    }
  }

  return { symbols, contains };
}
