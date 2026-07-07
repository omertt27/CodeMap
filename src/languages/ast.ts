import type { SyntaxNode } from "./runtime.js";
import type { ParsedSymbol, SymbolKind } from "./ir.js";

// Small tree-sitter helpers shared by the concrete parsers.

export function nameText(node: SyntaxNode): string | null {
  return node.childForFieldName("name")?.text ?? null;
}

export function line(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

export function mkSymbol(
  name: string,
  kind: SymbolKind,
  node: SyntaxNode,
  exported: boolean,
  extra: Partial<ParsedSymbol> = {},
): ParsedSymbol {
  return { name, kind, line: line(node), exported, ...extra };
}

/** All descendants (any depth) of a given node type. */
export function descendants(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const stack = [...node.namedChildren];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === type) out.push(n);
    stack.push(...n.namedChildren);
  }
  return out;
}

/** Type names referenced inside a heritage/clause node (generics stripped). */
export function typeNamesIn(clause: SyntaxNode | null): string[] {
  if (!clause) return [];
  const names: string[] = [];
  for (const child of clause.namedChildren) {
    if (["identifier", "type_identifier", "scoped_identifier", "generic_type", "member_expression", "nested_type_identifier", "constant", "scoped_type_identifier"].includes(child.type)) {
      const base = child.text.replace(/<.*$/s, "").trim();
      if (base) names.push(base);
    }
  }
  return names;
}

export function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, "");
}

/** Collect every comment node's text (language-agnostic across grammars). */
export function collectComments(root: SyntaxNode): string[] {
  const types = new Set(["comment", "line_comment", "block_comment"]);
  const out: string[] = [];
  const stack: SyntaxNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (types.has(n.type)) out.push(n.text);
    for (const c of n.namedChildren) stack.push(c);
  }
  return out;
}
