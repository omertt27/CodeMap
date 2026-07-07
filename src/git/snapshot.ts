import path from "node:path";
import { listTree, showFile } from "./git.js";
import { initParsers, parserForFile } from "../languages/registry.js";
import { collectComments } from "../languages/ast.js";
import type { ParsedRepository } from "../scanner/repository.js";
import type { ParsedFile } from "../languages/ir.js";

// Rebuilds the parser IR for any revision by reading file contents straight from
// git objects (`git show <rev>:<path>`) — the working directory is never
// touched. This is the bridge between git and the (unchanged) parser layer.

export async function parseRevision(root: string, rev: string): Promise<ParsedRepository> {
  await initParsers();
  const absRoot = path.resolve(root);
  const supported = listTree(absRoot, rev).filter((p) => parserForFile(p));
  const fileSet = new Set(supported);
  const files: ParsedFile[] = [];

  for (const rel of supported) {
    const parser = parserForFile(rel)!;
    let src: string;
    try {
      src = showFile(absRoot, rev, rel);
    } catch {
      continue; // unreadable blob (submodule, symlink, …)
    }
    try {
      const tree = parser.parseFile(src, path.extname(rel));
      const symbols = parser.extractSymbols(tree);
      const { imports, exports } = parser.extractRelationships(tree);
      for (const imp of imports) {
        imp.resolved = parser.resolveImport(imp.raw, rel, fileSet);
        imp.external = imp.resolved === null;
      }
      files.push({
        path: rel,
        language: parser.id,
        size: Buffer.byteLength(src, "utf8"),
        loc: src ? src.split(/\r\n|\r|\n/).length : 0,
        imports,
        exports,
        symbols,
        comments: collectComments(tree),
      });
    } catch {
      files.push({ path: rel, language: parser.id, size: 0, loc: 0, imports: [], exports: [], symbols: [], comments: [] });
    }
  }

  return { root: absRoot, files };
}
