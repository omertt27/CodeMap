import path from "node:path";
import { toPosix } from "../util/paths.js";
import type { ImportRef, SymbolInfo } from "../graph/types.js";
import type { GrammarName, SyntaxNode } from "./runtime.js";
import type { FileFacts } from "./types.js";

// Extraction + resolution shared by the JavaScript and TypeScript plugins.
// They differ only in id and which extensions/grammars they claim.

export function grammarForExt(ext: string): GrammarName {
  switch (ext.toLowerCase()) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    default:
      return "javascript"; // .js .jsx .mjs .cjs
  }
}

export function extractJsTs(root: SyntaxNode): FileFacts {
  const imports: ImportRef[] = [];
  const exports = new Set<string>();
  const functions: SymbolInfo[] = [];
  const classes: SymbolInfo[] = [];

  const walkNode = (node: SyntaxNode, exportedCtx: boolean) => {
    switch (node.type) {
      case "import_statement": {
        const src = node.childForFieldName("source");
        if (src) imports.push(mkImport(unquote(src.text), src.startPosition.row + 1));
        return;
      }
      case "export_statement": {
        const src = node.childForFieldName("source");
        if (src) imports.push(mkImport(unquote(src.text), src.startPosition.row + 1));
        for (const spec of descendants(node, "export_specifier")) {
          const name = spec.childForFieldName("name");
          if (name) exports.add(name.text);
        }
        if (node.text.includes("export default")) exports.add("default");
        for (const child of node.namedChildren) walkNode(child, true);
        return;
      }
      case "function_declaration":
      case "generator_function_declaration": {
        const name = node.childForFieldName("name");
        if (name) {
          if (exportedCtx) exports.add(name.text);
          functions.push(sym(name.text, "function", node, exportedCtx));
        }
        return;
      }
      case "class_declaration": {
        const name = node.childForFieldName("name");
        if (name) {
          if (exportedCtx) exports.add(name.text);
          classes.push(sym(name.text, "class", node, exportedCtx));
        }
        return;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const decl of node.namedChildren) {
          if (decl.type !== "variable_declarator") continue;
          const name = decl.childForFieldName("name");
          const value = decl.childForFieldName("value");
          if (!name) continue;
          if (value && (value.type === "arrow_function" || value.type === "function" || value.type === "function_expression")) {
            if (exportedCtx) exports.add(name.text);
            functions.push(sym(name.text, "function", node, exportedCtx));
          }
        }
        break; // recurse into initializers so `const x = require("…")` is seen
      }
      case "call_expression": {
        const fn = node.childForFieldName("function");
        const args = node.childForFieldName("arguments");
        if (fn && args && (fn.text === "require" || fn.type === "import")) {
          const strArg = args.namedChildren.find((c) => c.type === "string");
          if (strArg) imports.push(mkImport(unquote(strArg.text), node.startPosition.row + 1));
        }
        break; // still recurse for nested calls
      }
    }
    for (const child of node.namedChildren) walkNode(child, exportedCtx);
  };

  walkNode(root, false);
  return { imports, exports: [...exports], functions, classes };
}

// ---- resolution ----------------------------------------------------------

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = JS_EXTS.map((e) => `index${e}`);

export function resolveJsTs(raw: string, fromRel: string, files: ReadonlySet<string>): string | null {
  if (!raw.startsWith(".")) return null; // only relative specifiers hit repo files
  const baseDir = posixDirname(fromRel);
  const target = toPosix(path.posix.normalize(path.posix.join(baseDir, raw)));
  return matchWithExtensions(target, files);
}

function matchWithExtensions(target: string, files: ReadonlySet<string>): string | null {
  if (files.has(target)) return target;
  for (const ext of JS_EXTS) if (files.has(target + ext)) return target + ext;
  // TS/ESM writes `.js` specifiers that actually point at `.ts`/`.tsx` sources.
  const m = target.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) {
    const base = target.slice(0, -m[0].length);
    if (files.has(base + ".ts")) return base + ".ts";
    if (files.has(base + ".tsx")) return base + ".tsx";
  }
  for (const idx of INDEX_FILES) {
    const candidate = path.posix.join(target, idx);
    if (files.has(candidate)) return candidate;
  }
  return null;
}

// ---- helpers -------------------------------------------------------------

function descendants(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const stack = [...node.namedChildren];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === type) out.push(n);
    stack.push(...n.namedChildren);
  }
  return out;
}

function mkImport(raw: string, line: number): ImportRef {
  return { raw, resolved: null, external: false, line };
}

function sym(name: string, kind: "function" | "class", node: SyntaxNode, exported: boolean): SymbolInfo {
  return { name, kind, line: node.startPosition.row + 1, exported };
}

function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

function posixDirname(p: string): string {
  const d = path.posix.dirname(p);
  return d === "." ? "" : d;
}
