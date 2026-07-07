import type { DependencyIndex } from "./graph.js";
import { matchesAny } from "./config.js";
import type { UnusedFile } from "./types.js";

// Conservative "possibly unused" detection. A file is flagged only when it has
// NO dependents AND is NOT an entry point AND is NOT reachable from any entry
// point (following imports). Entry points include tests, so anything a test
// touches is considered used. The label is deliberately "possibly unused".

export function detectUnused(idx: DependencyIndex, entryPatterns: string[]): UnusedFile[] {
  const entries = idx.nodes.filter((n) => matchesAny(n.path, entryPatterns)).map((n) => n.id);
  const reachable = reachableFrom(idx, entries);
  const entrySet = new Set(entries);

  const out: UnusedFile[] = [];
  for (const n of idx.nodes) {
    if (entrySet.has(n.id)) continue;
    const dependents = idx.inDegree(n.id);
    if (dependents > 0) continue; // something imports it → used
    if (reachable.has(n.id)) continue; // reachable from an entry → used

    const reasons = ["no dependents"];
    if (n.exports.length === 0) reasons.push("no exports");
    if (idx.outDegree(n.id) === 0) reasons.push("no imports");
    reasons.push("unreachable from entry points");
    out.push({ id: n.id, path: n.path, reasons });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function reachableFrom(idx: DependencyIndex, roots: string[]): Set<string> {
  const seen = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nb of idx.out.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
  }
  return seen;
}
