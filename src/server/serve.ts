import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { Graph } from "../graph/types.js";
import { JsonGraphStore, type Direction, type GraphStore } from "../graph/store.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/serve.js -> repo root -> ui/
const UI_DIR = path.join(here, "..", "..", "ui");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export interface ServeOptions {
  port: number;
  open?: boolean;
}

export function serve(graph: Graph, opts: ServeOptions): Promise<string> {
  const store: GraphStore = new JsonGraphStore(graph);
  // The current UI still consumes whole-graph blobs; these are precomputed once.
  const graphJson = JSON.stringify(store.raw());
  const summaryJson = JSON.stringify(store.summary());
  const symbolsJson = JSON.stringify(store.symbols());
  const cytoscapePath = require.resolve("cytoscape/dist/cytoscape.min.js");
  // 3d-force-graph's "exports" map blocks subpath/package.json resolution, so
  // locate the UMD bundle next to its resolved main entry (both live in dist/).
  const forceGraph3dPath = path.join(
    path.dirname(require.resolve("3d-force-graph")),
    "3d-force-graph.min.js",
  );

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? "/", "http://localhost");
    const url = parsed.pathname;
    try {
      if (url === "/" || url === "/index.html") return sendFile(res, path.join(UI_DIR, "index.html"));
      if (url === "/app.js") return sendFile(res, path.join(UI_DIR, "app.js"));
      if (url === "/style.css") return sendFile(res, path.join(UI_DIR, "style.css"));
      if (url === "/vendor/cytoscape.min.js") return sendFile(res, cytoscapePath);
      if (url === "/vendor/3d-force-graph.min.js") return sendFile(res, forceGraph3dPath);
      if (url === "/graph.json") return sendJson(res, graphJson);
      if (url === "/summary.json") return sendJson(res, summaryJson);
      if (url === "/symbols.json") return sendJson(res, symbolsJson);
      // Query-oriented API (backed by GraphStore) for windowed clients / agents.
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

/** Query-oriented API over the GraphStore. All routes return JSON. */
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

function sendFile(res: http.ServerResponse, file: string): void {
  const body = fs.readFileSync(file);
  const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type }).end(body);
}

function sendJson(res: http.ServerResponse, json: string): void {
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[".json"] }).end(json);
}

function openBrowser(uri: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ spawn }) => {
    try {
      spawn(cmd, [uri], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    } catch {
      /* best effort */
    }
  });
}
