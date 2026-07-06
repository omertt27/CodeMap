import fs from "node:fs";
import path from "node:path";
import type { Lang } from "./graph/types.js";

// Optional `.codemap.json` at the repo root. Everything has a sensible default,
// so the file is entirely optional.
//
//   {
//     "exclude":   ["**/*.min.js", "vendor/"],   // extra ignore patterns (gitignore syntax)
//     "languages": ["typescript", "python"]        // restrict to a subset; omit for all
//   }

export interface CodemapConfig {
  /** Extra ignore patterns, added on top of .gitignore and built-in defaults. */
  exclude: string[];
  /** Restrict scanning to these languages; null means all registered languages. */
  languages: Lang[] | null;
}

export const DEFAULT_CONFIG: CodemapConfig = { exclude: [], languages: null };

export function loadConfig(root: string): CodemapConfig {
  const file = path.join(path.resolve(root), ".codemap.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return DEFAULT_CONFIG; // missing or invalid → defaults
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    exclude: Array.isArray(obj.exclude) ? obj.exclude.map(String) : [],
    languages:
      Array.isArray(obj.languages) && obj.languages.length ? (obj.languages as Lang[]) : null,
  };
}
