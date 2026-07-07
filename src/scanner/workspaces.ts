import fs from "node:fs";
import path from "node:path";
import { toPosix } from "../util/paths.js";
import type { Graph } from "../graph/types.js";

// Monorepo awareness: detect workspace packages so a large company codebase can
// be viewed and analysed by *package boundary* rather than one flat graph.
// Detection is deterministic and read-only (a few config files); no scanning of
// node_modules. Nothing here depends on parsing or rendering.

/** Repo-relative package directories, longest-first (for prefix matching). */
export function detectWorkspaces(root: string): string[] {
  const abs = path.resolve(root);
  const globs: string[] = [];

  // npm/yarn/bun: package.json "workspaces"
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(abs, "package.json"), "utf8"));
    if (Array.isArray(pkg.workspaces)) globs.push(...pkg.workspaces);
    else if (Array.isArray(pkg.workspaces?.packages)) globs.push(...pkg.workspaces.packages);
  } catch {
    /* no root package.json */
  }
  // pnpm: pnpm-workspace.yaml
  try {
    for (const line of fs.readFileSync(path.join(abs, "pnpm-workspace.yaml"), "utf8").split("\n")) {
      const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/);
      if (m) globs.push(m[1].trim());
    }
  } catch {
    /* not a pnpm workspace */
  }

  const dirs = new Set<string>();
  for (const g of globs) {
    for (const d of expandGlob(abs, g)) {
      if (fs.existsSync(path.join(abs, d, "package.json"))) dirs.add(toPosix(d));
    }
  }
  return [...dirs].sort((a, b) => b.length - a.length);
}

/** Expand a workspace glob like "packages/*" to the matching directories. */
function expandGlob(abs: string, glob: string): string[] {
  const clean = glob.replace(/\/+$/, "");
  const star = clean.indexOf("*");
  if (star < 0) return [clean];
  const base = clean.slice(0, star).replace(/\/+$/, "");
  try {
    return fs
      .readdirSync(path.join(abs, base), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => toPosix(base ? path.join(base, e.name) : e.name));
  } catch {
    return [];
  }
}

/** The package a repo-relative path belongs to (or "(root)"). */
export function packageOf(filePath: string, packageDirs: string[]): string {
  for (const d of packageDirs) if (filePath === d || filePath.startsWith(d + "/")) return d;
  return "(root)";
}

export interface PackageRollup {
  name: string;
  files: number;
  loc: number;
  dependsOn: string[]; // other packages this one imports from
}

/** Per-package file/LOC counts and cross-package dependencies. */
export function packageRollup(graph: Graph, packageDirs: string[]): PackageRollup[] {
  const pkgOf = new Map<string, string>();
  const files = new Map<string, number>();
  const loc = new Map<string, number>();
  for (const n of graph.nodes) {
    const p = packageOf(n.path, packageDirs);
    pkgOf.set(n.id, p);
    files.set(p, (files.get(p) ?? 0) + 1);
    loc.set(p, (loc.get(p) ?? 0) + n.loc);
  }
  const deps = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const a = pkgOf.get(e.source), b = pkgOf.get(e.target);
    if (a && b && a !== b) (deps.get(a) ?? deps.set(a, new Set()).get(a)!).add(b);
  }
  return [...files.keys()]
    .map((name) => ({ name, files: files.get(name)!, loc: loc.get(name) ?? 0, dependsOn: [...(deps.get(name) ?? [])].sort() }))
    .sort((a, b) => b.files - a.files);
}
