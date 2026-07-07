import type { DependencyIndex } from "./graph.js";
import type { Thresholds } from "./config.js";
import type { GodModule } from "./types.js";

// Flags files that look too large or too central using simple, configurable
// thresholds. Intentionally humble: a file must trip several thresholds at once,
// and the result is labelled "possible God module" — a prompt to look, not a verdict.

export function detectGodModules(idx: DependencyIndex, t: Thresholds): GodModule[] {
  const out: GodModule[] = [];
  for (const n of idx.nodes) {
    const dependents = idx.inDegree(n.id);
    const reasons: string[] = [];
    if (n.loc > t.loc) reasons.push(`${n.loc} LOC (> ${t.loc})`);
    if (n.functions.length > t.functions) reasons.push(`${n.functions.length} functions (> ${t.functions})`);
    if (n.classes.length > t.classes) reasons.push(`${n.classes.length} classes (> ${t.classes})`);
    if (n.exports.length > t.exports) reasons.push(`${n.exports.length} exports (> ${t.exports})`);
    if (dependents > t.dependents) reasons.push(`${dependents} dependents (> ${t.dependents})`);
    if (reasons.length >= t.minSignals) {
      out.push({
        id: n.id,
        path: n.path,
        reasons,
        loc: n.loc,
        functions: n.functions.length,
        classes: n.classes.length,
        exports: n.exports.length,
        dependents,
      });
    }
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length);
}
