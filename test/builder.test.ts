import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepository } from "../src/scanner/repository.js";
import { buildCodeGraph } from "../src/graph/builder.js";
import type { CodeGraph, EdgeType, NodeType } from "../src/graph/model.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function graphOf(name: string): Promise<CodeGraph> {
  const { root, files } = await parseRepository(path.join(fixtures, name));
  return buildCodeGraph(root, files);
}

const nodeByName = (g: CodeGraph, type: NodeType, name: string) =>
  g.nodes.find((n) => n.type === type && n.name === name);
const hasEdge = (g: CodeGraph, type: EdgeType, srcId: string, tgtId: string) =>
  g.edges.some((e) => e.type === type && e.source === srcId && e.target === tgtId);

test("builder: emits generic node types for every symbol kind", async () => {
  const g = await graphOf("ts-rich");
  assert.ok(nodeByName(g, "Repository", path.basename(path.join(fixtures, "ts-rich"))));
  assert.ok(nodeByName(g, "File", "animal.ts"));
  assert.ok(nodeByName(g, "Interface", "Named"));
  assert.ok(nodeByName(g, "Enum", "Kind"));
  assert.ok(nodeByName(g, "Class", "Animal"));
  assert.ok(nodeByName(g, "Class", "Dog"));
  assert.ok(nodeByName(g, "Method", "bark"));
  assert.ok(nodeByName(g, "Variable", "MAX"));
});

test("builder: DECLARES (file→symbol) and CONTAINS (class→method)", async () => {
  const g = await graphOf("ts-rich");
  const fileId = nodeByName(g, "File", "animal.ts")!.id;
  const dogId = nodeByName(g, "Class", "Dog")!.id;
  const barkId = nodeByName(g, "Method", "bark")!.id;
  assert.ok(hasEdge(g, "DECLARES", fileId, dogId));
  assert.ok(hasEdge(g, "CONTAINS", dogId, barkId));
  // A method belongs to its class, not declared at file level.
  assert.ok(!hasEdge(g, "DECLARES", fileId, barkId));
});

test("builder: EXTENDS and IMPLEMENTS resolve by name", async () => {
  const g = await graphOf("ts-rich");
  const dogId = nodeByName(g, "Class", "Dog")!.id;
  const animalId = nodeByName(g, "Class", "Animal")!.id;
  const namedId = nodeByName(g, "Interface", "Named")!.id;
  assert.ok(hasEdge(g, "EXTENDS", dogId, animalId));
  assert.ok(hasEdge(g, "IMPLEMENTS", dogId, namedId));
});

test("builder: EXPORTS edges for exported top-level symbols", async () => {
  const g = await graphOf("ts-rich");
  const fileId = nodeByName(g, "File", "animal.ts")!.id;
  const maxId = nodeByName(g, "Variable", "MAX")!.id;
  assert.ok(hasEdge(g, "EXPORTS", fileId, maxId));
});

test("builder: IMPORTS across files and to external packages", async () => {
  const g = await graphOf("java-basic");
  const serverFile = g.nodes.find((n) => n.type === "File" && n.name === "Server.java")!;
  const helperFile = g.nodes.find((n) => n.type === "File" && n.name === "Helper.java")!;
  assert.ok(hasEdge(g, "IMPORTS", serverFile.id, helperFile.id)); // internal
  // java.util.List → external Package node.
  const pkg = g.nodes.find((n) => n.type === "Package" && n.name === "java.util.List");
  assert.ok(pkg && hasEdge(g, "IMPORTS", serverFile.id, pkg.id));
});

test("builder: directory hierarchy via CONTAINS", async () => {
  const g = await graphOf("java-basic");
  const repo = g.nodes.find((n) => n.type === "Repository")!;
  // Repository → com (directory) exists as a CONTAINS chain.
  const comDir = g.nodes.find((n) => n.type === "Directory" && n.path === "com");
  assert.ok(comDir);
  assert.ok(hasEdge(g, "CONTAINS", repo.id, comDir!.id));
  assert.ok(g.stats.primaryLanguage === "java");
});
