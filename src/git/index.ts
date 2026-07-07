import type { Graph } from "../graph/types.js";
import type { MapGraph } from "../graph/mapView.js";
import { toMapGraph } from "../graph/mapView.js";
import { buildCodeGraph } from "../graph/builder.js";
import { projectFileGraph } from "../graph/build.js";
import { parseRevision } from "./snapshot.js";
import { architectureDiff, type ArchitectureDiff } from "./diff.js";
import {
  computeChurn, computeStability, evolutionInsights, sampleTimeline,
  type ChurnEntry, type EvolutionInsights, type StabilityEntry,
} from "./history.js";
import {
  changedFiles, fileHistory, getBranches, getTags, isGitRepo, listCommits, resolveRev,
  type Commit,
} from "./git.js";

// The Git Evolution Analyzer. Pipeline position:
//   parser → graph builder → architecture analyzer → impact analyzer → **git** → UI
// Reuses the parser and analyzers; never touches the working directory.

export * from "./git.js";
export * from "./history.js";
export type { ArchitectureDiff } from "./diff.js";

export interface HistoryReport {
  root: string;
  isRepo: boolean;
  commits: Commit[];
  branches: string[];
  tags: string[];
  churn: ChurnEntry[];
  stability: StabilityEntry[];
  evolution: EvolutionInsights;
}

/** Dependency graph at a revision (parsed from git objects). */
export async function snapshotFileGraph(root: string, rev: string): Promise<Graph> {
  return projectFileGraph(await parseRevision(root, rev));
}

/** Compact map graph at a revision (for the visualization). */
export async function snapshotMapGraph(root: string, rev: string): Promise<MapGraph> {
  const parsed = await parseRevision(root, rev);
  return toMapGraph(buildCodeGraph(parsed.root, parsed.files));
}

/** Full history report; optionally compares first/last snapshots for coupling trends. */
export async function buildHistory(root: string, opts: { evolutionGraphs?: boolean; maxCommits?: number } = {}): Promise<HistoryReport> {
  if (!isGitRepo(root)) {
    return { root, isRepo: false, commits: [], branches: [], tags: [], churn: [], stability: [], evolution: emptyEvolution() };
  }
  const commits = listCommits(root, { max: opts.maxCommits ?? 500 });
  const hist = fileHistory(root);
  const churn = computeChurn(hist);
  const stability = [...computeStability(hist).values()].sort((a, b) => a.stability - b.stability);

  let startGraph: Graph | undefined;
  let endGraph: Graph | undefined;
  if (opts.evolutionGraphs && commits.length > 1) {
    const first = commits[commits.length - 1].hash;
    const last = commits[0].hash;
    [startGraph, endGraph] = await Promise.all([
      snapshotFileGraph(root, first).catch(() => undefined),
      snapshotFileGraph(root, last).catch(() => undefined),
    ]);
  }

  return {
    root,
    isRepo: true,
    commits,
    branches: getBranches(root),
    tags: getTags(root),
    churn,
    stability,
    evolution: evolutionInsights(hist, { startGraph, endGraph }),
  };
}

/** Architecture diff between two revisions. */
export async function diffRevisions(root: string, a: string, b: string): Promise<ArchitectureDiff | null> {
  if (resolveRev(root, a) === null || resolveRev(root, b) === null) return null;
  const [fromGraph, toGraph] = await Promise.all([snapshotFileGraph(root, a), snapshotFileGraph(root, b)]);
  return architectureDiff(a, b, fromGraph, toGraph, changedFiles(root, a, b));
}

/** Evenly-spaced commits for the timeline slider. */
export function timeline(root: string, steps = 24): Commit[] {
  if (!isGitRepo(root)) return [];
  return sampleTimeline(listCommits(root, { max: 4000 }), steps);
}

function emptyEvolution(): EvolutionInsights {
  return {
    mostChangedModule: null, fastestGrowingSubsystem: null, mostStableSubsystem: null,
    newestArchitecturalLayer: null, mostVolatileDependency: null,
    couplingIncreasing: [], couplingDecreasing: [],
  };
}
