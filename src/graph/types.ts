// Core data model for a CodeMap graph.
// Kept intentionally small and JSON-serializable so it can be stored as a flat
// file today and moved behind SQLite later without changing consumers.

export type Lang = "python" | "javascript" | "typescript" | "java";

/** A declaration (function or class) found inside a file. */
export interface SymbolInfo {
  name: string;
  kind: "function" | "class";
  line: number; // 1-based line of the declaration
  exported: boolean;
}

/** A raw import as written in source, plus how we resolved it (if we could). */
export interface ImportRef {
  /** The module specifier exactly as written, e.g. "./utils" or "os.path". */
  raw: string;
  /** Repo-relative path this resolved to, or null if external/unresolved. */
  resolved: string | null;
  /** True when the import points outside the repo (a dependency/package). */
  external: boolean;
  line: number;
}

/** Everything we extract from a single source file. */
export interface FileNode {
  /** Stable node id, always `file:<repoRelativePath>`. */
  id: string;
  /** Repo-relative POSIX path. */
  path: string;
  /** Basename, for display/search. */
  name: string;
  /** Containing directory (repo-relative POSIX path, "" for root). */
  dir: string;
  lang: Lang;
  loc: number; // lines of code (raw line count)
  size: number; // bytes on disk
  imports: ImportRef[];
  exports: string[]; // names this file exports
  functions: SymbolInfo[];
  classes: SymbolInfo[];
}

/** A directed dependency edge, file -> file, one per resolved import. */
export interface Edge {
  id: string;
  source: string; // FileNode id
  target: string; // FileNode id
  type: "import";
  raw: string; // original specifier
}

export interface GraphStats {
  files: number;
  edges: number;
  languages: Record<string, number>;
  functions: number;
  classes: number;
}

export interface Graph {
  version: 1;
  root: string; // absolute path that was scanned
  generatedAt: string; // ISO timestamp
  stats: GraphStats;
  nodes: FileNode[];
  edges: Edge[];
}

/**
 * A function or class promoted to a first-class graph node. Derived from the
 * `functions`/`classes` metadata on file nodes so storage stays lean.
 */
export interface SymbolNode {
  id: string; // `sym:<path>#<kind>:<name>@<line>`
  name: string;
  kind: "function" | "class";
  file: string; // owning FileNode id
  path: string; // owning file's repo-relative path
  lang: Lang;
  line: number;
  exported: boolean;
}

/** A containment edge: a file "contains" a symbol. */
export interface ContainsEdge {
  id: string;
  source: string; // FileNode id
  target: string; // SymbolNode id
  type: "contains";
}

export interface SymbolGraph {
  symbols: SymbolNode[];
  contains: ContainsEdge[];
}
