import { execFileSync } from "node:child_process";
import { projectFileGraph } from "../graph/build.js";
import { parseRevision } from "../git/snapshot.js";
import { isGitRepo, changedFiles, resolveRev } from "../git/git.js";
import { analyzeRepo } from "../analysis/index.js";
import { runGovernance, type GovernanceResult } from "./index.js";
import { computeHealth, grade, type HealthScore } from "./health.js";
import { DependencyIndex } from "../analysis/graph.js";
import { loadGovernanceConfig } from "./config.js";
import { evaluateRules } from "./rules.js";

// PR / branch analysis: compare HEAD against a base branch and report
// architectural impact. Deterministic, no LLMs, pure graph math.

export interface PrAnalysis {
  base: string;
  head: string;
  baseHealth: HealthScore;
  headHealth: HealthScore;
  healthDelta: number;
  gradeBefore: string;
  gradeAfter: string;
  newDependencies: { from: string; to: string }[];
  removedDependencies: { from: string; to: string }[];
  newCycles: string[][];
  resolvedCycles: string[][];
  newViolations: GovernanceResult["violations"];
  resolvedViolations: GovernanceResult["violations"];
  blastRadiusIncrease: number; // delta in total coupling
  newHotspots: string[];
  worsened: string[]; // files with increased hotspot score
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  couplingIncreased: { path: string; before: number; after: number }[];
  /** Whether governance rules pass on HEAD */
  passes: boolean;
}

/**
 * Determine the best merge-base for comparison.
 * Priority: GITHUB_BASE_REF env var > --base option > auto-detected default branch.
 */
export function resolveBase(root: string, explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env["GITHUB_BASE_REF"];
  if (fromEnv) return fromEnv;
  // Detect default branch from git remote
  try {
    const remote = execFileSync("git", ["-C", root, "remote", "show", "origin"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const m = remote.match(/HEAD branch: (.+)/);
    if (m) return m[1].trim();
  } catch { /* ignore */ }
  // Fall back to common defaults
  for (const b of ["main", "master", "develop"]) {
    if (resolveRev(root, b) !== null) return b;
  }
  return "HEAD~1";
}

/** Current HEAD rev short hash. */
function headRev(root: string): string {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "HEAD";
  }
}

/** Set difference: items in `a` not in `b`. */
function setDiff<T>(a: T[], b: T[], key: (v: T) => string): T[] {
  const bKeys = new Set(b.map(key));
  return a.filter((v) => !bKeys.has(key(v)));
}

/**
 * Analyse a PR/branch against `base`.
 * Parses both sides from git (no working-tree mutation), runs governance on
 * each, and returns a structured delta report.
 */
export async function analyzePr(root: string, opts: { base?: string } = {}): Promise<PrAnalysis> {
  if (!isGitRepo(root)) throw new Error("Not a git repository.");

  const base = resolveBase(root, opts.base);
  const head = headRev(root);

  // Parse both sides from git objects — never touches the working tree.
  const [baseParsed, headParsed] = await Promise.all([
    parseRevision(root, base),
    parseRevision(root, "HEAD"),
  ]);

  const baseGraph = projectFileGraph(baseParsed);
  const headGraph = projectFileGraph(headParsed);

  const config = loadGovernanceConfig(root);
  const baseIdx = new DependencyIndex(baseGraph);
  const headIdx = new DependencyIndex(headGraph);
  const baseAnalysis = analyzeRepo(baseGraph, root);
  const headAnalysis = analyzeRepo(headGraph, root);
  const baseViolations = evaluateRules(baseIdx, baseAnalysis, config);
  const headViolations = evaluateRules(headIdx, headAnalysis, config);
  const baseHealth = computeHealth(baseIdx, baseAnalysis, baseViolations);
  const headHealth = computeHealth(headIdx, headAnalysis, headViolations);

  // Dependencies diff
  const edgeKey = (e: { from: string; to: string }) => `${e.from}→${e.to}`;
  const baseDeps = baseGraph.edges.map((e) => {
    const bp = new Map(baseGraph.nodes.map((n) => [n.id, n.path]));
    return { from: bp.get(e.source) ?? e.source, to: bp.get(e.target) ?? e.target };
  });
  const headDeps = headGraph.edges.map((e) => {
    const hp = new Map(headGraph.nodes.map((n) => [n.id, n.path]));
    return { from: hp.get(e.source) ?? e.source, to: hp.get(e.target) ?? e.target };
  });
  const newDependencies = setDiff(headDeps, baseDeps, edgeKey);
  const removedDependencies = setDiff(baseDeps, headDeps, edgeKey);

  // Cycle diff
  const baseCycleSigs = new Set(baseAnalysis.cycles.map((c) => c.files.join("|")));
  const headCycleSigs = new Map(headAnalysis.cycles.map((c) => [c.files.join("|"), c.files]));
  const newCycles = [...headCycleSigs].filter(([sig]) => !baseCycleSigs.has(sig)).map(([, f]) => f);
  const resolvedCycles = baseAnalysis.cycles.filter((c) => !headCycleSigs.has(c.files.join("|"))).map((c) => c.files);

  // Violation diff
  const vKey = (v: GovernanceResult["violations"][number]) => `${v.rule}::${v.file}::${v.detail}`;
  const newViolations = setDiff(headViolations, baseViolations, vKey);
  const resolvedViolations = setDiff(baseViolations, headViolations, vKey);

  // Files changed
  const changed = changedFiles(root, base, "HEAD");
  const addedFiles = changed.filter((c) => c.status === "A").map((c) => c.path);
  const removedFiles = changed.filter((c) => c.status === "D").map((c) => c.path);
  const modifiedFiles = changed.filter((c) => c.status === "M").map((c) => c.path);

  // Hotspot changes
  const baseHotSet = new Set(baseAnalysis.hotspots.map((h) => h.path));
  const newHotspots = headAnalysis.hotspots.filter((h) => !baseHotSet.has(h.path)).map((h) => h.path);

  const baseHotMap = new Map(baseAnalysis.hotspots.map((h) => [h.path, h.score]));
  const worsened = headAnalysis.hotspots
    .filter((h) => (baseHotMap.get(h.path) ?? 0) < h.score)
    .map((h) => h.path);

  // Coupling changes
  const baseCoupling = new Map(baseGraph.nodes.map((n) => [n.path, baseIdx.inDegree(n.id) + baseIdx.outDegree(n.id)]));
  const couplingIncreased = headGraph.nodes
    .map((n) => ({ path: n.path, before: baseCoupling.get(n.path) ?? 0, after: headIdx.inDegree(n.id) + headIdx.outDegree(n.id) }))
    .filter((c) => c.after > c.before)
    .sort((a, b) => (b.after - b.before) - (a.after - a.before))
    .slice(0, 20);

  const totalBaseCoupling = baseGraph.nodes.reduce((s, n) => s + baseIdx.inDegree(n.id) + baseIdx.outDegree(n.id), 0);
  const totalHeadCoupling = headGraph.nodes.reduce((s, n) => s + headIdx.inDegree(n.id) + headIdx.outDegree(n.id), 0);
  const blastRadiusIncrease = totalHeadCoupling - totalBaseCoupling;

  const { governanceFails } = await import("./index.js");
  const headGovResult = runGovernance(headGraph, root, { analysis: headAnalysis, save: false });

  return {
    base,
    head,
    baseHealth,
    headHealth,
    healthDelta: headHealth.overall - baseHealth.overall,
    gradeBefore: grade(baseHealth.overall),
    gradeAfter: grade(headHealth.overall),
    newDependencies: newDependencies.slice(0, 50),
    removedDependencies: removedDependencies.slice(0, 50),
    newCycles,
    resolvedCycles,
    newViolations,
    resolvedViolations,
    blastRadiusIncrease,
    newHotspots,
    worsened,
    changedFiles: modifiedFiles,
    addedFiles,
    removedFiles,
    couplingIncreased,
    passes: !governanceFails(headGovResult),
  };
}
