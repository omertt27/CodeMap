import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonGraphStore } from "../src/graph/store.js";
import { SqliteGraphStore } from "../src/graph/sqliteStore.js";
import type { Graph, FileNode, Edge } from "../src/graph/types.js";

function file(path: string): FileNode {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { id: `file:${path}`, path, name: path.split("/").pop()!, dir, lang: "typescript",
    loc: 10, size: 200, imports: [], exports: [], functions: [], classes: [] };
}
function edge(a: string, b: string): Edge {
  return { id: `file:${a}->file:${b}`, source: `file:${a}`, target: `file:${b}`, type: "import", raw: `./${b}` };
}
function graph(): Graph {
  const nodes = [file("src/a.ts"), file("src/b.ts"), file("src/c.ts"), file("d.ts")];
  const edges = [edge("src/a.ts", "src/b.ts"), edge("src/b.ts", "src/c.ts")];
  return { version: 1, root: "/repo", generatedAt: "2026-01-01T00:00:00Z",
    stats: { files: 4, edges: 2, languages: { typescript: 4 }, functions: 0, classes: 0 }, nodes, edges };
}

const paths = (sub: { nodes: FileNode[] }) => sub.nodes.map((n) => n.path).sort();

test("sqlite store: getFile / search parity with JSON store", () => {
  const j = new JsonGraphStore(graph());
  const s = new SqliteGraphStore(graph());
  assert.deepEqual(s.getFile("file:src/a.ts")?.path, j.getFile("file:src/a.ts")?.path);
  assert.equal(s.getFile("file:missing"), undefined);
  assert.deepEqual(s.search("src/").map((n) => n.path).sort(), j.search("src/").map((n) => n.path).sort());
  assert.equal(s.search("src/", 1).length, 1);
  s.close();
});

test("sqlite store: neighbors (recursive CTE) parity", () => {
  const j = new JsonGraphStore(graph());
  const s = new SqliteGraphStore(graph());
  assert.deepEqual(paths(s.neighbors("file:src/b.ts", "both", 1)), paths(j.neighbors("file:src/b.ts", "both", 1)));
  assert.deepEqual(paths(s.neighbors("file:src/a.ts", "out", 2)), paths(j.neighbors("file:src/a.ts", "out", 2)));
  assert.deepEqual(paths(s.neighbors("file:src/c.ts", "in", 2)), paths(j.neighbors("file:src/c.ts", "in", 2)));
  s.close();
});

test("sqlite store: subgraph + stats parity", () => {
  const j = new JsonGraphStore(graph());
  const s = new SqliteGraphStore(graph());
  assert.deepEqual(paths(s.subgraph({ folder: "src" })), paths(j.subgraph({ folder: "src" })));
  assert.deepEqual(paths(s.subgraph({ minDegree: 1 })), paths(j.subgraph({ minDegree: 1 })));
  assert.equal(s.subgraph({ limit: 1 }).nodes[0].path, j.subgraph({ limit: 1 }).nodes[0].path);
  assert.deepEqual(s.stats(), j.stats());
  s.close();
});

test("sqlite store: summary derived through the DB matches", () => {
  const s = new SqliteGraphStore(graph());
  assert.equal(s.summary().files, 4);
  assert.equal(s.raw().nodes.length, 4);
  assert.equal(s.raw().edges.length, 2);
  s.close();
});
