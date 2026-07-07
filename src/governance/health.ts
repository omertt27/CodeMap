import type { DependencyIndex } from "../analysis/graph.js";
import type { Analysis } from "../analysis/types.js";
import type { RuleViolation } from "./rules.js";

// A deterministic repository health score (0-100, higher = healthier) plus five
// category scores. Each factor that hurts architecture — cycles, coupling,
// complexity, hotspots, dead code, volatility, violations — pushes the score
// down monotonically. The weights are opinionated but stable across runs, so the
// number is meaningful *as a trend*.

export interface HealthScore {
  overall: number;
  maintainability: number;
  stability: number;
  modularity: number;
  coupling: number;
  complexity: number;
  factors: {
    files: number;
    edges: number;
    avgDegree: number;
    cycles: number;
    cycleFiles: number;
    godModules: number;
    unused: number;
    hotspotAvg: number;
    avgLoc: number;
    avgFunctions: number;
    violations: { error: number; warning: number };
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeHealth(
  idx: DependencyIndex,
  analysis: Analysis,
  violations: RuleViolation[],
  opts: { stability?: Map<string, number> } = {},
): HealthScore {
  const files = idx.nodes.length || 1;
  const edges = idx.nodes.reduce((s, n) => s + idx.outDegree(n.id), 0);
  const avgDegree = (2 * edges) / files;
  const cycleFiles = analysis.cycles.reduce((s, c) => s + c.files.length, 0);
  const cycleRatio = cycleFiles / files;
  const god = analysis.godModules.length;
  const unused = analysis.unused.length;
  const deadRatio = unused / files;
  const avgLoc = idx.nodes.reduce((s, n) => s + n.loc, 0) / files;
  const avgFunctions = idx.nodes.reduce((s, n) => s + n.functions.length, 0) / files;
  const hotspotAvg = analysis.hotspots.length ? analysis.hotspots.reduce((s, h) => s + h.score, 0) / analysis.hotspots.length : 0;
  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;
  const violationPenalty = Math.min(100, errors * 8 + warnings * 2);

  const coupling = clamp(100 - Math.max(0, avgDegree - 2) * 14);
  const complexity = clamp(100 - Math.max(0, avgLoc - 120) / 8 - Math.max(0, avgFunctions - 6) * 3 - (god / files) * 200);
  const modularity = clamp(100 - cycleRatio * 150 - deadRatio * 80 - (analysis.cycles.length > 0 ? 8 : 0));

  let stability: number;
  if (opts.stability && opts.stability.size) {
    let low = 0, counted = 0;
    for (const n of idx.nodes) {
      const s = opts.stability.get(n.path);
      if (s !== undefined) { counted++; if (s < 40) low++; }
    }
    stability = clamp(100 - (counted ? (low / counted) * 120 : 0));
  } else {
    stability = clamp(100 - cycleRatio * 100 - hotspotAvg * 0.3);
  }

  const maintainability = clamp(0.4 * complexity + 0.3 * (100 - hotspotAvg) + 0.3 * (100 - violationPenalty));

  const overall = clamp(
    0.25 * maintainability + 0.2 * modularity + 0.2 * coupling + 0.2 * stability + 0.15 * complexity - Math.min(30, errors * 3),
  );

  return {
    overall, maintainability, stability, modularity, coupling, complexity,
    factors: {
      files, edges, avgDegree: +avgDegree.toFixed(2), cycles: analysis.cycles.length, cycleFiles,
      godModules: god, unused, hotspotAvg: Math.round(hotspotAvg), avgLoc: Math.round(avgLoc),
      avgFunctions: +avgFunctions.toFixed(1), violations: { error: errors, warning: warnings },
    },
  };
}

/** A quick letter grade for display. */
export function grade(score: number): string {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 55 ? "D" : "F";
}
