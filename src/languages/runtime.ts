import path from "node:path";
import { createRequire } from "node:module";
import Parser from "web-tree-sitter";

// Shared tree-sitter runtime. Language plugins declare which grammar they need;
// this module loads them once and exposes a single parse entry point. Keeping
// the WASM/runtime concern here means plugins never touch web-tree-sitter setup.

const require = createRequire(import.meta.url);

export type GrammarName = "python" | "javascript" | "typescript" | "tsx" | "java";
export type SyntaxNode = Parser.SyntaxNode;

/** Resolve a file that lives inside an installed package. */
function pkgFile(pkg: string, rel: string): string {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), rel);
}

const grammars = new Map<GrammarName, Parser.Language>();
let parser: Parser | null = null;

/** Initialise the runtime and load the given grammars (idempotent). */
export async function initRuntime(names: Iterable<GrammarName>): Promise<void> {
  if (!parser) {
    await Parser.init({ locateFile: () => pkgFile("web-tree-sitter", "tree-sitter.wasm") });
    parser = new Parser();
  }
  for (const name of names) {
    if (grammars.has(name)) continue;
    const wasm = pkgFile("tree-sitter-wasms", `out/tree-sitter-${name}.wasm`);
    grammars.set(name, await Parser.Language.load(wasm));
  }
}

/** Parse source with the named grammar and return the tree's root node. */
export function parse(source: string, name: GrammarName): SyntaxNode {
  if (!parser) throw new Error("initRuntime() must be called before parse()");
  const grammar = grammars.get(name);
  if (!grammar) throw new Error(`grammar not loaded: ${name}`);
  parser.setLanguage(grammar);
  return parser.parse(source).rootNode;
}
