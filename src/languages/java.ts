import type { Lang, ImportRef } from "../graph/types.js";
import type { SyntaxNode } from "./runtime.js";
import type { ParsedSymbol } from "./ir.js";
import { TreeSitterParser, type FileRelationships } from "./parser.js";
import { line, mkSymbol, nameText } from "./ast.js";

const isPublic = (node: SyntaxNode) => {
  const mods = node.namedChildren.find((c) => c.type === "modifiers");
  return !!mods && /\bpublic\b/.test(mods.text);
};

export class JavaParser extends TreeSitterParser {
  readonly id: Lang = "java";
  readonly extensions = [".java"];
  protected grammarNames(): ("java")[] { return ["java"]; }
  protected grammarFor(): "java" { return "java"; }

  extractSymbols(root: SyntaxNode): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    const visit = (node: SyntaxNode) => {
      switch (node.type) {
        case "class_declaration":
        case "interface_declaration":
        case "enum_declaration": {
          const name = nameText(node);
          if (name) {
            const kind = node.type === "interface_declaration" ? "interface" : node.type === "enum_declaration" ? "enum" : "class";
            symbols.push(mkSymbol(name, kind, node, isPublic(node), {
              extends: typeNames(node.childForFieldName("superclass")),
              implements: typeNames(node.childForFieldName("interfaces")),
            }));
            const body = node.childForFieldName("body");
            if (body) for (const member of body.namedChildren) {
              if (member.type === "method_declaration") {
                const m = nameText(member);
                if (m) symbols.push(mkSymbol(m, "method", member, isPublic(member), { parent: name }));
              } else if (member.type === "field_declaration") {
                for (const decl of member.namedChildren.filter((c) => c.type === "variable_declarator")) {
                  const f = nameText(decl);
                  if (f) symbols.push(mkSymbol(f, "variable", member, isPublic(member), { parent: name }));
                }
              }
            }
          }
          break; // recurse to reach nested types
        }
      }
      for (const child of node.namedChildren) visit(child);
    };

    visit(root);
    return symbols;
  }

  extractRelationships(root: SyntaxNode): FileRelationships {
    const imports: ImportRef[] = [];
    const exports = new Set<string>();

    const visit = (node: SyntaxNode) => {
      switch (node.type) {
        case "import_declaration": {
          const id = node.namedChildren.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
          const wildcard = node.namedChildren.some((c) => c.type === "asterisk");
          if (id) imports.push(mkImport(wildcard ? id.text + ".*" : id.text, line(node)));
          return;
        }
        case "class_declaration":
        case "interface_declaration":
        case "enum_declaration": {
          const name = nameText(node);
          if (name && isPublic(node)) exports.add(name);
          break;
        }
      }
      for (const child of node.namedChildren) visit(child);
    };

    visit(root);
    return { imports, exports: [...exports] };
  }

  resolveImport(raw: string, _fromRel: string, files: ReadonlySet<string>): string | null {
    if (raw.endsWith(".*")) return null; // wildcard package import
    const rel = raw.split(".").join("/") + ".java";
    if (files.has(rel)) return rel;
    const suffix = "/" + rel;
    for (const f of files) if (f.endsWith(suffix)) return f;
    return null;
  }
}

/** Type names inside a `superclass`/`interfaces` clause (identifiers only). */
function typeNames(clause: SyntaxNode | null): string[] {
  if (!clause) return [];
  const out: string[] = [];
  const stack = [...clause.namedChildren];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "type_identifier" || n.type === "scoped_type_identifier") out.push(n.text.replace(/<.*$/s, "").trim());
    else stack.push(...n.namedChildren);
  }
  return out;
}

function mkImport(raw: string, ln: number): ImportRef {
  return { raw, resolved: null, external: false, line: ln };
}
