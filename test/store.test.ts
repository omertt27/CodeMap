import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonGraphStore } from "../src/graph/store.js";
import type { Graph, FileNode, Edge } from "../src/graph/types.js";

function file(path: string): FileNode {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { id: `file:${path}`, path, name: path.split("/").pop()!, dir,
    lang: "typescript", loc: 10, imports: [], exports: [], functions: [], classes: [] };
}
function edge(from: string, to: string): Edge {
  return { id: `file:${from}->file:${to}`, source: `file:${from}`, target: `file:${to}`, type: "import", raw: `./${to}` };
}

function store() {
  // a -> b -> c ; hub b (in-degree from a), d isolated, folder src/
  const nodes = [file("src/a.ts"), file("src/b.ts"), file("src/c.ts"), file("d.ts")];
  const edges = [edge("src/a.ts", "src/b.ts"), edge("src/b.ts", "src/c.ts")];
  const graph: Graph = {
    version: 1, root: "/repo", generatedAt: "2026-01-01T00:00:00Z",
    stats: { files: 4, edges: 2, languages: { typescript: 4 }, functions: 0, classes: 0 },
    nodes, edges,
  };
  return new JsonGraphStore(graph);
}

test("store.getFile / search", () => {
  const s = store();
  assert.equal(s.getFile("file:src/a.ts")?.path, "src/a.ts");
  assert.equal(s.getFile("file:missing"), undefined);
  assert.deepEqual(s.search("src/").map((n) => n.path).sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.equal(s.search("src/", 1).length, 1);
});

test("store.neighbors depth 1 (both directions)", () => {
  const s = store();
  const sub = s.neighbors("file:src/b.ts", "both", 1);
  assert.deepEqual(sub.nodes.map((n) => n.path).sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.equal(sub.edges.length, 2);
});

test("store.neighbors direction and depth", () => {
  const s = store();
  assert.deepEqual(s.neighbors("file:src/a.ts", "out", 1).nodes.map((n) => n.path).sort(), ["src/a.ts", "src/b.ts"]);
  // depth 2 out from a reaches c
  assert.deepEqual(s.neighbors("file:src/a.ts", "out", 2).nodes.map((n) => n.path).sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("store.subgraph folder + limit", () => {
  const s = store();
  const folder = s.subgraph({ folder: "src" });
  assert.deepEqual(folder.nodes.map((n) => n.path).sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.ok(!folder.nodes.some((n) => n.path === "d.ts"));
  // highest-degree first: b has degree 2
  assert.equal(s.subgraph({ limit: 1 }).nodes[0].path, "src/b.ts");
});

test("store.subgraph minDegree filters isolated files", () => {
  const s = store();
  const sub = s.subgraph({ minDegree: 1 });
  assert.ok(!sub.nodes.some((n) => n.path === "d.ts"));
});
