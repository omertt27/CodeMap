// Result types for the architecture analyzer. Everything here is plain data so
// the analysis is trivially serializable and reusable by the CLI, UI, a future
// MCP server, an AI assistant, or CI checks. No UI or rendering concerns.

export type Severity = "low" | "medium" | "high";

/** Per-node dependency metrics (computed on demand for the sidebar). */
export interface NodeMetrics {
  id: string;
  path: string;
  inDegree: number;
  outDegree: number;
  directImports: number;
  directDependents: number;
  transitiveImports: number;
  transitiveDependents: number;
  /** Levels of imports below this file (dependency depth). */
  depth: number;
  centrality: number; // PageRank, 0..1
  hotspotScore: number; // 0..100
}

export interface Cycle {
  id: string;
  files: string[]; // repo-relative paths in the strongly-connected group
  length: number;
  severity: Severity;
  /** Heuristic edge to cut to break the cycle (source imports target). */
  suggestedBreak: { from: string; to: string } | null;
}

export interface Hotspot {
  id: string;
  path: string;
  score: number; // 0..100
  reasons: string[];
  dependents: number;
  dependencies: number;
  loc: number;
  exports: number;
  centrality: number;
}

export interface GodModule {
  id: string;
  path: string;
  reasons: string[]; // which thresholds were exceeded
  loc: number;
  functions: number;
  classes: number;
  exports: number;
  dependents: number;
}

export interface UnusedFile {
  id: string;
  path: string;
  reasons: string[]; // conservative signals; labelled "possibly unused"
}

export interface LayerViolation {
  from: string; // importing file
  to: string; // imported file
  fromLayer: string;
  toLayer: string;
  rule: string; // human-readable rule that was broken
}

export interface ArchitectureSummary {
  generatedAt: string;
  files: number;
  edges: number;
  cycles: number;
  hotspots: number;
  godModules: number;
  unused: number;
  layerViolations: number;
  mostCentral: string | null;
  languages: Record<string, number>;
}

export interface Analysis {
  summary: ArchitectureSummary;
  cycles: Cycle[];
  hotspots: Hotspot[];
  godModules: GodModule[];
  unused: UnusedFile[];
  layerViolations: LayerViolation[];
  /** Light per-node metrics for every file (degrees, centrality, score). */
  metrics: Record<string, { inDegree: number; outDegree: number; centrality: number; hotspotScore: number }>;
}
