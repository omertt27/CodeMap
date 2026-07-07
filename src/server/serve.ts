import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Graph } from "../graph/types.js";
import type { CodeGraph } from "../graph/model.js";
import { toMapGraph } from "../graph/mapView.js";
import { JsonGraphStore, type Direction, type GraphStore } from "../graph/store.js";
import { DependencyIndex, nodeMetrics, type Analysis } from "../analysis/index.js";
import { buildImpactContext, computeImpact, resolveTarget, type ImpactContext } from "../impact/index.js";
import { diffRevisions, snapshotMapGraph, timeline, type HistoryReport } from "../git/index.js";
import { detectWorkspaces, packageRollup } from "../scanner/workspaces.js";
import { runGovernance } from "../governance/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/serve.js -> repo root
const ROOT = path.join(here, "..", "..");
const UI_DIR = path.join(ROOT, "ui");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ServeData {
  /** Generic graph → the interactive map (compact map view is served). */
  codeGraph: CodeGraph;
  /** File-level graph → sidebar detail + query API. */
  fileGraph: Graph;
  /** Deterministic architecture analysis → Insights panel + per-node metrics. */
  analysis: Analysis;
  /** Repository root (for on-demand git snapshots/diffs). */
  root: string;
  /** Precomputed git history report, or null if not a git repo. */
  history: HistoryReport | null;
}

export interface ServeOptions {
  port: number;
  open?: boolean;
}

export function serve(data: ServeData, opts: ServeOptions): Promise<string> {
  const store: GraphStore = new JsonGraphStore(data.fileGraph);
  const index = new DependencyIndex(data.fileGraph);
  const impactCtx: ImpactContext = buildImpactContext(index);
  const mapJson = JSON.stringify(toMapGraph(data.codeGraph));
  const insightsJson = JSON.stringify(data.analysis);
  const historyJson = JSON.stringify(data.history ?? { isRepo: false });
  const packageDirs = detectWorkspaces(data.root);
  const packagesJson = JSON.stringify({ packageDirs, packages: packageRollup(data.fileGraph, packageDirs) });
  const governanceJson = JSON.stringify(runGovernance(data.fileGraph, data.root, { analysis: data.analysis, save: false }));
  // SSE clients for the agent→map highlight bridge (shared workspace).
  const sseClients = new Set<http.ServerResponse>();
  const snapshotCache = new Map<string, string>();
  const diffCache = new Map<string, string>();

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const url = parsed.pathname;
    try {
      if (url === "/" || url === "/index.html") return sendFile(res, path.join(UI_DIR, "index.html"));
      if (url === "/app.js") return sendFile(res, path.join(UI_DIR, "dist", "app.js"));
      if (url === "/style.css") return sendFile(res, path.join(UI_DIR, "style.css"));
      if (url === "/favicon.ico") {
        // Inline diamond glyph so browsers don't log a 404 for the favicon.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text y="13" font-size="13">◈</text></svg>';
        return void res.writeHead(200, { "Content-Type": "image/svg+xml" }).end(svg);
      }
      if (url === "/api/events") return handleSSE(res, sseClients);
      if (url === "/api/highlight" && req.method === "POST") return void handleHighlight(req, res, sseClients);
      if (url === "/graph.json") return sendJson(res, mapJson);
      if (url === "/api/insights") return sendJson(res, insightsJson);
      if (url === "/api/governance") return sendJson(res, governanceJson);
      if (url === "/api/metrics") return handleMetrics(res, parsed.searchParams, index, data.analysis);
      if (url === "/api/impact") return handleImpact(res, parsed.searchParams, index, impactCtx);
      if (url === "/api/packages") return sendJson(res, packagesJson);
      if (url === "/api/history") return sendJson(res, historyJson);
      if (url === "/api/timeline") return sendJson(res, JSON.stringify(data.history?.isRepo ? timeline(data.root, 30) : []));
      if (url === "/api/snapshot") return void handleSnapshot(res, parsed.searchParams, data.root, snapshotCache);
      if (url === "/api/diff") return void handleDiff(res, parsed.searchParams, data.root, diffCache);
      if (url.startsWith("/api/")) return handleApi(res, url, parsed.searchParams, store);
    } catch {
      res.writeHead(500).end("Internal error");
      return;
    }
    res.writeHead(404).end("Not found");
  });

  return new Promise((resolve) => {
    server.listen(opts.port, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      const uri = `http://127.0.0.1:${port}`;
      if (opts.open) openBrowser(uri);
      resolve(uri);
    });
  });
}

/** Query-oriented API over the file graph. Powers lazy sidebar detail + agents. */
function handleApi(res: http.ServerResponse, url: string, q: URLSearchParams, store: GraphStore): void {
  const num = (v: string | null, d: number) => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);
  switch (url) {
    case "/api/stats":
      return sendJson(res, JSON.stringify(store.stats()));
    case "/api/summary":
      return sendJson(res, JSON.stringify(store.summary()));
    case "/api/search":
      return sendJson(res, JSON.stringify(store.search(q.get("q") ?? "", num(q.get("limit"), 50))));
    case "/api/file": {
      const file = store.getFile(q.get("id") ?? "");
      if (!file) return void res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
      return sendJson(res, JSON.stringify(file));
    }
    case "/api/neighbors": {
      const dir = (q.get("dir") ?? "both") as Direction;
      return sendJson(res, JSON.stringify(store.neighbors(q.get("id") ?? "", dir, num(q.get("depth"), 1))));
    }
    case "/api/subgraph":
      return sendJson(res, JSON.stringify(store.subgraph({
        folder: q.get("folder") ?? undefined,
        minDegree: q.get("minDegree") != null ? num(q.get("minDegree"), 0) : undefined,
        limit: q.get("limit") != null ? num(q.get("limit"), 0) : undefined,
      })));
    default:
      return void res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"unknown endpoint"}');
  }
}

/** Per-node dependency metrics (transitive counts computed on demand). */
function handleMetrics(res: http.ServerResponse, q: URLSearchParams, index: DependencyIndex, analysis: Analysis): void {
  const id = q.get("id") ?? "";
  const light = analysis.metrics[id];
  const metrics = nodeMetrics(index, id, { centrality: light?.centrality, hotspotScore: light?.hotspotScore });
  if (!metrics) return void res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
  return sendJson(res, JSON.stringify(metrics));
}

/** Blast-radius impact for a target file (computed on demand). */
function handleImpact(res: http.ServerResponse, q: URLSearchParams, index: DependencyIndex, ctx: ImpactContext): void {
  const id = resolveTarget(index, q.get("id") ?? "");
  const report = id ? computeImpact(index, id, ctx) : null;
  if (!report) return void res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
  return sendJson(res, JSON.stringify(report));
}

/** Map graph at a revision (cached per revision). */
async function handleSnapshot(res: http.ServerResponse, q: URLSearchParams, root: string, cache: Map<string, string>): Promise<void> {
  const rev = q.get("rev") ?? "";
  try {
    let json = cache.get(rev);
    if (!json) {
      json = JSON.stringify(await snapshotMapGraph(root, rev));
      cache.set(rev, json);
    }
    sendJson(res, json);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"cannot build snapshot"}');
  }
}

/** Architecture diff between two revisions (cached per pair). */
async function handleDiff(res: http.ServerResponse, q: URLSearchParams, root: string, cache: Map<string, string>): Promise<void> {
  const a = q.get("a") ?? "";
  const b = q.get("b") ?? "";
  const key = `${a}..${b}`;
  try {
    let json = cache.get(key);
    if (!json) {
      const diff = await diffRevisions(root, a, b);
      if (!diff) return void res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"cannot diff"}');
      json = JSON.stringify(diff);
      cache.set(key, json);
    }
    sendJson(res, json);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" }).end('{"error":"diff failed"}');
  }
}

/** Server-Sent Events stream the UI subscribes to for agent-driven highlights. */
function handleSSE(res: http.ServerResponse, clients: Set<http.ServerResponse>): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":ok\n\n");
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

/** An MCP tool (or anything) POSTs a highlight command here; broadcast to all UIs. */
function handleHighlight(req: http.IncomingMessage, res: http.ServerResponse, clients: Set<http.ServerResponse>): void {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1 << 20) req.destroy(); });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body || "{}");
      const frame = `data: ${JSON.stringify(payload)}\n\n`;
      for (const c of clients) c.write(frame);
      res.writeHead(204).end();
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"bad payload"}');
    }
  });
}

function sendFile(res: http.ServerResponse, file: string): void {
  const body = fs.readFileSync(file);
  const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type }).end(body);
}

function sendJson(res: http.ServerResponse, json: string): void {
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[".json"] }).end(json);
}

function openBrowser(uri: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ spawn }) => {
    try {
      spawn(cmd, [uri], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    } catch {
      /* best effort */
    }
  });
}
