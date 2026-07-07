import path from "node:path";
import { toPosix } from "../util/paths.js";
import type { Lang, ImportRef } from "../graph/types.js";
import type { SyntaxNode } from "./runtime.js";
import type { ParsedSymbol } from "./ir.js";
import { TreeSitterParser, type FileRelationships } from "./parser.js";
import { line, mkSymbol, nameText } from "./ast.js";

const isPublic = (name: string) => !name.startsWith("_");

export class PythonParser extends TreeSitterParser {
  readonly id: Lang = "python";
  readonly extensions = [".py"];
  protected grammarNames(): ("python")[] { return ["python"]; }
  protected grammarFor(): "python" { return "python"; }

  extractSymbols(root: SyntaxNode): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const handleTop = (raw: SyntaxNode) => {
      const node = unwrapDecorated(raw);
      switch (node.type) {
        case "function_definition": {
          const name = nameText(node);
          if (name) symbols.push(mkSymbol(name, "function", node, isPublic(name), { doc: docstringOf(node) }));
          return;
        }
        case "class_definition": {
          const name = nameText(node);
          if (!name) return;
          symbols.push(mkSymbol(name, "class", node, isPublic(name), {
            extends: superclasses(node),
            doc: docstringOf(node),
          }));
          const body = node.childForFieldName("body");
          if (body) for (const raw2 of body.namedChildren) {
            const member = unwrapDecorated(raw2);
            if (member.type === "function_definition") {
              const m = nameText(member);
              if (m) symbols.push(mkSymbol(m, "method", member, isPublic(m), { parent: name, doc: docstringOf(member) }));
            }
          }
          return;
        }
        case "expression_statement": {
          // Module-level assignment → a top-level variable/constant.
          const assign = node.namedChildren.find((c) => c.type === "assignment");
          const target = assign?.childForFieldName("left");
          if (target && target.type === "identifier") {
            symbols.push(mkSymbol(target.text, "variable", node, isPublic(target.text)));
          }
          return;
        }
      }
    };

    for (const child of root.namedChildren) handleTop(child);
    return symbols;
  }

  extractRelationships(root: SyntaxNode): FileRelationships {
    const imports: ImportRef[] = [];
    const exports = new Set<string>();

    const visit = (node: SyntaxNode, topLevel: boolean) => {
      switch (node.type) {
        case "import_statement": {
          for (const child of node.namedChildren) {
            const mod = moduleName(child);
            if (mod) imports.push(mkImport(mod, line(node)));
          }
          return;
        }
        case "import_from_statement": {
          const modNode = node.childForFieldName("module_name");
          let mod = modNode ? modNode.text : "";
          const dots = countLeadingDots(node);
          if (dots > 0 && !mod.startsWith(".")) mod = ".".repeat(dots) + mod;
          if (mod) imports.push(mkImport(mod, line(node)));
          return;
        }
        case "function_definition":
        case "class_definition": {
          if (topLevel) {
            const name = nameText(node);
            if (name && isPublic(name)) exports.add(name);
          }
          return;
        }
      }
      const childTop = topLevel && node.type === "module";
      for (const child of node.namedChildren) visit(child, childTop);
    };

    for (const child of root.namedChildren) visit(child, root.type === "module");
    return { imports, exports: [...exports] };
  }

  resolveImport(raw: string, fromRel: string, files: ReadonlySet<string>): string | null {
    const dots = leadingDots(raw);
    if (dots > 0) {
      const rest = raw.slice(dots);
      let dir = posixDirname(fromRel);
      for (let i = 1; i < dots; i++) dir = posixDirname(dir);
      const sub = rest ? rest.split(".").join("/") : "";
      const base = sub ? path.posix.join(dir, sub) : dir;
      return matchPython(base, files);
    }
    return matchPython(raw.split(".").join("/"), files);
  }
}

// ---- helpers -------------------------------------------------------------

function unwrapDecorated(node: SyntaxNode): SyntaxNode {
  if (node.type !== "decorated_definition") return node;
  return node.childForFieldName("definition") ?? node.namedChildren[node.namedChildren.length - 1] ?? node;
}

function superclasses(node: SyntaxNode): string[] {
  const args = node.childForFieldName("superclasses");
  if (!args) return [];
  return args.namedChildren
    .filter((c) => c.type === "identifier" || c.type === "attribute")
    .map((c) => c.text);
}

function docstringOf(node: SyntaxNode): string | undefined {
  const body = node.type === "module" ? node : node.childForFieldName("body");
  const first = body?.namedChildren[0];
  if (first?.type === "expression_statement" && first.namedChildren[0]?.type === "string") {
    return stripPyString(first.namedChildren[0].text);
  }
  return undefined;
}

function stripPyString(s: string): string {
  return s.replace(/^[rbuf]*("""|'''|"|')/i, "").replace(/("""|'''|"|')$/, "").trim();
}

function moduleName(node: SyntaxNode): string | null {
  if (node.type === "dotted_name") return node.text;
  if (node.type === "aliased_import") return node.childForFieldName("name")?.text ?? null;
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

function matchPython(base: string, files: ReadonlySet<string>): string | null {
  const normalized = base ? toPosix(path.posix.normalize(base)) : "";
  if (files.has(normalized + ".py")) return normalized + ".py";
  const init = path.posix.join(normalized, "__init__.py");
  if (files.has(init)) return init;
  return null;
}

function leadingDots(s: string): number {
  let n = 0;
  while (s[n] === ".") n++;
  return n;
}

function mkImport(raw: string, ln: number): ImportRef {
  return { raw, resolved: null, external: false, line: ln };
}

function posixDirname(p: string): string {
  const d = path.posix.dirname(p);
  return d === "." ? "" : d;
}
