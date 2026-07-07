import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectWorkspaces, packageOf, packageRollup } from "../src/scanner/workspaces.js";
import type { Graph, FileNode, Edge } from "../src/graph/types.js";

function monorepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-ws-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test("workspaces: detects npm workspaces globs", () => {
  const root = monorepo({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/web/package.json": "{}",
    "packages/api/package.json": "{}",
    "packages/notapkg/readme.md": "x", // no package.json → not a package
  });
  const ws = detectWorkspaces(root);
  assert.deepEqual(ws.sort(), ["packages/api", "packages/web"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("workspaces: detects pnpm-workspace.yaml", () => {
  const root = monorepo({
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n",
    "apps/dash/package.json": "{}",
  });
  assert.deepEqual(detectWorkspaces(root), ["apps/dash"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("workspaces: packageOf maps files to the most specific package", () => {
  const dirs = ["packages/web", "packages/api"];
  assert.equal(packageOf("packages/web/src/app.ts", dirs), "packages/web");
  assert.equal(packageOf("packages/api/index.ts", dirs), "packages/api");
  assert.equal(packageOf("scripts/build.ts", dirs), "(root)");
});

test("workspaces: rollup counts files and cross-package deps", () => {
  const f = (p: string): FileNode => ({
    id: `file:${p}`, path: p, name: p.split("/").pop()!, dir: p.slice(0, p.lastIndexOf("/")),
    lang: "typescript", loc: 10, size: 100, imports: [], exports: [], functions: [], classes: [],
  });
  const e = (a: string, b: string): Edge => ({ id: `${a}->${b}`, source: `file:${a}`, target: `file:${b}`, type: "import", raw: "x" });
  const graph: Graph = {
    version: 1, root: "/r", generatedAt: "", stats: { files: 3, edges: 1, languages: {}, functions: 0, classes: 0 },
    nodes: [f("packages/web/a.ts"), f("packages/web/b.ts"), f("packages/api/x.ts")],
    edges: [e("packages/web/a.ts", "packages/api/x.ts")], // web depends on api
  };
  const roll = packageRollup(graph, ["packages/web", "packages/api"]);
  const web = roll.find((r) => r.name === "packages/web")!;
  assert.equal(web.files, 2);
  assert.deepEqual(web.dependsOn, ["packages/api"]);
});
