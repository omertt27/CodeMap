import { DatabaseSync } from "node:sqlite";
import { summarize, type Summary } from "./summary.js";
import { deriveSymbols } from "./symbols.js";
import type { Graph, FileNode, GraphStats, SymbolGraph } from "./types.js";
import type { GraphStore, Subgraph, Direction, SubgraphOptions } from "./store.js";

// A SQLite-backed GraphStore (via the built-in `node:sqlite`). Implements the
// exact same interface as JsonGraphStore, so it drops in unchanged — proving the
// storage seam works with a real database backend. Queries (search, neighbours,
// subgraph) run as SQL, including a recursive CTE for the dependency BFS, so the
// whole graph need not live in memory for a windowed query.

type Row = Record<string, string | number | null>;

export class SqliteGraphStore implements GraphStore {
  private db: DatabaseSync;

  constructor(graph: Graph, dbPath = ":memory:") {
    this.db = new DatabaseSync(dbPath);
    this.init();
    this.load(graph);
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE files(id TEXT PRIMARY KEY, path TEXT, path_lc TEXT, lang TEXT,
                         loc INTEGER, size INTEGER, indeg INTEGER DEFAULT 0, outdeg INTEGER DEFAULT 0, data TEXT);
      CREATE TABLE edges(source TEXT, target TEXT, raw TEXT);
      CREATE INDEX idx_edges_src ON edges(source);
      CREATE INDEX idx_edges_tgt ON edges(target);
      CREATE INDEX idx_files_pathlc ON files(path_lc);
    `);
  }

  private load(graph: Graph): void {
    const insF = this.db.prepare("INSERT OR IGNORE INTO files(id,path,path_lc,lang,loc,size,data) VALUES(?,?,?,?,?,?,?)");
    for (const n of graph.nodes) insF.run(n.id, n.path, n.path.toLowerCase(), n.lang, n.loc, n.size ?? 0, JSON.stringify(n));
    const insE = this.db.prepare("INSERT INTO edges(source,target,raw) VALUES(?,?,?)");
    for (const e of graph.edges) insE.run(e.source, e.target, e.raw);
    this.db.exec(`UPDATE files SET
      outdeg=(SELECT COUNT(*) FROM edges WHERE source=files.id),
      indeg=(SELECT COUNT(*) FROM edges WHERE target=files.id)`);
    const meta = this.db.prepare("INSERT INTO meta(k,v) VALUES(?,?)");
    meta.run("stats", JSON.stringify(graph.stats));
    meta.run("root", graph.root);
    meta.run("generatedAt", graph.generatedAt);
  }

  stats(): GraphStats {
    return JSON.parse(this.meta("stats") || "{}");
  }

  files(): FileNode[] {
    return (this.db.prepare("SELECT data FROM files").all() as Row[]).map((r) => JSON.parse(r.data as string));
  }

  getFile(id: string): FileNode | undefined {
    const r = this.db.prepare("SELECT data FROM files WHERE id=?").get(id) as Row | undefined;
    return r ? JSON.parse(r.data as string) : undefined;
  }

  search(query: string, limit = 50): FileNode[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rows = this.db.prepare("SELECT data FROM files WHERE path_lc LIKE ? ORDER BY LENGTH(path) LIMIT ?").all(`%${q}%`, limit) as Row[];
    return rows.map((r) => JSON.parse(r.data as string));
  }

  neighbors(id: string, dir: Direction = "both", depth = 1): Subgraph {
    if (!this.getFile(id)) return { nodes: [], edges: [] };
    const nbr =
      dir === "in" ? "SELECT target AS src, source AS nb FROM edges"
      : dir === "out" ? "SELECT source AS src, target AS nb FROM edges"
      : "SELECT source AS src, target AS nb FROM edges UNION SELECT target, source FROM edges";
    const sql = `
      WITH RECURSIVE nbr(src, nb) AS (${nbr}),
      walk(cur, d) AS (
        SELECT ?, 0
        UNION
        SELECT nbr.nb, walk.d + 1 FROM walk JOIN nbr ON nbr.src = walk.cur WHERE walk.d < ?
      )
      SELECT DISTINCT cur FROM walk`;
    const ids = new Set((this.db.prepare(sql).all(id, depth) as Row[]).map((r) => r.cur as string));
    return this.materialize(ids);
  }

  subgraph(opts: SubgraphOptions = {}): Subgraph {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.folder) {
      const p = opts.folder.replace(/\/$/, "");
      where.push("(path = ? OR path LIKE ?)");
      args.push(p, p + "/%");
    }
    if (opts.minDegree != null) { where.push("(indeg + outdeg) >= ?"); args.push(opts.minDegree); }
    let sql = "SELECT id FROM files";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY (indeg + outdeg) DESC";
    if (opts.limit != null) { sql += " LIMIT ?"; args.push(opts.limit); }
    const ids = new Set((this.db.prepare(sql).all(...args) as Row[]).map((r) => r.id as string));
    return this.materialize(ids);
  }

  summary(): Summary {
    return summarize(this.raw());
  }

  symbols(): SymbolGraph {
    return deriveSymbols(this.raw());
  }

  raw(): Graph {
    const edges = (this.db.prepare("SELECT source,target,raw FROM edges").all() as Row[]).map((e) => ({
      id: `${e.source}->${e.target}`, source: e.source as string, target: e.target as string, type: "import" as const, raw: e.raw as string,
    }));
    return {
      version: 1, root: this.meta("root"), generatedAt: this.meta("generatedAt"),
      stats: this.stats(), nodes: this.files(), edges,
    };
  }

  close(): void {
    this.db.close();
  }

  // ---- helpers -----------------------------------------------------------

  private meta(k: string): string {
    const r = this.db.prepare("SELECT v FROM meta WHERE k=?").get(k) as Row | undefined;
    return (r?.v as string) ?? "";
  }

  private materialize(ids: Set<string>): Subgraph {
    if (!ids.size) return { nodes: [], edges: [] };
    const list = [...ids];
    const ph = list.map(() => "?").join(",");
    const nodes = (this.db.prepare(`SELECT data FROM files WHERE id IN (${ph})`).all(...list) as Row[]).map((r) => JSON.parse(r.data as string));
    const edges = (this.db.prepare(`SELECT source,target,raw FROM edges WHERE source IN (${ph}) AND target IN (${ph})`).all(...list, ...list) as Row[]).map((e) => ({
      id: `${e.source}->${e.target}`, source: e.source as string, target: e.target as string, type: "import" as const, raw: e.raw as string,
    }));
    return { nodes, edges };
  }
}
