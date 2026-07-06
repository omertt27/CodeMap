import type { ImportRef, SymbolInfo } from "../graph/types.js";
import type { SyntaxNode } from "./runtime.js";
import type { FileFacts, LanguagePlugin } from "./types.js";

// Java plugin. Demonstrates the plugin boundary with a package/class model very
// different from JS/Python: imports are fully-qualified class paths, and each
// public class lives in a file named after it, so `import a.b.C` resolves to a
// file path ending in `a/b/C.java`.

function extractJava(root: SyntaxNode): FileFacts {
  const imports: ImportRef[] = [];
  const exports = new Set<string>();
  const functions: SymbolInfo[] = [];
  const classes: SymbolInfo[] = [];

  const isPublic = (node: SyntaxNode) => {
    const mods = node.namedChildren.find((c) => c.type === "modifiers");
    return !!mods && /\bpublic\b/.test(mods.text);
  };

  const walk = (node: SyntaxNode) => {
    switch (node.type) {
      case "import_declaration": {
        const id = node.namedChildren.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
        const wildcard = node.namedChildren.some((c) => c.type === "asterisk");
        if (id) imports.push(mkImport(wildcard ? id.text + ".*" : id.text, node.startPosition.row + 1));
        return;
      }
      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration": {
        const name = node.childForFieldName("name");
        if (name) {
          const exported = isPublic(node);
          if (exported) exports.add(name.text);
          classes.push(sym(name.text, "class", node, exported));
        }
        break; // recurse to collect methods
      }
      case "method_declaration": {
        const name = node.childForFieldName("name");
        if (name) {
          const exported = isPublic(node);
          if (exported) exports.add(name.text);
          functions.push(sym(name.text, "function", node, exported));
        }
        return;
      }
    }
    for (const child of node.namedChildren) walk(child);
  };

  walk(root);
  return { imports, exports: [...exports], functions, classes };
}

function resolveJava(raw: string, _fromRel: string, files: ReadonlySet<string>): string | null {
  if (raw.endsWith(".*")) return null; // wildcard package import — not a single file
  const rel = raw.split(".").join("/") + ".java"; // com/example/Helper.java
  if (files.has(rel)) return rel;
  // Java files live under a source root (e.g. src/main/java/…): match by suffix.
  const suffix = "/" + rel;
  for (const f of files) if (f.endsWith(suffix)) return f;
  return null;
}

function mkImport(raw: string, line: number): ImportRef {
  return { raw, resolved: null, external: false, line };
}
function sym(name: string, kind: "function" | "class", node: SyntaxNode, exported: boolean): SymbolInfo {
  return { name, kind, line: node.startPosition.row + 1, exported };
}

export const javaPlugin: LanguagePlugin = {
  id: "java",
  extensions: [".java"],
  grammar: () => "java",
  extract: extractJava,
  resolve: resolveJava,
};
