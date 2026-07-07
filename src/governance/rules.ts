import type { DependencyIndex } from "../analysis/graph.js";
import type { Analysis } from "../analysis/types.js";
import { globToRegExp } from "../analysis/config.js";
import type { GovernanceConfig } from "./config.js";

// The architecture rule engine — "ESLint for architecture". Evaluates the
// configured rules against the dependency graph and analysis, returning a flat
// list of violations. Threshold overages are warnings; structural breaches
// (cycles, forbidden/layer imports) are errors — CI fails on the level in config.

export type Severity = "error" | "warning";

export interface RuleViolation {
  rule: string;
  severity: Severity;
  file?: string;
  detail: string;
}

export function evaluateRules(idx: DependencyIndex, analysis: Analysis, config: GovernanceConfig): RuleViolation[] {
  const r = config.rules;
  const out: RuleViolation[] = [];

  for (const n of idx.nodes) {
    const fanOut = idx.outDegree(n.id);
    const fanIn = idx.inDegree(n.id);
    if (fanOut > r.maxImports) out.push(warn("maxImports", n.path, `${fanOut} imports (> ${r.maxImports})`));
    if (fanIn > r.maxFanIn) out.push(warn("maxFanIn", n.path, `${fanIn} dependents (> ${r.maxFanIn})`));
    if (fanOut + fanIn > r.maxCoupling) out.push(warn("maxCoupling", n.path, `coupling ${fanOut + fanIn} (> ${r.maxCoupling})`));
    if (n.functions.length > r.maxFunctionCount) out.push(warn("maxFunctionCount", n.path, `${n.functions.length} functions (> ${r.maxFunctionCount})`));
    if (n.loc > r.maxFileSize) out.push(warn("maxFileSize", n.path, `${n.loc} LOC (> ${r.maxFileSize})`));
    const depth = idx.reach(n.id, "out").depth;
    if (depth > r.maxDependencyDepth) out.push(warn("maxDependencyDepth", n.path, `dependency depth ${depth} (> ${r.maxDependencyDepth})`));
  }

  if (!r.allowCircularDependencies) {
    for (const c of analysis.cycles) out.push(err("noCircularDependencies", c.files[0], `cycle (${c.severity}): ${c.files.join(" → ")}`));
  }

  if (config.forbiddenImports.length) {
    const compiled = config.forbiddenImports.map((f) => ({ from: globToRegExp(f.from), to: globToRegExp(f.to), message: f.message }));
    for (const n of idx.nodes) {
      for (const t of idx.out.get(n.id) ?? []) {
        const tp = idx.path(t);
        for (const f of compiled) {
          if (f.from.test(n.path) && f.to.test(tp)) out.push(err("forbiddenImport", n.path, f.message ?? `${n.path} must not import ${tp}`));
        }
      }
    }
  }

  // Layer rules from repo-map.config.json are "custom rules".
  for (const v of analysis.layerViolations) out.push(err("layerViolation", v.from, `${v.rule}: ${v.from} → ${v.to}`));

  return out;
}

export function countBySeverity(violations: RuleViolation[]): { error: number; warning: number } {
  return {
    error: violations.filter((v) => v.severity === "error").length,
    warning: violations.filter((v) => v.severity === "warning").length,
  };
}

function warn(rule: string, file: string, detail: string): RuleViolation {
  return { rule, severity: "warning", file, detail };
}
function err(rule: string, file: string, detail: string): RuleViolation {
  return { rule, severity: "error", file, detail };
}
