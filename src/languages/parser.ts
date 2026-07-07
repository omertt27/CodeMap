import path from "node:path";
import type { Lang, ImportRef } from "../graph/types.js";
import { initRuntime, parse, type GrammarName, type SyntaxNode } from "./runtime.js";
import type { ParsedSymbol } from "./ir.js";

// The contract every language must implement. The rest of the application talks
// only to this interface — it never imports a concrete parser or branches on a
// language. Adding a language = adding one implementation and registering it.

export interface FileRelationships {
  imports: ImportRef[];
  exports: string[];
}

export interface LanguageParser {
  /** Stable id, also used as a file's `language`. */
  readonly id: Lang;
  /** File extensions this parser claims (lower-case, leading dot). */
  readonly extensions: string[];

  /** Load whatever the parser needs (grammars). Idempotent. */
  initialize(): Promise<void>;
  /** Does this parser handle the given path? */
  canParse(file: string): boolean;
  /** Parse source text into a syntax tree root node. */
  parseFile(source: string, ext: string): SyntaxNode;
  /** Declared symbols: classes, functions, methods, interfaces, enums, variables. */
  extractSymbols(root: SyntaxNode): ParsedSymbol[];
  /** File-level relationships: imports and exports. */
  extractRelationships(root: SyntaxNode): FileRelationships;
  /** Resolve an import specifier to a repo-relative file, or null if external. */
  resolveImport(raw: string, fromRel: string, files: ReadonlySet<string>): string | null;
}

/**
 * Base class handling the tree-sitter mechanics (grammar loading, extension
 * matching, parsing) so concrete parsers implement only the language-specific
 * extraction and resolution. Template-method pattern — keeps each parser small.
 */
export abstract class TreeSitterParser implements LanguageParser {
  abstract readonly id: Lang;
  abstract readonly extensions: string[];

  /** Grammars this parser may load. */
  protected abstract grammarNames(): GrammarName[];
  /** Which grammar to use for a given extension. */
  protected abstract grammarFor(ext: string): GrammarName;

  async initialize(): Promise<void> {
    await initRuntime(this.grammarNames());
  }

  canParse(file: string): boolean {
    return this.extensions.includes(path.extname(file).toLowerCase());
  }

  parseFile(source: string, ext: string): SyntaxNode {
    return parse(source, this.grammarFor(ext));
  }

  abstract extractSymbols(root: SyntaxNode): ParsedSymbol[];
  abstract extractRelationships(root: SyntaxNode): FileRelationships;
  abstract resolveImport(raw: string, fromRel: string, files: ReadonlySet<string>): string | null;
}
