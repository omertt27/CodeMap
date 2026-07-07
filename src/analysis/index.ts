import type { Graph } from "../graph/types.js";
import { DependencyIndex } from "./graph.js";
import { detectCycles } from "./cycles.js";
import { scoreHotspots } from "./hotspots.js";
import { detectGodModules } from "./godModules.js";
import { detectUnused } from "./deadCode.js";
import { detectLayerViolations } from "./layers.js";
import { loadAnalysisConfig, type AnalysisConfig } from "./config.js";
import type { Analysis, ArchitectureSummary } from "./types.js";

// The analyzer entry point: parser → graph builder → **analyzer** → UI/CLI/…
// Pure and deterministic; depends only on the file-level graph and config.

export function analyze(graph: Graph, config: AnalysisConfig): Analysis {
  const idx = new DependencyIndex(graph);
  const pageRank = idx.pageRank();

  const scored = scoreHotspots(idx, pageRank);
  const scoreById = new Map(scored.map((h) => [h.id, h.score]));
  const hotspots = scored.filter((h) => h.score > 0).slice(0, 10);

  const cycles = detectCycles(idx);
  const godModules = detectGodModules(idx, config.thresholds);
  const unused = detectUnused(idx, config.entryPoints);
  const layerViolations = detectLayerViolations(idx, config.layers, config.rules);

  let mostCentral: string | null = null;
  let best = -1;
  for (const n of idx.nodes) {
    const v = pageRank.get(n.id) ?? 0;
    if (v > best) { best = v; mostCentral = n.path; }
  }

  const languages: Record<string, number> = {};
  const metrics: Analysis["metrics"] = {};
  for (const n of idx.nodes) {
    languages[n.lang] = (languages[n.lang] ?? 0) + 1;
    metrics[n.id] = {
      inDegree: idx.inDegree(n.id),
      outDegree: idx.outDegree(n.id),
      centrality: pageRank.get(n.id) ?? 0,
      hotspotScore: scoreById.get(n.id) ?? 0,
    };
  }

  const summary: ArchitectureSummary = {
    generatedAt: new Date().toISOString(),
    files: idx.nodes.length,
    edges: graph.edges.length,
    cycles: cycles.length,
    hotspots: hotspots.length,
    godModules: godModules.length,
    unused: unused.length,
    layerViolations: layerViolations.length,
    mostCentral,
    languages,
  };

  return { summary, cycles, hotspots, godModules, unused, layerViolations, metrics };
}

/** Analyze a graph, loading `repo-map.config.json` from `root`. */
export function analyzeRepo(graph: Graph, root: string): Analysis {
  return analyze(graph, loadAnalysisConfig(root));
}

export { DependencyIndex } from "./graph.js";
export { nodeMetrics } from "./metrics.js";
export { loadAnalysisConfig } from "./config.js";
export type { AnalysisConfig } from "./config.js";
export type * from "./types.js";
