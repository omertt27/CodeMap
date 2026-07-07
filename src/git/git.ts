import { execFileSync } from "node:child_process";

// A thin, self-contained wrapper over the `git` CLI. This is the ONLY module
// that shells out to git; everything else consumes these plain data structures.
// Nothing here knows about parsing, the graph, or rendering.

const SEP = "\x1f"; // unit separator, safe inside commit messages

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
}

export function isGitRepo(root: string): boolean {
  try {
    git(root, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  dateIso: string;
  subject: string;
}

export function listCommits(root: string, opts: { max?: number; range?: string } = {}): Commit[] {
  const fmt = ["%H", "%h", "%an", "%ae", "%aI", "%s"].join(SEP);
  const args = ["log", `--pretty=${fmt}`, "--no-merges"];
  if (opts.max) args.push(`--max-count=${opts.max}`);
  if (opts.range) args.push(opts.range);
  return git(root, args)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, author, email, dateIso, subject] = line.split(SEP);
      return { hash, shortHash, author, email, dateIso, subject };
    });
}

export function getBranches(root: string): string[] {
  try {
    return git(root, ["branch", "--format=%(refname:short)"]).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getTags(root: string): string[] {
  try {
    return git(root, ["tag"]).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveRev(root: string, rev: string): string | null {
  try {
    return git(root, ["rev-parse", rev]).trim();
  } catch {
    return null;
  }
}

export interface ChangedFile {
  status: "A" | "M" | "D" | "R" | "C";
  path: string;
  oldPath?: string;
}

/** Files changed between two revisions, with rename detection (-M). */
export function changedFiles(root: string, a: string, b: string): ChangedFile[] {
  const out = git(root, ["diff", "--name-status", "-M", a, b]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const code = parts[0][0] as ChangedFile["status"];
      if (code === "R" || code === "C") return { status: code, oldPath: parts[1], path: parts[2] };
      return { status: code, path: parts[1] };
    });
}

/** All file paths present at a revision (like a checkout listing, read-only). */
export function listTree(root: string, rev: string): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", rev]).split("\n").filter(Boolean);
}

/** File contents at a revision — never touches the working directory. */
export function showFile(root: string, rev: string, path: string): string {
  return git(root, ["show", `${rev}:${path}`]);
}

/**
 * Read many blobs at a revision in a single `git cat-file --batch` process
 * instead of one `git show` per file — a large speedup for big trees. Returns a
 * map of path → contents (missing/binary-unreadable paths are simply absent).
 */
export function readBlobs(root: string, rev: string, paths: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (!paths.length) return result;
  const input = paths.map((p) => `${rev}:${p}`).join("\n") + "\n";
  // No `encoding` → execFileSync returns a Buffer (contents may be binary).
  const out = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
    input,
    maxBuffer: 1 << 30,
  });

  let pos = 0;
  const NL = 0x0a;
  for (const p of paths) {
    const nl = out.indexOf(NL, pos);
    if (nl < 0) break;
    const header = out.subarray(pos, nl).toString("utf8");
    if (header.endsWith(" missing")) { pos = nl + 1; continue; }
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) break;
    result.set(p, out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    pos = nl + 1 + size + 1; // content + trailing newline
  }
  return result;
}

export interface FileStat {
  path: string;
  commits: number;
  insertions: number;
  deletions: number;
  authors: string[];
  firstDate: string;
  lastDate: string;
}

/**
 * Per-file history via `git log --numstat`: commit count, churn (insertions +
 * deletions), distinct authors, and first/last change dates. The basis for the
 * churn heatmap and stability score.
 */
export function fileHistory(root: string, range?: string): Map<string, FileStat> {
  const args = ["log", "--no-merges", "--numstat", `--format=__C__${SEP}%an${SEP}%aI`];
  if (range) args.push(range);
  const out = git(root, args);
  const map = new Map<string, FileStat & { authorSet: Set<string> }>();
  let author = "";
  let date = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("__C__")) {
      const p = line.split(SEP);
      author = p[1] ?? "";
      date = p[2] ?? "";
      continue;
    }
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const insertions = cols[0] === "-" ? 0 : parseInt(cols[0] || "0", 10);
    const deletions = cols[1] === "-" ? 0 : parseInt(cols[1] || "0", 10);
    const path = normalizeRenamePath(cols[2]);
    let s = map.get(path);
    if (!s) {
      s = { path, commits: 0, insertions: 0, deletions: 0, authors: [], authorSet: new Set(), firstDate: date, lastDate: date };
      map.set(path, s);
    }
    s.commits++;
    s.insertions += insertions;
    s.deletions += deletions;
    s.authorSet.add(author);
    if (date && date < s.firstDate) s.firstDate = date;
    if (date && date > s.lastDate) s.lastDate = date;
  }
  const result = new Map<string, FileStat>();
  for (const [path, s] of map) {
    result.set(path, { path, commits: s.commits, insertions: s.insertions, deletions: s.deletions, authors: [...s.authorSet], firstDate: s.firstDate, lastDate: s.lastDate });
  }
  return result;
}

/** `git`'s numstat renders renames as `{a => b}/c` or `old => new`; take the new path. */
function normalizeRenamePath(p: string): string {
  if (!p.includes("=>")) return p;
  return p.replace(/\{[^}]*=>\s*([^}]*)\}/g, "$1").replace(/^.*=>\s*/, "").replace(/\/\//g, "/").trim();
}
