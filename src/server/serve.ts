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
  const snapshotCache = new Map<string, string>();
  const diffCache = new Map<string, string>();

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const url = parsed.pathname;
    try {
      if (url === "/" || url === "/index.html") return sendFile(res, path.join(UI_DIR, "index.html"));
      if (url === "/app.js") return sendFile(res, path.join(UI_DIR, "dist", "app.js"));
      if (url === "/style.css") return sendFile(res, path.join(UI_DIR, "style.css"));
      if (url === "/graph.json") return sendJson(res, mapJson);
      if (url === "/api/insights") return sendJson(res, insightsJson);
      if (url === "/api/metrics") return handleMetrics(res, parsed.searchParams, index, data.analysis);
      if (url === "/api/impact") return handleImpact(res, parsed.searchParams, index, impactCtx);
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
