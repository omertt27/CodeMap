// Stable impact-analysis result. Plain data so the CLI, UI, a future MCP server,
// an AI assistant, or CI can all consume it. Answers: "what breaks if I change
// this file?" — deterministically, from the dependency graph alone.

export interface AffectedNode {
  id: string; // repo-relative path
  hop: number; // 0 = target, 1 = direct dependent, 2+ = transitive
  reason: string; // e.g. "imports src/auth/session.ts"
}

export interface AffectedTest {
  id: string;
  via: "import" | "naming"; // transitively imports the target, or matches its name
}

export interface AffectedEntryPoint {
  id: string;
  kind: string; // "main" | "api route" | "page/route" | ...
}

export interface ImpactReport {
  target: string; // repo-relative path
  targetId: string; // graph node id (file:<path>)
  generatedAt: string;
  blastRadiusScore: number; // 0..100
  affectedFileCount: number; // transitive dependents
  directDependents: number;
  transitiveDependents: number;
  maxHop: number;
  inCycle: boolean;
  affectedNodes: AffectedNode[];
  affectedDirectories: string[];
  likelyAffectedTests: AffectedTest[];
  affectedEntryPoints: AffectedEntryPoint[];
  cycles: string[][]; // cycles the target participates in (files)
}
