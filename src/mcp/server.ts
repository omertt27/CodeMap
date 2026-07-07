import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Workspace } from "./workspace.js";
import { nodeMetrics } from "../analysis/index.js";
import { computeImpact, resolveTarget } from "../impact/index.js";
import { diffRevisions } from "../git/index.js";
import type { Direction } from "../graph/store.js";

// A local, stdio MCP server that exposes CodeMap's deterministic analysis as
// tools an AI agent can call. No LLM calls happen here — the server returns
// facts derived from the graph, so the agent reasons over reliable data.

export async function runMcpServer(root: string): Promise<void> {
  const ws = new Workspace(root);
  const server = new McpServer({ name: "codemap", version: "0.1.0" });

  const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  const targetId = async (path: string) => {
    const b = await ws.ensure();
    return { b, id: resolveTarget(b.index, path) };
  };

  server.registerTool("scan_repo", {
    title: "Scan repository",
    description: "Parse the repository and return counts + an architecture summary (files, languages, cycles, hotspots, unused, layer violations, most central module). Re-scans from disk.",
    inputSchema: {},
  }, async () => {
    const b = await ws.rescan();
    return json({ root: ws.root, stats: b.codeGraph.stats, summary: b.analysis.summary });
  });

  server.registerTool("search_files", {
    title: "Search files",
    description: "Find source files whose path matches a query (case-insensitive substring).",
    inputSchema: { query: z.string().describe("path substring, e.g. 'auth'"), limit: z.number().int().optional() },
  }, async ({ query, limit }) => {
    const b = await ws.ensure();
    return json(b.store.search(query, limit ?? 20).map((n) => ({ id: n.id, path: n.path, lang: n.lang, loc: n.loc })));
  });

  server.registerTool("get_file", {
    title: "Get file detail",
    description: "Full parser record for a file: language, LOC, imports (internal + external), exports, functions, classes, plus dependency metrics (degrees, transitive counts, depth, centrality, hotspot score).",
    inputSchema: { path: z.string().describe("repo-relative or absolute file path") },
  }, async ({ path }) => {
    const { b, id } = await targetId(path);
    const file = id ? b.store.getFile(id) : undefined;
    if (!file) return text(`No file matching "${path}".`);
    const light = b.analysis.metrics[file.id];
    return json({ file, metrics: nodeMetrics(b.index, file.id, { centrality: light?.centrality, hotspotScore: light?.hotspotScore }) });
  });

  server.registerTool("get_dependencies", {
    title: "Get dependency neighborhood",
    description: "The dependency neighborhood of a file: importers and/or imports up to a hop depth. Returns nodes + edges.",
    inputSchema: {
      path: z.string(),
      direction: z.enum(["in", "out", "both"]).optional().describe("in = dependents, out = imports"),
      depth: z.number().int().min(1).max(6).optional(),
    },
  }, async ({ path, direction, depth }) => {
    const { b, id } = await targetId(path);
    if (!id) return text(`No file matching "${path}".`);
    return json(b.store.neighbors(id, (direction ?? "both") as Direction, depth ?? 1));
  });

  server.registerTool("get_subgraph", {
    title: "Get a windowed subgraph",
    description: "A subgraph filtered by folder prefix, minimum dependency degree, and/or a node cap (highest-degree first).",
    inputSchema: {
      folder: z.string().optional(),
      minDegree: z.number().int().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ folder, minDegree, limit }) => {
    const b = await ws.ensure();
    return json(b.store.subgraph({ folder, minDegree, limit }));
  });

  server.registerTool("architecture_insights", {
    title: "Architecture insights",
    description: "Deterministic architecture analysis: circular dependencies, hotspots (0-100 with reasons), possible God modules, possibly-unused files, layer violations, and per-file metrics.",
    inputSchema: {},
  }, async () => json((await ws.ensure()).analysis));

  server.registerTool("impact_analysis", {
    title: "Impact analysis (blast radius)",
    description: "What breaks if a file changes: blast-radius score (0-100), affected files by hop distance with reasons, likely affected tests, affected entry points, and cycle participation.",
    inputSchema: { path: z.string() },
  }, async ({ path }) => {
    const { b, id } = await targetId(path);
    const report = id ? computeImpact(b.index, id, b.impactCtx) : null;
    return report ? json(report) : text(`No file matching "${path}".`);
  });

  server.registerTool("git_history", {
    title: "Git evolution",
    description: "Repository evolution from git history: code churn per file, stability scores, and evolution insights (most changed / fastest growing / most stable / newest / most volatile / coupling trends).",
    inputSchema: {},
  }, async () => {
    if (!ws.isGit()) return text("Not a git repository.");
    const h = await ws.getHistory();
    return json({ commits: h.commits.length, branches: h.branches, tags: h.tags, evolution: h.evolution, churn: h.churn.slice(0, 30), stability: h.stability.slice(0, 30) });
  });

  server.registerTool("git_diff", {
    title: "Architecture diff between revisions",
    description: "Compare two git revisions (commits, tags, or branches): added/removed/moved files, added/removed dependencies, new/resolved cycles, and hotspot/coupling shifts.",
    inputSchema: { a: z.string().describe("base revision"), b: z.string().describe("target revision") },
  }, async ({ a, b }) => {
    if (!ws.isGit()) return text("Not a git repository.");
    const diff = await diffRevisions(ws.root, a, b);
    return diff ? json(diff) : text(`Could not resolve "${a}" / "${b}".`);
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write(`codemap MCP server ready for ${ws.root}\n`);
}
