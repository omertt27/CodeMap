import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Workspace } from "./workspace.js";
import { nodeMetrics } from "../analysis/index.js";
import { shortestPath } from "../analysis/paths.js";
import { computeImpact, resolveTarget } from "../impact/index.js";
import { searchSymbols } from "./symbols.js";
import { buildContext } from "./contextBuilder.js";
import { findApiRoutes, findConfiguration, findDatabaseModels, findEntryPoints, findTests } from "./navigation.js";
import { diffRevisions, fileCommits } from "../git/index.js";

// The Architecture Intelligence Server. Read-only by design: tools only retrieve
// structured facts from the parsed graph and git metadata — they never execute
// code, write files, or read arbitrary paths. The agent's LLM does the reasoning;
// this server is its navigation layer. Results are structured JSON, never prose.

export async function runMcpServer(root: string): Promise<void> {
  const ws = new Workspace(root);
  const server = new McpServer({ name: "codemap", version: "0.1.0" });
  const highlight = makeHighlighter();

  const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  const idOf = async (target: string) => {
    const b = await ws.ensure();
    return { b, id: resolveTarget(b.index, target) };
  };

  // ---- Repository -------------------------------------------------------

  server.registerTool("get_repository_summary", {
    title: "Repository summary",
    description: "Languages, project size, architecture overview, dependency statistics, and entry points. The agent's starting point for any repo.",
    inputSchema: {},
  }, async () => {
    const b = await ws.ensure();
    const s = b.analysis.summary;
    const degrees = b.fileGraph.nodes.map((n) => b.index.inDegree(n.id) + b.index.outDegree(n.id));
    return json({
      root: ws.root,
      languages: b.codeGraph.stats.languages,
      size: { files: s.files, dependencies: s.edges, classes: b.codeGraph.stats.classes, functions: b.codeGraph.stats.functions, loc: b.fileGraph.nodes.reduce((a, n) => a + n.loc, 0) },
      architecture: { cycles: s.cycles, hotspots: s.hotspots, godModules: s.godModules, unused: s.unused, layerViolations: s.layerViolations, mostCentral: s.mostCentral },
      dependencyStats: { edges: s.edges, avgDegree: degrees.length ? +(degrees.reduce((a, d) => a + d, 0) / degrees.length).toFixed(2) : 0, maxDegree: Math.max(0, ...degrees) },
      entryPoints: findEntryPoints(b.fileGraph.nodes).slice(0, 20),
    });
  });

  server.registerTool("scan_repo", {
    title: "Re-scan repository",
    description: "Re-parse the repository from disk and invalidate the session cache. Call after the agent has edited files.",
    inputSchema: {},
  }, async () => {
    const b = await ws.rescan();
    return json({ root: ws.root, stats: b.codeGraph.stats });
  });

  // ---- Search -----------------------------------------------------------

  server.registerTool("search_symbol", {
    title: "Search symbols",
    description: "Find classes/functions/methods/interfaces/enums/variables by name. Returns each symbol's file, type, line, and the files that reference its module.",
    inputSchema: { name: z.string() },
  }, async ({ name }) => {
    const b = await ws.ensure();
    const hits = ws.cached(`sym:${name}`, () => searchSymbols(b.codeGraph, b.index, name));
    highlight({ type: "nodes", ids: [...new Set(hits.map((h) => h.path))], label: `symbol: ${name}` });
    return json(hits);
  });

  server.registerTool("search_file", {
    title: "File metadata",
    description: "Full parser record for a file: language, LOC, imports, exports, functions, classes, plus dependency metrics.",
    inputSchema: { path: z.string() },
  }, async ({ path }) => {
    const { b, id } = await idOf(path);
    const file = id ? b.store.getFile(id) : undefined;
    if (!file) return text(`No file matching "${path}".`);
    const m = b.analysis.metrics[file.id];
    return json({ file, metrics: nodeMetrics(b.index, file.id, { centrality: m?.centrality, hotspotScore: m?.hotspotScore }) });
  });

  server.registerTool("search_imports", {
    title: "Imports / exports / dependents",
    description: "A file's imports, exports, resolved dependencies, and dependents (who imports it).",
    inputSchema: { file: z.string() },
  }, async ({ file }) => {
    const { b, id } = await idOf(file);
    const node = id ? b.store.getFile(id) : undefined;
    if (!node || !id) return text(`No file matching "${file}".`);
    return json({
      file: node.path,
      imports: node.imports,
      exports: node.exports,
      dependencies: (b.index.out.get(id) ?? []).map((t) => b.index.path(t)),
      dependents: (b.index.in.get(id) ?? []).map((s) => b.index.path(s)),
    });
  });

  // ---- Architecture -----------------------------------------------------

  server.registerTool("get_hotspots", {
    title: "Architectural hotspots",
    description: "Files concentrating risk, scored 0-100, with dependency count and centrality and the reasons for the score.",
    inputSchema: {},
  }, async () => json((await ws.ensure()).analysis.hotspots));

  server.registerTool("get_cycles", {
    title: "Circular dependencies",
    description: "Strongly-connected dependency cycles with severity and a suggested edge to cut.",
    inputSchema: {},
  }, async () => {
    const b = await ws.ensure();
    highlight({ type: "cycle", files: b.analysis.cycles.flatMap((c) => c.files) });
    return json(b.analysis.cycles);
  });

  server.registerTool("get_layer_violations", {
    title: "Layer violations",
    description: "Imports that break the architecture layer rules in repo-map.config.json.",
    inputSchema: {},
  }, async () => json((await ws.ensure()).analysis.layerViolations));

  // ---- Impact -----------------------------------------------------------

  server.registerTool("impact_analysis", {
    title: "Impact analysis (blast radius)",
    description: "What breaks if a file changes: blast-radius score 0-100, affected files by hop, likely affected tests, affected entry points, cycle participation.",
    inputSchema: { target: z.string() },
  }, async ({ target }) => {
    const { b, id } = await idOf(target);
    const report = id ? ws.cached(`impact:${id}`, () => computeImpact(b.index, id, b.impactCtx)) : null;
    if (!report) return text(`No file matching "${target}".`);
    highlight({ type: "blast", target: report.target });
    return json(report);
  });

  server.registerTool("dependency_path", {
    title: "Shortest dependency path",
    description: "The shortest import chain from source to target (source → … → target), or null if source does not depend on target.",
    inputSchema: { source: z.string(), target: z.string() },
  }, async ({ source, target }) => {
    const b = await ws.ensure();
    const from = resolveTarget(b.index, source);
    const to = resolveTarget(b.index, target);
    if (!from || !to) return text("Could not resolve source and/or target.");
    const path = ws.cached(`path:${from}:${to}`, () => shortestPath(b.index, from, to));
    if (path) highlight({ type: "nodes", ids: path, label: "dependency path" });
    return json({ source: b.index.path(from), target: b.index.path(to), path });
  });

  // ---- Git --------------------------------------------------------------

  server.registerTool("history", {
    title: "File git history",
    description: "Commits, authors, churn, and stability score for a file.",
    inputSchema: { file: z.string() },
  }, async ({ file }) => {
    if (!ws.isGit()) return text("Not a git repository.");
    const { b, id } = await idOf(file);
    if (!id) return text(`No file matching "${file}".`);
    const path = b.index.path(id);
    const report = await ws.getHistory();
    const commits = fileCommits(ws.root, path);
    return json({
      file: path,
      commits,
      authors: [...new Set(commits.map((c) => c.author))],
      churn: report.churn.find((c) => c.path === path) ?? null,
      stability: report.stability.find((s) => s.path === path)?.stability ?? null,
    });
  });

  server.registerTool("compare", {
    title: "Compare revisions",
    description: "Architecture diff between two git revisions: added/removed/moved files, dependency and cycle changes, hotspot & coupling shifts.",
    inputSchema: { commitA: z.string(), commitB: z.string() },
  }, async ({ commitA, commitB }) => {
    if (!ws.isGit()) return text("Not a git repository.");
    const diff = await diffRevisions(ws.root, commitA, commitB);
    return diff ? json(diff) : text(`Could not resolve "${commitA}" / "${commitB}".`);
  });

  // ---- Navigation -------------------------------------------------------

  const nav = (name: string, title: string, desc: string, fn: (b: Awaited<ReturnType<Workspace["ensure"]>>) => unknown) =>
    server.registerTool(name, { title, description: desc, inputSchema: {} }, async () => {
      const b = await ws.ensure();
      const result = ws.cached(`nav:${name}`, () => fn(b)) as { path: string }[];
      highlight({ type: "nodes", ids: result.map((r) => r.path), label: name });
      return json(result);
    });

  nav("find_entry_points", "Find entry points", "main/index/cli/app/server files, API routes, and page/route directories.", (b) => findEntryPoints(b.fileGraph.nodes));
  nav("find_api_routes", "Find API routes", "Files under api/routes/controllers/handlers or named *.route/*.controller.", (b) => findApiRoutes(b.fileGraph.nodes));
  nav("find_database_models", "Find database models", "Files under models/entities/schema/repositories or named *.model/*.entity/*.schema.", (b) => findDatabaseModels(b.fileGraph.nodes));
  nav("find_configuration", "Find configuration", "Config/settings files and directories.", (b) => findConfiguration(b.fileGraph.nodes));
  nav("find_tests", "Find tests", "Test files by naming/path convention.", (b) => findTests(b.fileGraph.nodes));
  nav("find_unused", "Find possibly-unused files", "Files with no dependents, unreachable from entry points (conservative).", (b) => b.analysis.unused);
  nav("find_dead_code", "Find isolated files", "Files with no imports and no dependents (fully isolated islands).", (b) =>
    b.fileGraph.nodes.filter((n) => b.index.inDegree(n.id) === 0 && b.index.outDegree(n.id) === 0).map((n) => ({ path: n.path, lang: n.lang })));

  // ---- Context builder --------------------------------------------------

  server.registerTool("build_context", {
    title: "Build change context",
    description: "Given a change request (e.g. \"modify authentication\"), return only the relevant slice of the architecture: related files, their dependency neighbourhood, affected modules, an architecture summary, hotspots, and git history. Token-optimised — use this instead of grepping.",
    inputSchema: { query: z.string(), maxFiles: z.number().int().min(1).max(40).optional() },
  }, async ({ query, maxFiles }) => {
    const b = await ws.ensure();
    let churn, stability;
    if (ws.isGit()) {
      const h = await ws.getHistory();
      churn = new Map(h.churn.map((c) => [c.path, c]));
      stability = new Map(h.stability.map((s) => [s.path, s]));
    }
    const ctx = buildContext(b, query, { maxFiles, churn, stability });
    highlight({ type: "nodes", ids: ctx.relatedFiles.map((f) => f.path), label: query });
    return json(ctx);
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write(`codemap MCP server (architecture intelligence) ready for ${ws.root}\n`);
}

/** Optionally push a highlight to a running `codemap serve` (shared human/agent workspace). */
function makeHighlighter(): (payload: unknown) => void {
  const url = process.env.CODEMAP_SERVE_URL;
  if (!url) return () => {};
  return (payload) => {
    fetch(`${url}/api/highlight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
  };
}
