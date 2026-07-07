import type { DependencyIndex } from "./graph.js";
import type { NodeMetrics } from "./types.js";

// Per-node dependency metrics, computed on demand (one BFS each way) so the
// sidebar can request them for the selected file without precomputing the full
// transitive closure of the repository.

export function nodeMetrics(
  idx: DependencyIndex,
  id: string,
  extra: { centrality?: number; hotspotScore?: number } = {},
): NodeMetrics | null {
  if (!idx.byId.has(id)) return null;
  const outReach = idx.reach(id, "out");
  const inReach = idx.reach(id, "in");
  return {
    id,
    path: idx.path(id),
    inDegree: idx.inDegree(id),
    outDegree: idx.outDegree(id),
    directImports: idx.outDegree(id),
    directDependents: idx.inDegree(id),
    transitiveImports: outReach.set.size,
    transitiveDependents: inReach.set.size,
    depth: outReach.depth,
    centrality: extra.centrality ?? 0,
    hotspotScore: extra.hotspotScore ?? 0,
  };
}
