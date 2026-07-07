import type { DependencyIndex } from "./graph.js";
import { globToRegExp, type Layer, type LayerRule } from "./config.js";
import type { LayerViolation } from "./types.js";

// A small, configurable architecture rule system. Each file is assigned to a
// layer by glob patterns; each import is checked against the "cannotImport"
// rules. Files that match no layer are unconstrained (e.g. tests can import
// anything simply by not being in a restricted layer).

export function detectLayerViolations(idx: DependencyIndex, layers: Layer[], rules: LayerRule[]): LayerViolation[] {
  if (!layers.length || !rules.length) return [];
  const compiled = layers.map((l) => ({ name: l.name, regexes: l.patterns.map(globToRegExp) }));
  const layerOf = (p: string): string | null => compiled.find((l) => l.regexes.some((r) => r.test(p)))?.name ?? null;
  const forbidden = new Map<string, Set<string>>();
  for (const rule of rules) {
    const set = forbidden.get(rule.from) ?? new Set<string>();
    for (const t of rule.cannotImport) set.add(t);
    forbidden.set(rule.from, set);
  }

  const out: LayerViolation[] = [];
  for (const source of idx.nodes) {
    const fromLayer = layerOf(source.path);
    if (!fromLayer) continue;
    const banned = forbidden.get(fromLayer);
    if (!banned || banned.size === 0) continue;
    for (const targetId of idx.out.get(source.id) ?? []) {
      const target = idx.byId.get(targetId)!;
      const toLayer = layerOf(target.path);
      if (toLayer && banned.has(toLayer)) {
        out.push({
          from: source.path,
          to: target.path,
          fromLayer,
          toLayer,
          rule: `${fromLayer} cannot import ${toLayer}`,
        });
      }
    }
  }
  return out;
}
