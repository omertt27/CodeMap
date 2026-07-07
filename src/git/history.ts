import type { Graph } from "../graph/types.js";
import type { Commit, FileStat } from "./git.js";

// Deterministic evolution metrics derived from git history: code churn, a
// stability score, and repository-level insights. Pure functions over the git
// data — no parsing, no rendering.

export type ChurnLevel = "Very Low" | "Low" | "Medium" | "High" | "Extreme";

export interface ChurnEntry {
  path: string;
  commits: number;
  churn: number; // insertions + deletions
  authors: number;
  score: number; // 0..100 relative to the busiest file
  level: ChurnLevel;
}

export function computeChurn(hist: Map<string, FileStat>): ChurnEntry[] {
  const entries = [...hist.values()];
  const maxChurn = Math.max(1, ...entries.map((e) => e.insertions + e.deletions));
  return entries
    .map((e) => {
      const churn = e.insertions + e.deletions;
      const score = Math.round((100 * churn) / maxChurn);
      return { path: e.path, commits: e.commits, churn, authors: e.authors.length, score, level: levelOf(score) };
    })
    .sort((a, b) => b.churn - a.churn);
}

function levelOf(score: number): ChurnLevel {
  if (score < 10) return "Very Low";
  if (score < 30) return "Low";
  if (score < 55) return "Medium";
  if (score < 80) return "High";
  return "Extreme";
}

export interface StabilityEntry {
  path: string;
  stability: number; // 0..100, higher = more stable
  commits: number;
  authors: number;
  churn: number;
}

/**
 * Stability = inverse of volatility, where volatility blends commit frequency,
 * author count, and churn (each normalised to the repo maximum). High-churn,
 * many-author, frequently-committed files score low.
 */
export function computeStability(hist: Map<string, FileStat>): Map<string, StabilityEntry> {
  const entries = [...hist.values()];
  const maxCommits = Math.max(1, ...entries.map((e) => e.commits));
  const maxAuthors = Math.max(1, ...entries.map((e) => e.authors.length));
  const maxChurn = Math.max(1, ...entries.map((e) => e.insertions + e.deletions));
  const out = new Map<string, StabilityEntry>();
  for (const e of entries) {
    const churn = e.insertions + e.deletions;
    const volatility = 0.4 * (e.commits / maxCommits) + 0.3 * (e.authors.length / maxAuthors) + 0.3 * (churn / maxChurn);
    out.set(e.path, { path: e.path, stability: Math.round(100 * (1 - volatility)), commits: e.commits, authors: e.authors.length, churn });
  }
  return out;
}

export interface EvolutionInsights {
  mostChangedModule: string | null;
  fastestGrowingSubsystem: string | null;
  mostStableSubsystem: string | null;
  newestArchitecturalLayer: string | null;
  mostVolatileDependency: string | null;
  couplingIncreasing: { module: string; before: number; after: number }[];
  couplingDecreasing: { module: string; before: number; after: number }[];
}

/**
 * Repo-level narrative. Churn/date signals come from git alone; the coupling
 * trends compare per-directory dependency degree between two snapshots.
 */
export function evolutionInsights(
  hist: Map<string, FileStat>,
  opts: { startGraph?: Graph; endGraph?: Graph } = {},
): EvolutionInsights {
  const entries = [...hist.values()];
  const topDir = (p: string) => (p.includes("/") ? p.split("/")[0] : "(root)");

  // Churn by top-level directory.
  const churnByDir = new Map<string, number>();
  const filesByDir = new Map<string, number>();
  const oldestByDir = new Map<string, string>();
  const dates = entries.map((e) => e.firstDate).filter(Boolean).sort();
  const recentCutoff = dates.length ? dates[Math.floor(dates.length * 0.7)] : "";
  const grownByDir = new Map<string, number>();

  for (const e of entries) {
    const d = topDir(e.path);
    churnByDir.set(d, (churnByDir.get(d) ?? 0) + e.insertions + e.deletions);
    filesByDir.set(d, (filesByDir.get(d) ?? 0) + 1);
    const cur = oldestByDir.get(d);
    if (!cur || e.firstDate < cur) oldestByDir.set(d, e.firstDate);
    if (recentCutoff && e.firstDate >= recentCutoff) grownByDir.set(d, (grownByDir.get(d) ?? 0) + 1);
  }

  const mostChangedModule = topBy(churnByDir, (v) => v);
  const fastestGrowingSubsystem = topBy(grownByDir, (v) => v);
  // Most stable subsystem = lowest average churn per file (min files 2).
  let mostStableSubsystem: string | null = null;
  let bestAvg = Infinity;
  for (const [d, files] of filesByDir) {
    if (files < 2) continue;
    const avg = (churnByDir.get(d) ?? 0) / files;
    if (avg < bestAvg) { bestAvg = avg; mostStableSubsystem = d; }
  }
  // Newest layer = directory whose earliest file is the most recent.
  const newestArchitecturalLayer = topBy(oldestByDir, (v) => Date.parse(v) || 0);
  // Most volatile dependency = highest-churn file overall.
  const mostVolatileDependency = entries.slice().sort((a, b) => (b.insertions + b.deletions) - (a.insertions + a.deletions))[0]?.path ?? null;

  const { couplingIncreasing, couplingDecreasing } = couplingTrends(opts.startGraph, opts.endGraph);

  return {
    mostChangedModule,
    fastestGrowingSubsystem,
    mostStableSubsystem,
    newestArchitecturalLayer,
    mostVolatileDependency,
    couplingIncreasing,
    couplingDecreasing,
  };
}

function couplingTrends(start?: Graph, end?: Graph): Pick<EvolutionInsights, "couplingIncreasing" | "couplingDecreasing"> {
  if (!start || !end) return { couplingIncreasing: [], couplingDecreasing: [] };
  const degByDir = (g: Graph) => {
    const m = new Map<string, number>();
    const dir = (id: string) => {
      const p = g.nodes.find((n) => n.id === id)?.dir ?? "";
      return p === "" ? "(root)" : p.split("/")[0];
    };
    for (const e of g.edges) {
      m.set(dir(e.source), (m.get(dir(e.source)) ?? 0) + 1);
      m.set(dir(e.target), (m.get(dir(e.target)) ?? 0) + 1);
    }
    return m;
  };
  const a = degByDir(start);
  const b = degByDir(end);
  const dirs = new Set([...a.keys(), ...b.keys()]);
  const deltas = [...dirs].map((d) => ({ module: d, before: a.get(d) ?? 0, after: b.get(d) ?? 0 }));
  return {
    couplingIncreasing: deltas.filter((d) => d.after - d.before > 0).sort((x, y) => (y.after - y.before) - (x.after - x.before)).slice(0, 5),
    couplingDecreasing: deltas.filter((d) => d.before - d.after > 0).sort((x, y) => (y.before - y.after) - (x.before - x.after)).slice(0, 5),
  };
}

function topBy<T>(m: Map<string, T>, score: (v: T) => number): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [k, v] of m) {
    const s = score(v);
    if (s > bestScore) { bestScore = s; best = k; }
  }
  return best;
}

/** Pick `steps` evenly-spaced commits (oldest→newest), always including both ends. */
export function sampleTimeline(commits: Commit[], steps: number): Commit[] {
  const chron = [...commits].reverse(); // git log is newest-first
  if (chron.length <= steps) return chron;
  const out: Commit[] = [];
  for (let i = 0; i < steps; i++) out.push(chron[Math.round((i * (chron.length - 1)) / (steps - 1))]);
  return [...new Map(out.map((c) => [c.hash, c])).values()];
}
