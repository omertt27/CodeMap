import path from "node:path";
import { toPosix } from "../util/paths.js";
import type { Lang, ImportRef } from "../graph/types.js";
import type { SyntaxNode } from "./runtime.js";
import type { ParsedSymbol } from "./ir.js";
import { TreeSitterParser, type FileRelationships } from "./parser.js";
import { descendants, line, mkSymbol, nameText, typeNamesIn, unquote } from "./ast.js";

const FN_VALUE_TYPES = new Set(["arrow_function", "function", "function_expression"]);

/**
 * Shared JavaScript/TypeScript parser. JS and TS differ only in the extensions
 * and grammars they use (TS adds interfaces/enums/type syntax), so both are thin
 * subclasses at the bottom of this file.
 */
abstract class JsTsParser extends TreeSitterParser {
  extractSymbols(root: SyntaxNode): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const visit = (node: SyntaxNode, exported: boolean) => {
      switch (node.type) {
        case "export_statement":
          for (const child of node.namedChildren) visit(child, true);
          return;
        case "function_declaration":
        case "generator_function_declaration": {
          const name = nameText(node);
          if (name) symbols.push(mkSymbol(name, "function", node, exported));
          return;
        }
        case "class_declaration":
        case "abstract_class_declaration": {
          const name = nameText(node);
          if (name) {
            const heritage = node.namedChildren.find((c) => c.type === "class_heritage");
            symbols.push(mkSymbol(name, "class", node, exported, {
              extends: typeNamesIn(heritage?.namedChildren.find((c) => c.type === "extends_clause") ?? null),
              implements: typeNamesIn(heritage?.namedChildren.find((c) => c.type === "implements_clause") ?? null),
            }));
            const body = node.childForFieldName("body");
            if (body) for (const member of body.namedChildren) {
              if (member.type === "method_definition") {
                const m = nameText(member);
                if (m) symbols.push(mkSymbol(m, "method", member, false, { parent: name }));
              } else if (member.type === "public_field_definition") {
                const f = nameText(member);
                if (f) symbols.push(mkSymbol(f, "variable", member, false, { parent: name }));
              }
            }
          }
          return;
        }
        case "interface_declaration": {
          const name = nameText(node);
          if (name) symbols.push(mkSymbol(name, "interface", node, exported));
          return;
        }
        case "enum_declaration": {
          const name = nameText(node);
          if (name) symbols.push(mkSymbol(name, "enum", node, exported));
          return;
        }
        case "lexical_declaration":
        case "variable_declaration": {
          for (const decl of node.namedChildren) {
            if (decl.type !== "variable_declarator") continue;
            const name = decl.childForFieldName("name");
            const value = decl.childForFieldName("value");
            if (!name) continue;
            const kind = value && FN_VALUE_TYPES.has(value.type) ? "function" : "variable";
            symbols.push(mkSymbol(name.text, kind, node, exported));
          }
          return;
        }
      }
      for (const child of node.namedChildren) visit(child, exported);
    };

    visit(root, false);
    return symbols;
  }

  extractRelationships(root: SyntaxNode): FileRelationships {
    const imports: ImportRef[] = [];
    const exports = new Set<string>();

    const visit = (node: SyntaxNode, exported: boolean) => {
      switch (node.type) {
        case "import_statement": {
          const src = node.childForFieldName("source");
          if (src) imports.push(mkImport(unquote(src.text), line(src)));
          return;
        }
        case "export_statement": {
          const src = node.childForFieldName("source");
          if (src) imports.push(mkImport(unquote(src.text), line(src)));
          for (const spec of descendants(node, "export_specifier")) {
            const name = spec.childForFieldName("name");
            if (name) exports.add(name.text);
          }
          if (node.text.includes("export default")) exports.add("default");
          for (const child of node.namedChildren) visit(child, true);
          return;
        }
        case "function_declaration":
        case "generator_function_declaration":
        case "class_declaration":
        case "abstract_class_declaration":
        case "interface_declaration":
        case "enum_declaration": {
          const name = nameText(node);
          if (exported && name) exports.add(name);
          return;
        }
        case "lexical_declaration":
        case "variable_declaration": {
          if (exported) {
            for (const decl of node.namedChildren) {
              const name = decl.type === "variable_declarator" ? decl.childForFieldName("name") : null;
              if (name) exports.add(name.text);
            }
          }
          break; // recurse into initializers to catch require()/import()
        }
        case "call_expression": {
          const fn = node.childForFieldName("function");
          const args = node.childForFieldName("arguments");
          if (fn && args && (fn.text === "require" || fn.type === "import")) {
            const strArg = args.namedChildren.find((c) => c.type === "string");
            if (strArg) imports.push(mkImport(unquote(strArg.text), line(node)));
          }
          break;
        }
      }
      for (const child of node.namedChildren) visit(child, exported);
    };

    visit(root, false);
    return { imports, exports: [...exports] };
  }

  resolveImport(raw: string, fromRel: string, files: ReadonlySet<string>): string | null {
    if (!raw.startsWith(".")) return null;
    const baseDir = posixDirname(fromRel);
    const target = toPosix(path.posix.normalize(path.posix.join(baseDir, raw)));
    return matchWithExtensions(target, files);
  }
}

// ---- resolution helpers --------------------------------------------------

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = JS_EXTS.map((e) => `index${e}`);

function matchWithExtensions(target: string, files: ReadonlySet<string>): string | null {
  if (files.has(target)) return target;
  for (const ext of JS_EXTS) if (files.has(target + ext)) return target + ext;
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

function mkImport(raw: string, ln: number): ImportRef {
  return { raw, resolved: null, external: false, line: ln };
}

function posixDirname(p: string): string {
  const d = path.posix.dirname(p);
  return d === "." ? "" : d;
}

// ---- concrete parsers ----------------------------------------------------

export class JavaScriptParser extends JsTsParser {
  readonly id: Lang = "javascript";
  readonly extensions = [".js", ".jsx", ".mjs", ".cjs"];
  protected grammarNames(): ("javascript")[] { return ["javascript"]; }
  protected grammarFor(): "javascript" { return "javascript"; }
}

export class TypeScriptParser extends JsTsParser {
  readonly id: Lang = "typescript";
  readonly extensions = [".ts", ".tsx"];
  protected grammarNames(): ("typescript" | "tsx")[] { return ["typescript", "tsx"]; }
  protected grammarFor(ext: string): "typescript" | "tsx" {
    return ext.toLowerCase() === ".tsx" ? "tsx" : "typescript";
  }
}
