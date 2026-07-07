import type { Graph } from "../graph/types.js";
import { DependencyIndex } from "../analysis/graph.js";
import { detectCycles } from "../analysis/cycles.js";
import { computeImpact, type ImpactContext } from "./impact.js";
import type { ImpactReport } from "./types.js";

// The impact analyzer: parser → graph builder → architecture analyzer → **impact
// analyzer** → UI/CLI. Pure and deterministic; reusable by CLI, UI, MCP, CI.

/** One-shot impact analysis for a single target (path or node id). */
export function analyzeImpact(graph: Graph, target: string): ImpactReport | null {
  const idx = new DependencyIndex(graph);
  const ctx = buildImpactContext(idx);
  const id = resolveTarget(idx, target);
  return id ? computeImpact(idx, id, ctx) : null;
}

/** Precompute the shared context (PageRank + cycles) once for many targets. */
export function buildImpactContext(idx: DependencyIndex): ImpactContext {
  const pageRank = idx.pageRank();
  let maxCentrality = 0;
  for (const v of pageRank.values()) maxCentrality = Math.max(maxCentrality, v);
  return { pageRank, maxCentrality, cycles: detectCycles(idx) };
}

/** Resolve a node id, repo-relative path, or absolute/partial path to a node id. */
export function resolveTarget(idx: DependencyIndex, target: string): string | null {
  if (idx.byId.has(target)) return target;
  const norm = target.replace(/^file:/, "").replace(/\\/g, "/").replace(/^\.\//, "");
  const exact = idx.nodes.find((n) => n.path === norm);
  if (exact) return exact.id;
  const suffix = idx.nodes.find((n) => norm.endsWith("/" + n.path) || n.path.endsWith("/" + norm));
  return suffix ? suffix.id : null;
}

export { computeImpact } from "./impact.js";
export type { ImpactContext } from "./impact.js";
export type * from "./types.js";
