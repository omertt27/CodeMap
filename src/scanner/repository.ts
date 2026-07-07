import fs from "node:fs";
import path from "node:path";
import { walk } from "./walk.js";
import { initParsers, parserForFile } from "../languages/registry.js";
import { collectComments } from "../languages/ast.js";
import { loadConfig } from "../config.js";
import type { ParsedFile } from "../languages/ir.js";

// Orchestrates parsing: discover files (scanner) → dispatch to the right parser
// → produce the language-agnostic IR. Knows nothing about any specific language
// and nothing about the graph model. This is the seam between I/O and parsing.

export interface ParseOptions {
  onProgress?: (done: number, total: number, file: string) => void;
  onError?: (file: string, err: unknown) => void;
}

export interface ParsedRepository {
  root: string; // absolute path scanned
  files: ParsedFile[];
}

export async function parseRepository(root: string, opts: ParseOptions = {}): Promise<ParsedRepository> {
  const absRoot = path.resolve(root);
  await initParsers();

  const config = loadConfig(absRoot);
  const discovered = walk(absRoot, { exclude: config.exclude, languages: config.languages });
  const fileSet = new Set(discovered.map((d) => d.rel));
  const files: ParsedFile[] = [];

  let done = 0;
  for (const f of discovered) {
    const parser = parserForFile(f.abs);
    try {
      if (!parser) throw new Error("no parser for file");
      const buf = fs.readFileSync(f.abs);
      const text = buf.toString("utf8");
      const ext = path.extname(f.abs);
      const tree = parser.parseFile(text, ext);
      const symbols = parser.extractSymbols(tree);
      const { imports, exports } = parser.extractRelationships(tree);
      for (const imp of imports) {
        imp.resolved = parser.resolveImport(imp.raw, f.rel, fileSet);
        imp.external = imp.resolved === null;
      }
      files.push({
        path: f.rel,
        language: f.lang,
        size: buf.length,
        loc: text ? text.split(/\r\n|\r|\n/).length : 0,
        imports,
        exports,
        symbols,
        comments: collectComments(tree),
      });
    } catch (err) {
      opts.onError?.(f.rel, err);
      files.push({ path: f.rel, language: f.lang, size: 0, loc: 0, imports: [], exports: [], symbols: [], comments: [] });
    }
    done++;
    opts.onProgress?.(done, discovered.length, f.rel);
  }

  return { root: absRoot, files };
}

/** The dominant language by file count, or null for an empty repo. */
export function primaryLanguage(files: ParsedFile[]): string | null {
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
  let best: string | null = null;
  let max = 0;
  for (const [lang, n] of counts) if (n > max) { max = n; best = lang; }
  return best;
}
