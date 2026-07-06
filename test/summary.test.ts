import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/graph/summary.js";
import { deriveSymbols } from "../src/graph/symbols.js";
import type { Graph, FileNode, Edge, ImportRef } from "../src/graph/types.js";

function file(path: string, imports: ImportRef[] = [], funcs = 0, classes = 0): FileNode {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return {
    id: `file:${path}`, path, name: path.split("/").pop()!, dir,
    lang: "typescript", loc: 10, imports, exports: [],
    functions: Array.from({ length: funcs }, (_, i) => ({ name: `fn${i}`, kind: "function" as const, line: i + 1, exported: true })),
    classes: Array.from({ length: classes }, (_, i) => ({ name: `Cls${i}`, kind: "class" as const, line: i + 1, exported: true })),
  };
}
function edge(from: string, to: string): Edge {
  return { id: `file:${from}->file:${to}`, source: `file:${from}`, target: `file:${to}`, type: "import", raw: `./${to}` };
}
function ext(raw: string): ImportRef {
  return { raw, resolved: null, external: true, line: 1 };
}

function makeGraph(): Graph {
  const nodes = [
    file("a.ts", [ext("react"), ext("react")], 2),
    file("b.ts", [], 1, 1),
    file("c.ts"),
    file("d.ts"), // orphan
    file("x.ts"),
    file("y.ts"),
  ];
  const edges = [edge("a.ts", "b.ts"), edge("c.ts", "b.ts"), edge("a.ts", "c.ts"), edge("x.ts", "y.ts"), edge("y.ts", "x.ts")];
  return {
    version: 1, root: "/repo", generatedAt: new Date().toISOString(),
    stats: { files: nodes.length, edges: edges.length, languages: { typescript: nodes.length }, functions: 3, classes: 1 },
    nodes, edges,
  };
}

test("summary: hubs ranked by in-degree", () => {
  const s = summarize(makeGraph());
  assert.equal(s.hubs[0].path, "b.ts");
  assert.equal(s.hubs[0].inDegree, 2);
});

test("summary: connectors ranked by out-degree", () => {
  const s = summarize(makeGraph());
  assert.equal(s.connectors[0].path, "a.ts");
  assert.equal(s.connectors[0].outDegree, 2);
});

test("summary: detects the X<->Y import cycle", () => {
  const s = summarize(makeGraph());
  assert.equal(s.cycles.length, 1);
  assert.deepEqual([...s.cycles[0]].sort(), ["x.ts", "y.ts"]);
});

test("summary: identifies the orphan file", () => {
  const s = summarize(makeGraph());
  assert.ok(s.orphans.includes("d.ts"));
});

test("summary: counts external packages", () => {
  const s = summarize(makeGraph());
  const react = s.externals.find((e) => e.name === "react");
  assert.equal(react?.count, 2);
});

test("deriveSymbols: promotes functions/classes to nodes with containment edges", () => {
  const { symbols, contains } = deriveSymbols(makeGraph());
  // a.ts has 2 functions, b.ts has 1 function + 1 class → 4 symbols total.
  assert.equal(symbols.length, 4);
  assert.equal(contains.length, 4);
  const s0 = symbols[0];
  assert.match(s0.id, /^sym:a\.ts#function:fn0@1$/);
  assert.equal(contains[0].source, "file:a.ts");
  assert.equal(contains[0].target, s0.id);
});
