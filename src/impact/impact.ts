import type { DependencyIndex } from "../analysis/graph.js";
import type { Cycle } from "../analysis/types.js";
import { entryKind, isTestFile, stem } from "./detect.js";
import type { AffectedEntryPoint, AffectedNode, AffectedTest, ImpactReport } from "./types.js";

export interface ImpactContext {
  pageRank: Map<string, number>;
  maxCentrality: number;
  cycles: Cycle[];
}

/** Compute the blast radius of changing one file, via reverse dependency BFS. */
export function computeImpact(idx: DependencyIndex, targetId: string, ctx: ImpactContext): ImpactReport | null {
  const target = idx.byId.get(targetId);
  if (!target) return null;

  // Reverse BFS over dependents (in-edges): who imports the target, directly or
  // transitively. Track hop distance and the edge that first reached each node.
  const hop = new Map<string, number>([[targetId, 0]]);
  const parent = new Map<string, string>();
  let frontier = [targetId];
  let h = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const dependent of idx.in.get(cur) ?? []) {
        if (!hop.has(dependent)) { hop.set(dependent, h + 1); parent.set(dependent, cur); next.push(dependent); }
      }
    }
    h++;
    frontier = next;
  }

  const affectedIds = [...hop.keys()].filter((id) => id !== targetId);
  const affectedNodes: AffectedNode[] = affectedIds
    .map((id) => ({ id: idx.path(id), hop: hop.get(id)!, reason: `imports ${idx.path(parent.get(id)!)}` }))
    .sort((a, b) => a.hop - b.hop || a.id.localeCompare(b.id));

  const maxHop = affectedNodes.reduce((m, n) => Math.max(m, n.hop), 0);
  const affectedDirectories = [...new Set(affectedNodes.map((n) => dirOf(n.id)))].filter(Boolean).sort();

  // Likely affected tests: transitively-affected test files, plus a same-named
  // sibling test even if it doesn't import the target directly.
  const tests = new Map<string, AffectedTest>();
  for (const id of affectedIds) {
    const p = idx.path(id);
    if (isTestFile(p)) tests.set(p, { id: p, via: "import" });
  }
  const targetStem = stem(target.path);
  for (const n of idx.nodes) {
    if (n.id === targetId || !isTestFile(n.path)) continue;
    if (stem(n.path) === targetStem && !tests.has(n.path)) tests.set(n.path, { id: n.path, via: "naming" });
  }

  const entryPoints: AffectedEntryPoint[] = [];
  for (const id of affectedIds) {
    const kind = entryKind(idx.path(id));
    if (kind) entryPoints.push({ id: idx.path(id), kind });
  }

  const cyclesInvolving = ctx.cycles.filter((c) => c.files.includes(target.path)).map((c) => c.files);
  const inCycle = cyclesInvolving.length > 0;
  const centralityNorm = ctx.maxCentrality > 0 ? (ctx.pageRank.get(targetId) ?? 0) / ctx.maxCentrality : 0;

  const blastRadiusScore = scoreOf({
    affected: affectedIds.length,
    totalFiles: idx.nodes.length,
    maxHop,
    entryPoints: entryPoints.length,
    tests: tests.size,
    centralityNorm,
    inCycle,
  });

  return {
    target: target.path,
    targetId,
    generatedAt: new Date().toISOString(),
    blastRadiusScore,
    affectedFileCount: affectedIds.length,
    directDependents: idx.inDegree(targetId),
    transitiveDependents: affectedIds.length,
    maxHop,
    inCycle,
    affectedNodes,
    affectedDirectories,
    likelyAffectedTests: [...tests.values()].sort((a, b) => a.id.localeCompare(b.id)),
    affectedEntryPoints: entryPoints.sort((a, b) => a.id.localeCompare(b.id)),
    cycles: cyclesInvolving,
  };
}

interface ScoreInputs {
  affected: number; totalFiles: number; maxHop: number;
  entryPoints: number; tests: number; centralityNorm: number; inCycle: boolean;
}

/** Deterministic 0..100 blast-radius score (weights sum to 1). */
function scoreOf(x: ScoreInputs): number {
  if (x.affected === 0) return 0; // nothing depends on it → nothing breaks
  const affectedRatio = Math.sqrt(x.affected / x.totalFiles); // sqrt lifts mid-range
  const depthNorm = Math.min(1, x.maxHop / 6);
  const entryNorm = Math.min(1, x.entryPoints / 5);
  const testNorm = Math.min(1, x.tests / 8);
  return Math.round(
    100 *
      (0.35 * affectedRatio +
        0.15 * depthNorm +
        0.2 * entryNorm +
        0.1 * testNorm +
        0.1 * x.centralityNorm +
        0.1 * (x.inCycle ? 1 : 0)),
  );
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
