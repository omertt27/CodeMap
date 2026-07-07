import path from "node:path";
import { parseRepository, type ParseOptions, type ParsedRepository } from "../scanner/repository.js";
import type { ParsedFile } from "../languages/ir.js";
import type { Edge, FileNode, Graph, GraphStats, SymbolInfo } from "./types.js";

export type BuildOptions = ParseOptions;

/**
 * The file-level dependency graph: one node per file, one edge per resolved
 * import, with top-level functions/classes as node metadata. A projection of the
 * parser IR consumed by the query API, sidebar detail, and export. (The richer
 * generic graph lives in `builder.ts`; the map view in `mapView.ts`.)
 */
export async function buildGraph(root: string, opts: BuildOptions = {}): Promise<Graph> {
  return projectFileGraph(await parseRepository(root, opts));
}

/** Project already-parsed IR into the file-level graph (no re-parsing). */
export function projectFileGraph(parsed: ParsedRepository): Graph {
  const nodes: FileNode[] = parsed.files.map(projectFile);
  const edges = buildEdges(nodes);
  const stats = computeStats(nodes, edges);
  return {
    version: 1,
    root: parsed.root,
    generatedAt: new Date().toISOString(),
    stats,
    nodes,
    edges,
  };
}

function projectFile(f: ParsedFile): FileNode {
  const info = (s: ParsedFile["symbols"][number]): SymbolInfo => ({
    name: s.name, kind: s.kind as "function" | "class", line: s.line, exported: s.exported,
  });
  return {
    id: `file:${f.path}`,
    path: f.path,
    name: path.posix.basename(f.path),
    dir: path.posix.dirname(f.path) === "." ? "" : path.posix.dirname(f.path),
    lang: f.language,
    loc: f.loc,
    imports: f.imports,
    exports: f.exports,
    functions: f.symbols.filter((s) => s.kind === "function" && !s.parent).map(info),
    classes: f.symbols.filter((s) => s.kind === "class" && !s.parent).map(info),
  };
}

function buildEdges(nodes: FileNode[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const imp of node.imports) {
      if (!imp.resolved) continue;
      const targetId = `file:${imp.resolved}`;
      if (targetId === node.id) continue; // ignore self-imports
      const key = `${node.id}->${targetId}`;
      if (seen.has(key)) continue; // one edge per file pair
      seen.add(key);
      edges.push({
        id: key,
        source: node.id,
        target: targetId,
        type: "import",
        raw: imp.raw,
      });
    }
  }
  return edges;
}

function computeStats(nodes: FileNode[], edges: Edge[]): GraphStats {
  const languages: Record<string, number> = {};
  let functions = 0;
  let classes = 0;
  for (const n of nodes) {
    languages[n.lang] = (languages[n.lang] ?? 0) + 1;
    functions += n.functions.length;
    classes += n.classes.length;
  }
  return { files: nodes.length, edges: edges.length, languages, functions, classes };
}
