import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Graph } from "../graph/types.js";
import { analyzeRepo } from "./index.js";
import type { Analysis } from "./types.js";

// Analysis (PageRank, cycles, hotspots, …) is deterministic in the graph's
// structure, so we cache the result keyed by a hash of the structural inputs.
// After a `scan`, subsequent `insights`/`summary`/`impact` on the same tree skip
// the recompute — the win that matters on very large graphs where PageRank and
// SCC detection dominate.

/** Hash only the inputs the analysis actually depends on. */
function graphHash(graph: Graph): string {
  const nodes = graph.nodes.map((n) => [n.id, n.loc, n.exports.length, n.functions.length, n.classes.length]);
  const edges = graph.edges.map((e) => [e.source, e.target]);
  return crypto.createHash("sha1").update(JSON.stringify({ nodes, edges })).digest("hex");
}

export function analyzeRepoCached(graph: Graph, root: string): Analysis {
  const file = path.join(path.resolve(root), ".codemap", "analysis-cache.json");
  const hash = graphHash(graph);
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c.hash === hash) return c.analysis as Analysis;
  } catch {
    /* cold cache */
  }
  const analysis = analyzeRepo(graph, root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ hash, analysis }));
  } catch {
    /* best-effort */
  }
  return analysis;
}
