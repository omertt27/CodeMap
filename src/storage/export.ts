import type { Graph } from "../graph/types.js";
import { summarize, type Summary } from "../graph/summary.js";
import { deriveSymbols } from "../graph/symbols.js";
import type { FileNode, Edge, SymbolNode, ContainsEdge } from "../graph/types.js";

/** Bump when the export shape changes in a backward-incompatible way. */
export const SCHEMA_VERSION = "1.0.0";
export const SCHEMA_ID = "https://codemap.dev/schema/codemap-v1.json";

/**
 * A stable, self-describing document meant for downstream consumers
 * (AI agents, dashboards, other tools). The shape is frozen by
 * `schema/codemap.schema.json`; only additive changes are allowed within a
 * major `schemaVersion`.
 */
export interface CodemapExport {
  $schema: string;
  schemaVersion: string;
  tool: "codemap";
  generatedAt: string;
  root: string;
  stats: Graph["stats"];
  summary: Summary;
  nodes: FileNode[];
  edges: Edge[];
  symbols: SymbolNode[];
  contains: ContainsEdge[];
}

export function buildExport(graph: Graph): CodemapExport {
  const { symbols, contains } = deriveSymbols(graph);
  return {
    $schema: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    tool: "codemap",
    generatedAt: graph.generatedAt,
    root: graph.root,
    stats: graph.stats,
    summary: summarize(graph),
    nodes: graph.nodes,
    edges: graph.edges,
    symbols,
    contains,
  };
}
