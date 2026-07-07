import fs from "node:fs";
import path from "node:path";

// Governance rules live in `codemap.config.json` at the repo root. Everything has
// a sensible default, so the file is optional. Layer-based custom rules
// (e.g. "controllers may not import repositories") reuse `repo-map.config.json`.

export interface Thresholds {
  maxDependencyDepth: number;
  maxFunctionCount: number;
  maxImports: number; // fan-out
  maxFanIn: number;
  maxCoupling: number; // fan-in + fan-out
  maxFileSize: number; // LOC
  allowCircularDependencies: boolean;
}

export interface ForbiddenImport {
  from: string; // glob over importing file path
  to: string; // glob over imported file path
  message?: string;
}

export type FailLevel = "error" | "warning" | "none";

export interface GovernanceConfig {
  rules: Thresholds;
  forbiddenImports: ForbiddenImport[];
  failOn: FailLevel;
}

export const DEFAULT_GOVERNANCE: GovernanceConfig = {
  rules: {
    maxDependencyDepth: 10,
    maxFunctionCount: 40,
    maxImports: 25,
    maxFanIn: 30,
    maxCoupling: 45,
    maxFileSize: 500,
    allowCircularDependencies: false,
  },
  forbiddenImports: [],
  failOn: "error",
};

export function loadGovernanceConfig(root: string): GovernanceConfig {
  const file = path.join(path.resolve(root), "codemap.config.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* missing → defaults */
  }
  return {
    rules: { ...DEFAULT_GOVERNANCE.rules, ...(raw.rules as object) },
    forbiddenImports: Array.isArray(raw.forbiddenImports) ? (raw.forbiddenImports as ForbiddenImport[]) : [],
    failOn: (raw.failOn as FailLevel) ?? DEFAULT_GOVERNANCE.failOn,
  };
}
