import { summarize, type Summary } from "./summary.js";
import { deriveSymbols } from "./symbols.js";
import type { Graph, FileNode, Edge, GraphStats, SymbolGraph } from "./types.js";

// A query-oriented view over a graph. Consumers (server API, analysis, agents)
// depend on this interface, not on a raw in-memory `Graph`. That is the seam
// that lets a SQLite-backed store drop in later without touching any consumer.
//
// The interface is synchronous on purpose: the JSON store is in-memory and
// better-sqlite3 (the intended second backend) is also synchronous, so neither
// needs Promises.

export interface Subgraph {
  nodes: FileNode[];
  edges: Edge[];
}

export type Direction = "in" | "out" | "both";

export interface SubgraphOptions {
  /** Keep only files under this repo-relative folder prefix. */
  folder?: string;
  /** Keep only files whose total degree (in+out) is at least this. */
  minDegree?: number;
  /** Cap the number of nodes (highest-degree first). */
  limit?: number;
}

export interface GraphStore {
  /** Escape hatch for consumers that still want the whole graph (current UI). */
  raw(): Graph;
  stats(): GraphStats;
  files(): FileNode[];
  getFile(id: string): FileNode | undefined;
  search(query: string, limit?: number): FileNode[];
  neighbors(id: string, dir?: Direction, depth?: number): Subgraph;
  subgraph(opts?: SubgraphOptions): Subgraph;
  summary(): Summary;
  symbols(): SymbolGraph;
}

export class JsonGraphStore implements GraphStore {
  private byId = new Map<string, FileNode>();
  private outAdj = new Map<string, string[]>();
  private inAdj = new Map<string, string[]>();
  private degree = new Map<string, number>();

  constructor(private graph: Graph) {
    for (const n of graph.nodes) {
      this.byId.set(n.id, n);
      this.outAdj.set(n.id, []);
      this.inAdj.set(n.id, []);
      this.degree.set(n.id, 0);
    }
    for (const e of graph.edges) {
      this.outAdj.get(e.source)?.push(e.target);
      this.inAdj.get(e.target)?.push(e.source);
      this.degree.set(e.source, (this.degree.get(e.source) ?? 0) + 1);
      this.degree.set(e.target, (this.degree.get(e.target) ?? 0) + 1);
    }
  }

  raw(): Graph { return this.graph; }
  stats(): GraphStats { return this.graph.stats; }
  files(): FileNode[] { return this.graph.nodes; }
  getFile(id: string): FileNode | undefined { return this.byId.get(id); }

  search(query: string, limit = 50): FileNode[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: FileNode[] = [];
    for (const n of this.graph.nodes) {
      if (n.path.toLowerCase().includes(q)) {
        out.push(n);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  neighbors(id: string, dir: Direction = "both", depth = 1): Subgraph {
    if (!this.byId.has(id)) return { nodes: [], edges: [] };
    const visited = new Set<string>([id]);
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        const outs = dir === "in" ? [] : this.outAdj.get(cur) ?? [];
        const ins = dir === "out" ? [] : this.inAdj.get(cur) ?? [];
        for (const nb of [...outs, ...ins]) {
          if (!visited.has(nb)) { visited.add(nb); next.push(nb); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return this.materialize(visited);
  }

  subgraph(opts: SubgraphOptions = {}): Subgraph {
    let nodes = this.graph.nodes;
    if (opts.folder) {
      const prefix = opts.folder.replace(/\/$/, "");
      nodes = nodes.filter((n) => n.path === prefix || n.path.startsWith(prefix + "/"));
    }
    if (opts.minDegree != null) {
      nodes = nodes.filter((n) => (this.degree.get(n.id) ?? 0) >= opts.minDegree!);
    }
    if (opts.limit != null) {
      nodes = [...nodes]
        .sort((a, b) => (this.degree.get(b.id) ?? 0) - (this.degree.get(a.id) ?? 0))
        .slice(0, opts.limit);
    }
    return this.materialize(new Set(nodes.map((n) => n.id)));
  }

  summary(): Summary { return summarize(this.graph); }
  symbols(): SymbolGraph { return deriveSymbols(this.graph); }

  /** Build a subgraph containing the given node ids and every edge between them. */
  private materialize(ids: Set<string>): Subgraph {
    const nodes = [...ids].map((id) => this.byId.get(id)).filter((n): n is FileNode => !!n);
    const edges = this.graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }
}
