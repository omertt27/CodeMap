import type { MapGraph, MapNode } from "./types.js";
import type { Filters } from "../state/store.js";

// Read-only index over the map graph: fast lookups, degree stats, directory
// list, and the filter predicate. Pure data + queries — no rendering, no DOM.

export class GraphModel {
  readonly nodes: MapNode[];
  readonly languages: string[];
  readonly maxDegree: number;
  readonly directories: string[];
  private byId = new Map<string, MapNode>();

  constructor(private graph: MapGraph) {
    this.nodes = graph.nodes;
    this.languages = graph.languages;
    for (const n of graph.nodes) this.byId.set(n.id, n);
    this.maxDegree = graph.nodes.reduce((m, n) => Math.max(m, n.degree), 0);
    this.directories = [...new Set(graph.nodes.filter((n) => n.type === "Directory").map((n) => n.path))].sort();
  }

  get edges() {
    return this.graph.edges;
  }

  get root(): string {
    return this.graph.root;
  }

  node(id: string): MapNode | undefined {
    return this.byId.get(id);
  }

  /** Files/nodes whose path matches a query (case-insensitive substring). */
  search(query: string, limit = 30): MapNode[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: MapNode[] = [];
    for (const n of this.nodes) {
      if (n.path.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)) {
        out.push(n);
        if (out.length >= limit) break;
      }
    }
    return out.sort((a, b) => a.path.length - b.path.length);
  }

  /** Whether a node passes the current filters. Used by the renderer's reducer. */
  passes(node: MapNode, f: Filters): boolean {
    if (!f.types.has(node.type)) return false;
    if (f.languages && node.language && !f.languages.has(node.language)) return false;
    if (f.languages && !node.language && node.type !== "Directory") return false;
    if (f.directory && !(node.path === f.directory || node.path.startsWith(f.directory + "/"))) return false;
    if (node.degree < f.minDegree) return false;
    return true;
  }
}
