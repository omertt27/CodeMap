import fs from "node:fs";
import path from "node:path";

// Architecture rules live in `repo-map.config.json` at the repo root. Everything
// has a sensible default, so the file is optional; when present it tunes God-
// module thresholds, entry points, and the layer rule system.

export interface Layer {
  name: string;
  patterns: string[]; // glob patterns, e.g. "src/components/**"
}

export interface LayerRule {
  from: string; // layer name
  cannotImport: string[]; // layer names it must not depend on
}

export interface Thresholds {
  loc: number;
  functions: number;
  classes: number;
  exports: number;
  dependents: number;
  /** How many thresholds must be exceeded to flag a "possible God module". */
  minSignals: number;
}

export interface AnalysisConfig {
  entryPoints: string[]; // glob patterns for reachability roots
  thresholds: Thresholds;
  layers: Layer[];
  rules: LayerRule[];
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  entryPoints: [
    "**/main.*", "**/index.*", "**/cli.*", "**/app.*", "**/server.*", "**/__init__.py",
    "**/*.test.*", "**/*.spec.*", "**/*_test.*", "test/**", "tests/**",
  ],
  thresholds: { loc: 300, functions: 20, classes: 6, exports: 15, dependents: 20, minSignals: 2 },
  layers: [],
  rules: [],
};

export function loadAnalysisConfig(root: string): AnalysisConfig {
  const file = path.join(path.resolve(root), "repo-map.config.json");
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* missing/invalid → all defaults */
  }
  return {
    entryPoints: Array.isArray(raw.entryPoints) ? (raw.entryPoints as string[]) : DEFAULT_CONFIG.entryPoints,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(raw.thresholds as object) },
    layers: Array.isArray(raw.layers) ? (raw.layers as Layer[]) : [],
    rules: Array.isArray(raw.rules) ? (raw.rules as LayerRule[]) : [],
  };
}

/**
 * Convert a glob to an anchored RegExp over POSIX paths:
 *  - `**\/` matches zero or more path segments (so `**\/main.*` also matches a
 *    root-level `main.ts`),
 *  - `**` matches anything,
 *  - `*` matches within a single segment, `?` matches one non-slash char.
 */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&"); // escape regex specials (not * ? /)
  const re = escaped
    .split("**/")
    .map((part) =>
      part
        .split("**")
        .map((seg) => seg.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
        .join(".*"),
    )
    .join("(?:.*/)?");
  return new RegExp("^" + re + "$");
}

export function matchesAny(p: string, patterns: string[]): boolean {
  return patterns.some((pat) => globToRegExp(pat).test(p));
}
