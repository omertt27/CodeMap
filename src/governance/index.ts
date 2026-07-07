import type { Graph } from "../graph/types.js";
import { DependencyIndex } from "../analysis/graph.js";
import { analyzeRepo, type Analysis } from "../analysis/index.js";
import { loadGovernanceConfig, type FailLevel } from "./config.js";
import { evaluateRules, countBySeverity, type RuleViolation } from "./rules.js";
import { computeHealth, grade, type HealthScore } from "./health.js";
import { recordTrend, type Trend } from "./trend.js";

// The governance orchestrator: graph + analysis → rules → health → trend.
// Deterministic and dependency-light so the CLI, server API, and CI all share it.

export interface GovernanceResult {
  root: string;
  generatedAt: string;
  grade: string;
  health: HealthScore;
  violations: RuleViolation[];
  violationCounts: { error: number; warning: number };
  criticalViolations: RuleViolation[];
  topHotspots: Analysis["hotspots"];
  trend: Trend;
  failOn: FailLevel;
}

export function runGovernance(
  graph: Graph,
  root: string,
  opts: { analysis?: Analysis; stability?: Map<string, number>; save?: boolean } = {},
): GovernanceResult {
  const config = loadGovernanceConfig(root);
  const idx = new DependencyIndex(graph);
  const analysis = opts.analysis ?? analyzeRepo(graph, root);
  const violations = evaluateRules(idx, analysis, config);
  const health = computeHealth(idx, analysis, violations, { stability: opts.stability });
  const trend = recordTrend(root, health, { save: opts.save });

  return {
    root,
    generatedAt: new Date().toISOString(),
    grade: grade(health.overall),
    health,
    violations,
    violationCounts: countBySeverity(violations),
    criticalViolations: violations.filter((v) => v.severity === "error"),
    topHotspots: analysis.hotspots.slice(0, 10),
    trend,
    failOn: config.failOn,
  };
}

/** Whether CI should fail, per the configured `failOn` level. */
export function governanceFails(result: GovernanceResult): boolean {
  const { error, warning } = result.violationCounts;
  if (result.failOn === "error") return error > 0;
  if (result.failOn === "warning") return error + warning > 0;
  return false;
}

export * from "./config.js";
export * from "./rules.js";
export * from "./health.js";
export * from "./trend.js";
export * from "./report.js";
export * from "./pr.js";
