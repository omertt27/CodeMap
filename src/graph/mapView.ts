import type { CodeGraph } from "./model.js";

// A compact projection of the generic CodeGraph for the interactive map: only
// the structural/dependency layer (files, directories, external packages and
// their IMPORTS/CONTAINS edges). Symbol-level detail is fetched lazily per file
// via the query API, so the payload stays small as repositories grow.

export interface MapNode {
  id: string;
  type: "File" | "Directory" | "Package";
  name: string;
  path: string;
  language: string | null;
  loc: number;
  /** Total import edges touching this node (drives sizing + degree filter). */
  degree: number;
}

export interface MapEdge {
  id: string;
  type: "IMPORTS" | "CONTAINS";
  source: string;
  target: string;
}

export interface MapGraph {
  root: string;
  generatedAt: string;
  nodes: MapNode[];
  edges: MapEdge[];
  languages: string[];
}

const MAP_NODE_TYPES = new Set(["File", "Directory", "Package"]);
const MAP_EDGE_TYPES = new Set(["IMPORTS", "CONTAINS"]);

export function toMapGraph(graph: CodeGraph): MapGraph {
  const importDegree = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type !== "IMPORTS") continue;
    importDegree.set(e.source, (importDegree.get(e.source) ?? 0) + 1);
    importDegree.set(e.target, (importDegree.get(e.target) ?? 0) + 1);
  }

  const nodes: MapNode[] = [];
  const kept = new Set<string>();
  const languages = new Set<string>();
  for (const n of graph.nodes) {
    if (!MAP_NODE_TYPES.has(n.type)) continue;
    kept.add(n.id);
    if (n.language) languages.add(n.language);
    nodes.push({
      id: n.id,
      type: n.type as MapNode["type"],
      name: n.name,
      path: n.path ?? n.name,
      language: n.language ?? null,
      loc: n.loc ?? 0,
      degree: importDegree.get(n.id) ?? 0,
    });
  }

  const edges: MapEdge[] = [];
  for (const e of graph.edges) {
    if (!MAP_EDGE_TYPES.has(e.type)) continue;
    if (!kept.has(e.source) || !kept.has(e.target)) continue;
    edges.push({ id: e.id, type: e.type as MapEdge["type"], source: e.source, target: e.target });
  }

  return {
    root: graph.root,
    generatedAt: graph.generatedAt,
    nodes,
    edges,
    languages: [...languages].sort(),
  };
}
