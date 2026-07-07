import type { Lang, ImportRef } from "../graph/types.js";

// The language-agnostic intermediate representation produced by parsers. Nothing
// downstream (graph builder, analysis, CLI) depends on tree-sitter or on any
// specific language — they consume only these plain data structures.

export type SymbolKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "enum"
  | "variable";

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  line: number; // 1-based declaration line
  exported: boolean;
  /** Enclosing type name for methods/fields (e.g. the class a method belongs to). */
  parent?: string;
  /** Base classes / superclasses this symbol extends (by written name). */
  extends?: string[];
  /** Interfaces this symbol implements (by written name). */
  implements?: string[];
  /** Docstring or leading doc-comment. Stored verbatim; never processed here. */
  doc?: string;
}

/** Everything one file yields, in a form no consumer needs a language to read. */
export interface ParsedFile {
  path: string; // repo-relative POSIX
  language: Lang;
  size: number; // bytes on disk
  loc: number; // line count
  imports: ImportRef[];
  exports: string[];
  symbols: ParsedSymbol[];
  /** All comments/docstrings, stored but intentionally not interpreted. */
  comments: string[];
}
