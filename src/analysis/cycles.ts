import type { DependencyIndex } from "./graph.js";
import type { Cycle, Severity } from "./types.js";

// Circular dependencies = strongly-connected components of size >= 2. For each
// we report the files involved, the length, a severity, and a heuristic edge to
// cut: the internal import whose source already has the most dependencies (the
// busiest file's extra back-reference is usually the accidental coupling).

export function detectCycles(idx: DependencyIndex): Cycle[] {
  const sccs = tarjanSCC(idx);
  const cycles: Cycle[] = [];
  let i = 0;
  for (const comp of sccs) {
    if (comp.length < 2) continue;
    const members = new Set(comp);
    let suggestedBreak: Cycle["suggestedBreak"] = null;
    let bestDeg = -1;
    for (const u of comp) {
      for (const v of idx.out.get(u) ?? []) {
        if (!members.has(v)) continue;
        const deg = idx.outDegree(u);
        if (deg > bestDeg) { bestDeg = deg; suggestedBreak = { from: idx.path(u), to: idx.path(v) }; }
      }
    }
    const length = comp.length;
    const severity: Severity = length <= 2 ? "low" : length <= 4 ? "medium" : "high";
    cycles.push({
      id: `cycle:${i++}`,
      files: comp.map((id) => idx.path(id)).sort(),
      length,
      severity,
      suggestedBreak,
    });
  }
  return cycles.sort((a, b) => b.length - a.length);
}

/** Iterative Tarjan (stack-safe on large graphs). Returns all components. */
function tarjanSCC(idx: DependencyIndex): string[][] {
  const ids = idx.nodes.map((n) => n.id);
  let index = 0;
  const idxOf = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];

  for (const start of ids) {
    if (idxOf.has(start)) continue;
    const call: { node: string; i: number }[] = [{ node: start, i: 0 }];
    while (call.length) {
      const frame = call[call.length - 1];
      const node = frame.node;
      if (frame.i === 0) {
        idxOf.set(node, index);
        low.set(node, index);
        index++;
        stack.push(node);
        onStack.add(node);
      }
      const neighbors = idx.out.get(node) ?? [];
      if (frame.i < neighbors.length) {
        const next = neighbors[frame.i++];
        if (!idxOf.has(next)) call.push({ node: next, i: 0 });
        else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, idxOf.get(next)!));
      } else {
        if (low.get(node) === idxOf.get(node)) {
          const comp: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== node);
          out.push(comp);
        }
        call.pop();
        if (call.length) {
          const parent = call[call.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
        }
      }
    }
  }
  return out;
}
