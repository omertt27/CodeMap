import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeImpact } from "../src/impact/index.js";
import type { Graph, FileNode, Edge } from "../src/graph/types.js";

function file(path: string, over: Partial<FileNode> = {}): FileNode {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { id: `file:${path}`, path, name: path.split("/").pop()!, dir, lang: "typescript",
    loc: 20, size: 400, imports: [], exports: [], functions: [], classes: [], ...over };
}
function edge(a: string, b: string): Edge {
  return { id: `file:${a}->file:${b}`, source: `file:${a}`, target: `file:${b}`, type: "import", raw: `./${b}` };
}
function graph(nodes: FileNode[], edges: Edge[]): Graph {
  return { version: 1, root: "/repo", generatedAt: "2026-01-01T00:00:00Z",
    stats: { files: nodes.length, edges: edges.length, languages: {}, functions: 0, classes: 0 }, nodes, edges };
}

test("impact: reverse BFS assigns hops and reasons", () => {
  // a → b → c → d   (a imports b, etc.); change d.
  const g = graph(
    [file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")],
    [edge("a.ts", "b.ts"), edge("b.ts", "c.ts"), edge("c.ts", "d.ts")],
  );
  const r = analyzeImpact(g, "d.ts")!;
  assert.equal(r.target, "d.ts");
  assert.equal(r.directDependents, 1); // c
  assert.equal(r.affectedFileCount, 3); // c, b, a
  assert.equal(r.maxHop, 3);
  const byPath = Object.fromEntries(r.affectedNodes.map((n) => [n.id, n]));
  assert.equal(byPath["c.ts"].hop, 1);
  assert.equal(byPath["c.ts"].reason, "imports d.ts");
  assert.equal(byPath["b.ts"].hop, 2);
  assert.equal(byPath["a.ts"].hop, 3);
});

test("impact: leaf file with no dependents has zero blast radius", () => {
  const g = graph([file("a.ts"), file("b.ts")], [edge("a.ts", "b.ts")]);
  const r = analyzeImpact(g, "a.ts")!; // nothing imports a
  assert.equal(r.affectedFileCount, 0);
  assert.equal(r.blastRadiusScore, 0);
});

test("impact: detects likely affected tests by import and by naming", () => {
  const g = graph(
    [file("src/session.ts"), file("src/api.ts"), file("tests/api.test.ts"), file("src/session.test.ts")],
    [edge("src/api.ts", "src/session.ts"), edge("tests/api.test.ts", "src/api.ts")],
  );
  const r = analyzeImpact(g, "src/session.ts")!;
  const tests = Object.fromEntries(r.likelyAffectedTests.map((t) => [t.id, t.via]));
  assert.equal(tests["tests/api.test.ts"], "import"); // transitively imports session
  assert.equal(tests["src/session.test.ts"], "naming"); // same stem
});

test("impact: detects affected entry points", () => {
  const g = graph(
    [file("src/auth.ts"), file("src/api/login.ts"), file("src/cli.ts")],
    [edge("src/api/login.ts", "src/auth.ts"), edge("src/cli.ts", "src/auth.ts")],
  );
  const r = analyzeImpact(g, "src/auth.ts")!;
  const kinds = Object.fromEntries(r.affectedEntryPoints.map((e) => [e.id, e.kind]));
  assert.equal(kinds["src/api/login.ts"], "api route");
  assert.equal(kinds["src/cli.ts"], "main");
});

test("impact: flags cycle participation and scores higher", () => {
  const g = graph(
    [file("a.ts"), file("b.ts"), file("c.ts")],
    [edge("a.ts", "b.ts"), edge("b.ts", "a.ts"), edge("c.ts", "a.ts")],
  );
  const r = analyzeImpact(g, "a.ts")!;
  assert.equal(r.inCycle, true);
  assert.equal(r.cycles.length, 1);
  assert.ok(r.blastRadiusScore > 0);
});

test("impact: resolves target by exact path and returns null for unknown", () => {
  const g = graph([file("src/x.ts")], []);
  assert.ok(analyzeImpact(g, "src/x.ts"));
  assert.equal(analyzeImpact(g, "does/not/exist.ts"), null);
});
