import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analysis/index.js";
import { DependencyIndex } from "../src/analysis/graph.js";
import { nodeMetrics } from "../src/analysis/metrics.js";
import { DEFAULT_CONFIG } from "../src/analysis/config.js";
import type { Graph, FileNode, Edge } from "../src/graph/types.js";

function file(path: string, over: Partial<FileNode> = {}): FileNode {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return {
    id: `file:${path}`, path, name: path.split("/").pop()!, dir, lang: "typescript",
    loc: 20, size: 400, imports: [], exports: [], functions: [], classes: [], ...over,
  };
}
function edge(a: string, b: string): Edge {
  return { id: `file:${a}->file:${b}`, source: `file:${a}`, target: `file:${b}`, type: "import", raw: `./${b}` };
}
function graph(nodes: FileNode[], edges: Edge[]): Graph {
  return {
    version: 1, root: "/repo", generatedAt: "2026-01-01T00:00:00Z",
    stats: { files: nodes.length, edges: edges.length, languages: {}, functions: 0, classes: 0 },
    nodes, edges,
  };
}

test("cycles: detects an SCC with severity and a suggested break", () => {
  const g = graph(
    [file("a.ts"), file("b.ts"), file("c.ts")],
    [edge("a.ts", "b.ts"), edge("b.ts", "c.ts"), edge("c.ts", "a.ts")],
  );
  const a = analyze(g, DEFAULT_CONFIG);
  assert.equal(a.cycles.length, 1);
  assert.deepEqual(a.cycles[0].files, ["a.ts", "b.ts", "c.ts"]);
  assert.equal(a.cycles[0].length, 3);
  assert.equal(a.cycles[0].severity, "medium");
  assert.ok(a.cycles[0].suggestedBreak);
});

test("hotspots: a heavily-depended-upon file scores highest", () => {
  // hub is imported by a,b,c,d
  const nodes = [file("hub.ts", { exports: ["x", "y"] }), file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")];
  const edges = [edge("a.ts", "hub.ts"), edge("b.ts", "hub.ts"), edge("c.ts", "hub.ts"), edge("d.ts", "hub.ts")];
  const a = analyze(graph(nodes, edges), DEFAULT_CONFIG);
  assert.equal(a.hotspots[0].path, "hub.ts");
  assert.ok(a.hotspots[0].score > 0 && a.hotspots[0].score <= 100);
  assert.ok(a.hotspots[0].reasons.length > 0);
});

test("god module: flagged only when multiple thresholds trip", () => {
  const god = file("god.ts", {
    loc: 500,
    functions: Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, kind: "function" as const, line: i, exported: true })),
    exports: Array.from({ length: 20 }, (_, i) => `e${i}`),
  });
  const small = file("small.ts", { loc: 500 }); // only one signal → not flagged
  const a = analyze(graph([god, small], []), DEFAULT_CONFIG);
  const paths = a.godModules.map((m) => m.path);
  assert.ok(paths.includes("god.ts"));
  assert.ok(!paths.includes("small.ts"));
});

test("dead code: conservative — imported or reachable files are not flagged", () => {
  // main (entry) imports used; orphan is isolated with no exports.
  const nodes = [file("main.ts"), file("used.ts", { exports: ["a"] }), file("orphan.ts")];
  const edges = [edge("main.ts", "used.ts")];
  const a = analyze(graph(nodes, edges), DEFAULT_CONFIG);
  const paths = a.unused.map((u) => u.path);
  assert.ok(paths.includes("orphan.ts"));
  assert.ok(!paths.includes("used.ts")); // reachable from entry
  assert.ok(!paths.includes("main.ts")); // entry point
});

test("layer violations: ui importing database is reported", () => {
  const nodes = [file("src/components/Button.ts"), file("src/db/query.ts")];
  const edges = [edge("src/components/Button.ts", "src/db/query.ts")];
  const config = {
    ...DEFAULT_CONFIG,
    layers: [
      { name: "ui", patterns: ["src/components/**"] },
      { name: "database", patterns: ["src/db/**"] },
    ],
    rules: [{ from: "ui", cannotImport: ["database"] }],
  };
  const a = analyze(graph(nodes, edges), config);
  assert.equal(a.layerViolations.length, 1);
  assert.equal(a.layerViolations[0].fromLayer, "ui");
  assert.equal(a.layerViolations[0].toLayer, "database");
});

test("node metrics: transitive imports and depth", () => {
  // a → b → c  (chain)
  const g = graph([file("a.ts"), file("b.ts"), file("c.ts")], [edge("a.ts", "b.ts"), edge("b.ts", "c.ts")]);
  const idx = new DependencyIndex(g);
  const m = nodeMetrics(idx, "file:a.ts")!;
  assert.equal(m.directImports, 1);
  assert.equal(m.transitiveImports, 2); // b and c
  assert.equal(m.depth, 2);
  const c = nodeMetrics(idx, "file:c.ts")!;
  assert.equal(c.transitiveDependents, 2); // a and b depend on c transitively
});

test("summary: reports most central module", () => {
  const nodes = [file("core.ts"), file("a.ts"), file("b.ts")];
  const a = analyze(graph(nodes, [edge("a.ts", "core.ts"), edge("b.ts", "core.ts")]), DEFAULT_CONFIG);
  assert.equal(a.summary.mostCentral, "core.ts");
  assert.equal(a.summary.files, 3);
});
