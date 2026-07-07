import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listCommits, fileHistory, isGitRepo } from "../src/git/git.js";
import { computeChurn, computeStability } from "../src/git/history.js";
import { snapshotFileGraph, diffRevisions, buildHistory } from "../src/git/index.js";

let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
function write(rel: string, content: string) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function commit(msg: string) {
  git("add", "-A");
  execFileSync("git", ["-C", repo, "commit", "-m", msg], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@x" },
  });
}

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-git-"));
  git("init", "-q");
  git("config", "user.email", "t@x");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");

  write("src/a.ts", "export const a = 1;\n");
  write("src/b.ts", "import { a } from './a.js';\nexport const b = a + 1;\n");
  commit("c1: a + b");

  write("src/a.ts", "export const a = 2;\nexport const a2 = 3;\n"); // churn a.ts
  write("src/c.ts", "import { b } from './b.js';\nexport const c = b;\n"); // new file
  commit("c2: add c, change a");
});

after(() => fs.rmSync(repo, { recursive: true, force: true }));

test("git: lists commits newest-first", () => {
  assert.ok(isGitRepo(repo));
  const commits = listCommits(repo);
  assert.equal(commits.length, 2);
  assert.match(commits[0].subject, /add c/);
});

test("git: file history tracks churn and commit counts", () => {
  const hist = fileHistory(repo);
  assert.equal(hist.get("src/a.ts")!.commits, 2); // changed in both commits
  assert.equal(hist.get("src/c.ts")!.commits, 1);
  const churn = computeChurn(hist);
  assert.ok(churn.find((c) => c.path === "src/a.ts")!.churn > 0);
  const stability = computeStability(hist);
  assert.ok(stability.get("src/c.ts")!.stability >= 0 && stability.get("src/c.ts")!.stability <= 100);
});

test("snapshot: rebuilds the graph at any revision from git objects", async () => {
  const commits = listCommits(repo);
  const first = commits[1].hash;
  const head = commits[0].hash;
  const gFirst = await snapshotFileGraph(repo, first);
  const gHead = await snapshotFileGraph(repo, head);
  assert.ok(!gFirst.nodes.some((n) => n.path === "src/c.ts")); // c didn't exist yet
  assert.ok(gHead.nodes.some((n) => n.path === "src/c.ts"));
  // working directory untouched (still on a branch, clean status)
  assert.equal(git("status", "--porcelain").trim(), "");
});

test("diff: reports added files and dependencies between revisions", async () => {
  const commits = listCommits(repo);
  const diff = (await diffRevisions(repo, commits[1].hash, commits[0].hash))!;
  assert.ok(diff.addedFiles.includes("src/c.ts"));
  assert.ok(diff.addedDependencies.some((d) => d.from === "src/c.ts" && d.to === "src/b.ts"));
});

test("history: builds a full report with evolution insights", async () => {
  const report = await buildHistory(repo, { evolutionGraphs: true });
  assert.equal(report.isRepo, true);
  assert.equal(report.commits.length, 2);
  assert.equal(report.evolution.mostChangedModule, "src");
  assert.ok(report.churn.length >= 3);
});
