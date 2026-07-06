import path from "node:path";
import { toPosix } from "../util/paths.js";
import type { ImportRef, SymbolInfo } from "../graph/types.js";
import type { SyntaxNode } from "./runtime.js";
import type { FileFacts, LanguagePlugin } from "./types.js";

function extractPython(root: SyntaxNode): FileFacts {
  const imports: ImportRef[] = [];
  const exports = new Set<string>();
  const functions: SymbolInfo[] = [];
  const classes: SymbolInfo[] = [];
  const isPublic = (name: string) => !name.startsWith("_");

  const walkNode = (node: SyntaxNode, topLevel: boolean) => {
    switch (node.type) {
      case "import_statement": {
        for (const child of node.namedChildren) {
          const mod = moduleName(child);
          if (mod) imports.push(mkImport(mod, node.startPosition.row + 1));
        }
        return;
      }
      case "import_from_statement": {
        const modNode = node.childForFieldName("module_name");
        let mod = modNode ? modNode.text : "";
        const dots = countLeadingDots(node);
        if (dots > 0 && !mod.startsWith(".")) mod = ".".repeat(dots) + mod;
        if (mod) imports.push(mkImport(mod, node.startPosition.row + 1));
        return;
      }
      case "function_definition": {
        const name = node.childForFieldName("name");
        if (name) {
          const exported = topLevel && isPublic(name.text);
          if (exported) exports.add(name.text);
          functions.push(sym(name.text, "function", node, exported));
        }
        return;
      }
      case "class_definition": {
        const name = node.childForFieldName("name");
        if (name) {
          const exported = topLevel && isPublic(name.text);
          if (exported) exports.add(name.text);
          classes.push(sym(name.text, "class", node, exported));
        }
        return;
      }
    }
    const childrenTopLevel = topLevel && node.type === "module";
    for (const child of node.namedChildren) walkNode(child, childrenTopLevel);
  };

  for (const child of root.namedChildren) walkNode(child, root.type === "module");
  return { imports, exports: [...exports], functions, classes };
}

// ---- resolution ----------------------------------------------------------

function resolvePython(raw: string, fromRel: string, files: ReadonlySet<string>): string | null {
  const dots = leadingDots(raw);
  if (dots > 0) {
    const rest = raw.slice(dots);
    let dir = posixDirname(fromRel);
    for (let i = 1; i < dots; i++) dir = posixDirname(dir);
    const sub = rest ? rest.split(".").join("/") : "";
    const base = sub ? path.posix.join(dir, sub) : dir;
    return matchPython(base, files, rest === "");
  }
  const base = raw.split(".").join("/");
  return matchPython(base, files, false);
}

function matchPython(base: string, files: ReadonlySet<string>, allowPackage: boolean): string | null {
  const normalized = base ? toPosix(path.posix.normalize(base)) : "";
  if (files.has(normalized + ".py")) return normalized + ".py";
  const pkgInit = path.posix.join(normalized, "__init__.py");
  if (files.has(pkgInit)) return pkgInit;
  if (allowPackage && normalized) {
    const init = path.posix.join(normalized, "__init__.py");
    if (files.has(init)) return init;
  }
  return null;
}

// ---- helpers -------------------------------------------------------------

function moduleName(node: SyntaxNode): string | null {
  if (node.type === "dotted_name") return node.text;
  if (node.type === "aliased_import") {
    const n = node.childForFieldName("name");
    return n ? n.text : null;
  }
  return null;
}

function countLeadingDots(node: SyntaxNode): number {
  let dots = 0;
  for (const child of node.children) {
    if (child.type === ".") dots++;
    else if (child.type === "import_prefix") dots += child.text.length;
    else if (dots > 0) break;
  }
  return dots;
}

function leadingDots(s: string): number {
  let n = 0;
  while (s[n] === ".") n++;
  return n;
}

function mkImport(raw: string, line: number): ImportRef {
  return { raw, resolved: null, external: false, line };
}

function sym(name: string, kind: "function" | "class", node: SyntaxNode, exported: boolean): SymbolInfo {
  return { name, kind, line: node.startPosition.row + 1, exported };
}

function posixDirname(p: string): string {
  const d = path.posix.dirname(p);
  return d === "." ? "" : d;
}

export const pythonPlugin: LanguagePlugin = {
  id: "python",
  extensions: [".py"],
  grammar: () => "python",
  extract: extractPython,
  resolve: resolvePython,
};
