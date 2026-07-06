import type { ImportRef, SymbolInfo, Lang } from "../graph/types.js";
import type { GrammarName, SyntaxNode } from "./runtime.js";

/** Structural facts a plugin extracts from one parsed file. */
export interface FileFacts {
  imports: ImportRef[]; // `resolved` left null; filled by the pipeline via resolve()
  exports: string[];
  functions: SymbolInfo[];
  classes: SymbolInfo[];
}

/**
 * A language plugin owns everything language-specific: which files it handles,
 * which tree-sitter grammar to use, how to read structure out of the tree, and
 * how to resolve that language's import specifiers. Adding a language means
 * adding one of these and registering it — no changes to the scanner or graph.
 */
export interface LanguagePlugin {
  /** Stable identifier, also used as the file node's `lang`. */
  id: Lang;
  /** File extensions this plugin claims, lower-case with leading dot. */
  extensions: string[];
  /** Grammar to load/parse for a given extension. */
  grammar(ext: string): GrammarName;
  /** Pull imports/exports/functions/classes out of a parsed tree. */
  extract(root: SyntaxNode): FileFacts;
  /**
   * Resolve an import specifier to a repo-relative file in `files`, or null if
   * external/unresolvable.
   * @param raw     specifier as written
   * @param fromRel repo-relative path of the importing file
   * @param files   set of all repo-relative file paths (POSIX)
   */
  resolve(raw: string, fromRel: string, files: ReadonlySet<string>): string | null;
}
