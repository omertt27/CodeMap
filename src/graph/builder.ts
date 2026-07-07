import path from "node:path";
import type { ParsedFile, ParsedSymbol, SymbolKind } from "../languages/ir.js";
import type { CodeGraph, CodeGraphStats, EdgeType, GraphEdge, GraphNode, NodeType } from "./model.js";

// Converts parser IR into the generic graph. This module is deliberately
// language-unaware: it reads only ParsedFile/ParsedSymbol and never asks which
// language produced them. Parsing and graph construction stay fully separate.

const KIND_TO_NODE: Record<SymbolKind, NodeType> = {
  class: "Class",
  function: "Function",
  method: "Method",
  interface: "Interface",
  enum: "Enum",
  variable: "Variable",
};

export function buildCodeGraph(root: string, files: ParsedFile[]): CodeGraph {
  const builder = new GraphAssembler(root);
  for (const file of files) builder.addFile(file);
  builder.linkInheritance();
  return builder.finish();
}

class GraphAssembler {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private repoId: string;
  /** name → symbol-node ids, for resolving extends/implements by name. */
  private byName = new Map<string, string[]>();
  private pending: { source: string; names: string[]; type: EdgeType; targetKinds: NodeType[] }[] = [];

  constructor(private root: string) {
    this.repoId = `repo:${root}`;
    this.addNode({ id: this.repoId, type: "Repository", name: path.basename(root) || root, path: "" });
  }

  addFile(file: ParsedFile): void {
    const fileId = `file:${file.path}`;
    const dirId = this.ensureDir(posixDir(file.path));
    this.addNode({
      id: fileId, type: "File", name: path.posix.basename(file.path),
      path: file.path, language: file.language, size: file.size, loc: file.loc,
    });
    this.addEdge("CONTAINS", dirId, fileId);

    // Symbol nodes + structural/declaration edges.
    const localByName = new Map<string, string>(); // symbol name → id, within this file
    for (const sym of file.symbols) {
      const symId = symbolId(file.path, sym);
      this.addNode({
        id: symId, type: KIND_TO_NODE[sym.kind], name: sym.name,
        path: file.path, language: file.language, line: sym.line,
        kind: sym.kind, exported: sym.exported, doc: sym.doc,
      });
      localByName.set(sym.name, symId);
      index(this.byName, sym.name, symId);

      if (sym.parent) {
        const parentId = localByName.get(sym.parent);
        if (parentId) this.addEdge("CONTAINS", parentId, symId); // class → method/field
        else this.addEdge("DECLARES", fileId, symId);
      } else {
        this.addEdge("DECLARES", fileId, symId);
        if (sym.exported) this.addEdge("EXPORTS", fileId, symId);
      }

      // Defer inheritance edges until every file's symbols are indexed.
      if (sym.extends?.length) this.pending.push({ source: symId, names: sym.extends, type: "EXTENDS", targetKinds: ["Class"] });
      if (sym.implements?.length) this.pending.push({ source: symId, names: sym.implements, type: "IMPLEMENTS", targetKinds: ["Interface", "Class"] });
    }

    // Import edges: file → file (internal) or file → package (external).
    for (const imp of file.imports) {
      if (imp.resolved) {
        this.addEdge("IMPORTS", fileId, `file:${imp.resolved}`);
      } else {
        const pkgId = `pkg:${imp.raw}`;
        this.addNode({ id: pkgId, type: "Package", name: imp.raw, external: true });
        this.addEdge("IMPORTS", fileId, pkgId);
      }
    }
  }

  /** Resolve extends/implements names to symbol nodes (best-effort, by unique name). */
  linkInheritance(): void {
    for (const p of this.pending) {
      for (const name of p.names) {
        const target = this.resolveByName(name, p.targetKinds);
        if (target) this.addEdge(p.type, p.source, target);
      }
    }
  }

  finish(): CodeGraph {
    const nodes = [...this.nodes.values()];
    const edges = [...this.edges.values()];
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      root: this.root,
      stats: computeStats(nodes, edges),
      nodes,
      edges,
    };
  }

  // ---- internals ---------------------------------------------------------

  private ensureDir(dir: string): string {
    if (dir === "") return this.repoId;
    const dirId = `dir:${dir}`;
    if (!this.nodes.has(dirId)) {
      this.addNode({ id: dirId, type: "Directory", name: path.posix.basename(dir), path: dir });
      this.addEdge("CONTAINS", this.ensureDir(posixDir(dir)), dirId); // link to parent
    }
    return dirId;
  }

  private resolveByName(name: string, kinds: NodeType[]): string | null {
    const simple = name.split(".").pop()!; // strip any qualifier
    const ids = this.byName.get(simple);
    if (!ids) return null;
    const matches = ids.filter((id) => kinds.includes(this.nodes.get(id)!.type));
    return matches.length === 1 ? matches[0] : null; // unambiguous only
  }

  private addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  private addEdge(type: EdgeType, source: string, target: string): void {
    const id = `${type}:${source}->${target}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, type, source, target });
  }
}

// ---- helpers -------------------------------------------------------------

function symbolId(filePath: string, sym: ParsedSymbol): string {
  return `sym:${filePath}#${sym.kind}:${sym.name}@${sym.line}`;
}

function posixDir(p: string): string {
  const d = path.posix.dirname(p);
  return d === "." ? "" : d;
}

function index(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function computeStats(nodes: GraphNode[], edges: GraphEdge[]): CodeGraphStats {
  const count = (t: NodeType) => nodes.filter((n) => n.type === t).length;
  const languages: Record<string, number> = {};
  for (const n of nodes) if (n.type === "File" && n.language) languages[n.language] = (languages[n.language] ?? 0) + 1;
  let primaryLanguage: string | null = null;
  let max = 0;
  for (const [lang, n] of Object.entries(languages)) if (n > max) { max = n; primaryLanguage = lang; }
  return {
    files: count("File"),
    directories: count("Directory"),
    classes: count("Class"),
    interfaces: count("Interface"),
    enums: count("Enum"),
    functions: count("Function"),
    methods: count("Method"),
    variables: count("Variable"),
    imports: edges.filter((e) => e.type === "IMPORTS").length,
    packages: count("Package"),
    languages,
    primaryLanguage,
  };
}
