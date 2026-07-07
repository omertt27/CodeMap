import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { Lang } from "../graph/types.js";
import { langForExt } from "../languages/registry.js";
import { toPosix } from "../util/paths.js";

// Directories we never descend into: VCS metadata plus common generated/build
// output across ecosystems. `.gitignore` and config `exclude` add to this.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target", // Rust / Java (Maven, sbt)
  "bin",
  "obj", // .NET
  ".gradle",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".mypy_cache",
  ".pytest_cache",
  ".idea",
  ".vscode",
  ".codemap",
]);

export function langForFile(file: string): Lang | null {
  return langForExt(path.extname(file));
}

export interface WalkedFile {
  /** Absolute path on disk. */
  abs: string;
  /** Repo-relative POSIX path. */
  rel: string;
  lang: Lang;
}

export interface WalkOptions {
  /** Extra ignore patterns (gitignore syntax), added on top of .gitignore. */
  exclude?: string[];
  /** Restrict to these languages; omit/null for all supported languages. */
  languages?: Lang[] | null;
}

/**
 * Recursively collect all supported source files under `root`, honouring the
 * repository's `.gitignore`, the built-in `IGNORED_DIRS` defaults, and any
 * extra `exclude`/`languages` filters from config.
 */
export function walk(root: string, opts: WalkOptions = {}): WalkedFile[] {
  const out: WalkedFile[] = [];
  const ig = buildIgnore(root, opts.exclude);
  const langFilter = opts.languages && opts.languages.length ? new Set(opts.languages) : null;
  const stack: string[] = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, abs));
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") && !isAllowedDotDir(entry.name)) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (ig && ig.ignores(rel + "/")) continue; // gitignored directory
        stack.push(abs);
      } else if (entry.isFile()) {
        const lang = langForFile(entry.name);
        if (!lang) continue;
        if (langFilter && !langFilter.has(lang)) continue;
        if (ig && ig.ignores(rel)) continue; // gitignored file
        out.push({ abs, rel, lang });
      }
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/** Build an ignore matcher from the repo's `.gitignore` plus extra patterns. */
function buildIgnore(root: string, extra?: string[]): Ignore | null {
  let ig: Ignore | null = null;
  try {
    ig = ignore().add(fs.readFileSync(path.join(root, ".gitignore"), "utf8"));
  } catch {
    /* no .gitignore */
  }
  if (extra && extra.length) (ig ??= ignore()).add(extra);
  return ig;
}

function isAllowedDotDir(name: string): boolean {
  // Allow dot-dirs that commonly hold real source (e.g. ".github" scripts).
  return name === ".github";
}
