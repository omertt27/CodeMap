import type { Graph, FileNode } from "../graph/types.js";

// A dependency index over the file-level graph: adjacency lists, degrees,
// reachability, and PageRank centrality. Shared by every analyzer feature so
// the graph is walked once and the math lives in one place.

export class DependencyIndex {
  readonly nodes: FileNode[];
  readonly byId = new Map<string, FileNode>();
  /** out[a] = files that `a` imports. */
  readonly out = new Map<string, string[]>();
  /** in[b] = files that import `b`. */
  readonly in = new Map<string, string[]>();

  constructor(graph: Graph) {
    this.nodes = graph.nodes;
    for (const n of graph.nodes) {
      this.byId.set(n.id, n);
      this.out.set(n.id, []);
      this.in.set(n.id, []);
    }
    for (const e of graph.edges) {
      if (!this.byId.has(e.source) || !this.byId.has(e.target)) continue;
      this.out.get(e.source)!.push(e.target);
      this.in.get(e.target)!.push(e.source);
    }
  }

  outDegree(id: string): number { return this.out.get(id)?.length ?? 0; }
  inDegree(id: string): number { return this.in.get(id)?.length ?? 0; }
  path(id: string): string { return this.byId.get(id)?.path ?? id; }

  /** BFS over out (imports) or in (dependents); returns reachable set + max depth. */
  reach(start: string, dir: "out" | "in"): { set: Set<string>; depth: number } {
    const adj = dir === "out" ? this.out : this.in;
    const set = new Set<string>();
    let frontier = [start];
    let depth = 0;
    const seen = new Set<string>([start]);
    while (frontier.length) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of adj.get(cur) ?? []) {
          if (!seen.has(nb)) { seen.add(nb); set.add(nb); next.push(nb); }
        }
      }
      if (next.length) depth++;
      frontier = next;
    }
    return { set, depth };
  }

  /**
   * PageRank over the import graph. An edge a→b (a imports b) sends rank to b,
   * so heavily depended-upon files score high — a good "centrality" proxy.
   */
  pageRank(damping = 0.85, iterations = 40): Map<string, number> {
    const ids = this.nodes.map((n) => n.id);
    const N = ids.length || 1;
    let pr = new Map(ids.map((id) => [id, 1 / N]));
    for (let it = 0; it < iterations; it++) {
      const next = new Map(ids.map((id) => [id, (1 - damping) / N]));
      let dangling = 0;
      for (const id of ids) if (this.outDegree(id) === 0) dangling += pr.get(id)!;
      for (const id of ids) {
        const outs = this.out.get(id)!;
        if (outs.length === 0) continue;
        const share = (damping * pr.get(id)!) / outs.length;
        for (const t of outs) next.set(t, next.get(t)! + share);
      }
      const spread = (damping * dangling) / N;
      for (const id of ids) next.set(id, next.get(id)! + spread);
      pr = next;
    }
    return pr;
  }
}
