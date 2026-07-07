import type { DependencyIndex } from "./graph.js";

// Shortest dependency path between two files: does A (transitively) depend on B,
// and through which chain? BFS over import edges. Returns the chain of repo paths
// (source → … → target), or null if unreachable.

export function shortestPath(idx: DependencyIndex, fromId: string, toId: string): string[] | null {
  if (!idx.byId.has(fromId) || !idx.byId.has(toId)) return null;
  if (fromId === toId) return [idx.path(fromId)];

  const parent = new Map<string, string>();
  const seen = new Set<string>([fromId]);
  const queue: string[] = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of idx.out.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      parent.set(nb, cur);
      if (nb === toId) {
        const chain: string[] = [];
        let n: string | undefined = toId;
        while (n) { chain.unshift(idx.path(n)); n = parent.get(n); }
        return chain;
      }
      queue.push(nb);
    }
  }
  return null;
}
