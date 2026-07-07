import type { DependencyIndex } from "./graph.js";
import type { Hotspot } from "./types.js";

// A hotspot is a file that concentrates architectural risk. We normalise five
// signals to 0..1 (relative to the repo's maximum), weight them, and scale to a
// 0..100 score. Deterministic and explainable — every hotspot lists why.

const WEIGHTS = {
  dependents: 0.30, // many files rely on it → changes ripple
  centrality: 0.25, // PageRank importance
  dependencies: 0.15, // imports a lot → coupled
  loc: 0.15, // large file
  exports: 0.15, // wide public surface
};

export function detectHotspots(idx: DependencyIndex, pageRank: Map<string, number>, top = 10): Hotspot[] {
  return scoreHotspots(idx, pageRank).filter((h) => h.score > 0).slice(0, top);
}

/** Score every file (sorted high→low). Used for the top-N list and per-node risk. */
export function scoreHotspots(idx: DependencyIndex, pageRank: Map<string, number>): Hotspot[] {
  const max = { dependents: 1, dependencies: 1, loc: 1, exports: 1, centrality: 1e-9 };
  for (const n of idx.nodes) {
    max.dependents = Math.max(max.dependents, idx.inDegree(n.id));
    max.dependencies = Math.max(max.dependencies, idx.outDegree(n.id));
    max.loc = Math.max(max.loc, n.loc);
    max.exports = Math.max(max.exports, n.exports.length);
    max.centrality = Math.max(max.centrality, pageRank.get(n.id) ?? 0);
  }

  const hotspots: Hotspot[] = idx.nodes.map((n) => {
    const dependents = idx.inDegree(n.id);
    const dependencies = idx.outDegree(n.id);
    const centrality = pageRank.get(n.id) ?? 0;
    const norm = {
      dependents: dependents / max.dependents,
      dependencies: dependencies / max.dependencies,
      loc: n.loc / max.loc,
      exports: n.exports.length / max.exports,
      centrality: centrality / max.centrality,
    };
    const score = Math.round(
      100 *
        (norm.dependents * WEIGHTS.dependents +
          norm.centrality * WEIGHTS.centrality +
          norm.dependencies * WEIGHTS.dependencies +
          norm.loc * WEIGHTS.loc +
          norm.exports * WEIGHTS.exports),
    );
    return {
      id: n.id,
      path: n.path,
      score,
      reasons: reasonsFor(norm),
      dependents,
      dependencies,
      loc: n.loc,
      exports: n.exports.length,
      centrality,
    };
  });

  return hotspots.sort((a, b) => b.score - a.score);
}

function reasonsFor(n: { dependents: number; dependencies: number; loc: number; exports: number; centrality: number }): string[] {
  const r: string[] = [];
  if (n.dependents >= 0.5) r.push("many dependents");
  if (n.centrality >= 0.5) r.push("high centrality");
  if (n.dependencies >= 0.5) r.push("many dependencies");
  if (n.loc >= 0.5) r.push("large file");
  if (n.exports >= 0.5) r.push("wide public API");
  return r.length ? r : ["elevated combined risk"];
}
