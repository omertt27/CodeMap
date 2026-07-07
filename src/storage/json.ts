import fs from "node:fs";
import path from "node:path";
import type { CodeGraph } from "../graph/model.js";

// Persists the generic code graph to `.codemap/graph.json`. This is the only
// module that knows the on-disk format, so a different backend later is a
// localized change. (The legacy file-graph used by the UI is built in memory.)

export const CODEMAP_DIR = ".codemap";
export const GRAPH_FILE = "graph.json";

export function graphPath(root: string): string {
  return path.join(path.resolve(root), CODEMAP_DIR, GRAPH_FILE);
}

export function saveCodeGraph(root: string, graph: CodeGraph): string {
  const dir = path.join(path.resolve(root), CODEMAP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, GRAPH_FILE);
  fs.writeFileSync(file, JSON.stringify(graph, null, 2), "utf8");
  return file;
}

export function loadCodeGraph(root: string): CodeGraph | null {
  const file = graphPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as CodeGraph;
  } catch {
    return null;
  }
}
