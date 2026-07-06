import type { Graph } from "./types.js";

export interface Summary {
  files: number;
  edges: number;
  languages: Record<string, number>;
  functions: number;
  classes: number;
  totalLoc: number;
  /** Files most depended-upon by others (likely core modules). */
  hubs: { path: string; inDegree: number }[];
  /** Files importing the most others (likely orchestrators/entry points). */
  connectors: { path: string; outDegree: number }[];
  /** Files with no internal imports in or out (isolated). */
  orphans: string[];
  /** Top-level folders and their file counts. */
  folders: { folder: string; files: number }[];
  /** Import cycles detected between files (each a list of paths). */
  cycles: string[][];
  /** Most-used external packages. */
  externals: { name: string; count: number }[];
}

export function summarize(graph: Graph): Summary {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of graph.nodes) {
    inDeg.set(n.id, 0);
    outDeg.set(n.id, 0);
  }
  for (const e of graph.edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  const idToPath = new Map(graph.nodes.map((n) => [n.id, n.path]));
  const p = (id: string) => idToPath.get(id) ?? id;

  const hubs = [...inDeg.entries()]
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, d]) => ({ path: p(id), inDegree: d }));

  const connectors = [...outDeg.entries()]
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, d]) => ({ path: p(id), outDegree: d }));

  const orphans = graph.nodes
    .filter((n) => (inDeg.get(n.id) ?? 0) === 0 && (outDeg.get(n.id) ?? 0) === 0)
    .map((n) => n.path);

  const folderCounts = new Map<string, number>();
  for (const n of graph.nodes) {
    const top = n.dir === "" ? "(root)" : n.dir.split("/")[0];
    folderCounts.set(top, (folderCounts.get(top) ?? 0) + 1);
  }
  const folders = [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([folder, files]) => ({ folder, files }));

  const externalCounts = new Map<string, number>();
  for (const n of graph.nodes) {
    for (const imp of n.imports) {
      if (!imp.external) continue;
      externalCounts.set(imp.raw, (externalCounts.get(imp.raw) ?? 0) + 1);
    }
  }
  const externals = [...externalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const totalLoc = graph.nodes.reduce((s, n) => s + n.loc, 0);
  const cycles = findCycles(graph).map((c) => c.map(p));

  return {
    files: graph.stats.files,
    edges: graph.stats.edges,
    languages: graph.stats.languages,
    functions: graph.stats.functions,
    classes: graph.stats.classes,
    totalLoc,
    hubs,
    connectors,
    orphans,
    folders,
    cycles,
    externals,
  };
}

/** Tarjan's SCC to find groups of files that (transitively) import each other. */
function findCycles(graph: Graph): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) adj.get(e.source)?.push(e.target);

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  // Iterative Tarjan to avoid stack overflow on large graphs.
  for (const start of adj.keys()) {
    if (idx.has(start)) continue;
    const callStack: { node: string; i: number }[] = [{ node: start, i: 0 }];
    while (callStack.length) {
      const frame = callStack[callStack.length - 1];
      const { node } = frame;
      if (frame.i === 0) {
        idx.set(node, index);
        low.set(node, index);
        index++;
        stack.push(node);
        onStack.add(node);
      }
      const neighbors = adj.get(node)!;
      if (frame.i < neighbors.length) {
        const next = neighbors[frame.i];
        frame.i++;
        if (!idx.has(next)) {
          callStack.push({ node: next, i: 0 });
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node)!, idx.get(next)!));
        }
      } else {
        if (low.get(node) === idx.get(node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== node);
          if (comp.length > 1) sccs.push(comp);
        }
        callStack.pop();
        if (callStack.length) {
          const parent = callStack[callStack.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
        }
      }
    }
  }
  return sccs;
}
