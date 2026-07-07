// Shapes served by the local server. Kept independent from the backend source
// so the UI is a self-contained module.

export type MapNodeType = "File" | "Directory" | "Package";

export interface MapNode {
  id: string;
  type: MapNodeType;
  name: string;
  path: string;
  language: string | null;
  loc: number;
  degree: number;
}

export interface MapEdge {
  id: string;
  type: "IMPORTS" | "CONTAINS";
  source: string;
  target: string;
}

export interface MapGraph {
  root: string;
  generatedAt: string;
  nodes: MapNode[];
  edges: MapEdge[];
  languages: string[];
}

// ---- architecture analysis (/api/insights, /api/metrics) ----

export interface ArchSummary {
  files: number; edges: number; cycles: number; hotspots: number;
  godModules: number; unused: number; layerViolations: number; mostCentral: string | null;
}
export interface CycleInsight {
  id: string; files: string[]; length: number;
  severity: "low" | "medium" | "high"; suggestedBreak: { from: string; to: string } | null;
}
export interface HotspotInsight {
  id: string; path: string; score: number; reasons: string[];
  dependents: number; dependencies: number; loc: number; exports: number;
}
export interface GodInsight { id: string; path: string; reasons: string[] }
export interface UnusedInsight { id: string; path: string; reasons: string[] }
export interface LayerViolationInsight { from: string; to: string; fromLayer: string; toLayer: string; rule: string }

export interface Insights {
  summary: ArchSummary;
  cycles: CycleInsight[];
  hotspots: HotspotInsight[];
  godModules: GodInsight[];
  unused: UnusedInsight[];
  layerViolations: LayerViolationInsight[];
}

export interface ImpactReport {
  target: string;
  targetId: string;
  blastRadiusScore: number;
  affectedFileCount: number;
  directDependents: number;
  transitiveDependents: number;
  maxHop: number;
  inCycle: boolean;
  affectedNodes: { id: string; hop: number; reason: string }[];
  affectedDirectories: string[];
  likelyAffectedTests: { id: string; via: string }[];
  affectedEntryPoints: { id: string; kind: string }[];
  cycles: string[][];
}

// ---- git evolution (/api/history, /api/timeline, /api/snapshot, /api/diff) ----

export interface Commit {
  hash: string; shortHash: string; author: string; email: string; dateIso: string; subject: string;
}
export interface ChurnEntry { path: string; commits: number; churn: number; authors: number; score: number; level: string }
export interface StabilityEntry { path: string; stability: number; commits: number; authors: number; churn: number }
export interface EvolutionInsights {
  mostChangedModule: string | null; fastestGrowingSubsystem: string | null; mostStableSubsystem: string | null;
  newestArchitecturalLayer: string | null; mostVolatileDependency: string | null;
  couplingIncreasing: { module: string; before: number; after: number }[];
  couplingDecreasing: { module: string; before: number; after: number }[];
}
export interface HistoryReport {
  isRepo: boolean; commits: Commit[]; branches: string[]; tags: string[];
  churn: ChurnEntry[]; stability: StabilityEntry[]; evolution: EvolutionInsights;
}
export interface ArchitectureDiff {
  from: string; to: string;
  addedFiles: string[]; removedFiles: string[]; movedFiles: { from: string; to: string }[];
  addedDependencies: { from: string; to: string }[]; removedDependencies: { from: string; to: string }[];
  newCycles: string[][]; removedCycles: string[][];
  hotspotChanges: { path: string; before: number; after: number; delta: number }[];
  couplingChanges: { path: string; before: number; after: number; delta: number }[];
}

export interface NodeMetricsData {
  inDegree: number; outDegree: number;
  directImports: number; directDependents: number;
  transitiveImports: number; transitiveDependents: number;
  depth: number; centrality: number; hotspotScore: number;
}

/** Lazy per-file detail from /api/file (the parser's file-level record). */
export interface FileDetail {
  id: string;
  path: string;
  name: string;
  lang: string;
  loc: number;
  imports: { raw: string; resolved: string | null; external: boolean; line: number }[];
  exports: string[];
  functions: { name: string; kind: string; line: number; exported: boolean }[];
  classes: { name: string; kind: string; line: number; exported: boolean }[];
}
