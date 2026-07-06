import fs from "node:fs";
import path from "node:path";
import type { Graph } from "../graph/types.js";

// Storage lives under `.codemap/` in the scanned repo. This module is the only
// place that knows the on-disk format, so swapping JSON for SQLite later is a
// localized change.

export const CODEMAP_DIR = ".codemap";
export const GRAPH_FILE = "graph.json";

export function graphPath(root: string): string {
  return path.join(path.resolve(root), CODEMAP_DIR, GRAPH_FILE);
}

export function saveGraph(root: string, graph: Graph): string {
  const dir = path.join(path.resolve(root), CODEMAP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, GRAPH_FILE);
  fs.writeFileSync(file, JSON.stringify(graph, null, 2), "utf8");
  return file;
}

export function loadGraph(root: string): Graph | null {
  const file = graphPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Graph;
  } catch {
    return null;
  }
}
