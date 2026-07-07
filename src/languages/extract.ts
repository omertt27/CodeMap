import { collectComments } from "./ast.js";
import type { LanguageParser } from "./parser.js";
import type { CachedFacts } from "../scanner/cache.js";

// The single extraction step (source text → cacheable facts), shared by the
// main thread and the parse workers so both produce identical results.
export function extractFacts(parser: LanguageParser, text: string, ext: string, size: number): CachedFacts {
  const tree = parser.parseFile(text, ext);
  const symbols = parser.extractSymbols(tree);
  const { imports, exports } = parser.extractRelationships(tree);
  return {
    size,
    loc: text ? text.split(/\r\n|\r|\n/).length : 0,
    exports,
    symbols,
    comments: collectComments(tree),
    imports: imports.map((i) => ({ raw: i.raw, line: i.line })),
  };
}
