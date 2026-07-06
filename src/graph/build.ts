import path from "node:path";
import { walk } from "../scanner/walk.js";
import { scanFile } from "../scanner/parse.js";
import { initLanguages } from "../languages/registry.js";
import { loadConfig } from "../config.js";
import type { Edge, FileNode, Graph, GraphStats } from "./types.js";

export interface BuildOptions {
  onProgress?: (done: number, total: number, file: string) => void;
  /** Called when a file fails to parse, instead of failing the whole scan. */
  onError?: (file: string, err: unknown) => void;
}

/** Scan `root` and produce a full dependency graph. */
export async function buildGraph(root: string, opts: BuildOptions = {}): Promise<Graph> {
  const absRoot = path.resolve(root);
  await initLanguages();

  const config = loadConfig(absRoot);
  const files = walk(absRoot, { exclude: config.exclude, languages: config.languages });
  const fileSet = new Set(files.map((f) => f.rel));
  const nodes: FileNode[] = [];

  let done = 0;
  for (const f of files) {
    try {
      nodes.push(scanFile(f.abs, f.rel, fileSet));
    } catch (err) {
      opts.onError?.(f.rel, err);
      // Keep the file in the graph as an empty node so it still appears.
      nodes.push({
        id: `file:${f.rel}`, path: f.rel, name: path.posix.basename(f.rel),
        dir: path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel),
        lang: f.lang, loc: 0, imports: [], exports: [], functions: [], classes: [],
      });
    }
    done++;
    opts.onProgress?.(done, files.length, f.rel);
  }

  const edges = buildEdges(nodes);
  const stats = computeStats(nodes, edges);

  return {
    version: 1,
    root: absRoot,
    generatedAt: new Date().toISOString(),
    stats,
    nodes,
    edges,
  };
}

function buildEdges(nodes: FileNode[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const imp of node.imports) {
      if (!imp.resolved) continue;
      const targetId = `file:${imp.resolved}`;
      if (targetId === node.id) continue; // ignore self-imports
      const key = `${node.id}->${targetId}`;
      if (seen.has(key)) continue; // one edge per file pair
      seen.add(key);
      edges.push({
        id: key,
        source: node.id,
        target: targetId,
        type: "import",
        raw: imp.raw,
      });
    }
  }
  return edges;
}

function computeStats(nodes: FileNode[], edges: Edge[]): GraphStats {
  const languages: Record<string, number> = {};
  let functions = 0;
  let classes = 0;
  for (const n of nodes) {
    languages[n.lang] = (languages[n.lang] ?? 0) + 1;
    functions += n.functions.length;
    classes += n.classes.length;
  }
  return { files: nodes.length, edges: edges.length, languages, functions, classes };
}
