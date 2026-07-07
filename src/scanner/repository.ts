import fs from "node:fs";
import path from "node:path";
import { walk } from "./walk.js";
import { initParsers, parserForFile } from "../languages/registry.js";
import { extractFacts } from "../languages/extract.js";
import { loadConfig } from "../config.js";
import { ParseCache, importsFromCache, type CachedFacts } from "./cache.js";
import { parseTexts, poolAvailable } from "./pool.js";
import type { ParseTask } from "./parseWorker.js";
import type { ImportRef, Lang } from "../graph/types.js";
import type { ParsedFile } from "../languages/ir.js";

// Parse files across worker threads once a repo is large enough to benefit
// (overridable via CODEMAP_WORKER_THRESHOLD). Below this, the single-threaded
// path avoids the worker startup cost.
const WORKER_THRESHOLD = Number(process.env.CODEMAP_WORKER_THRESHOLD || 400);

// Orchestrates parsing: discover files (scanner) → dispatch to the right parser
// → produce the language-agnostic IR. Knows nothing about any specific language
// and nothing about the graph model. This is the seam between I/O and parsing.

export interface ParseOptions {
  onProgress?: (done: number, total: number, file: string) => void;
  onError?: (file: string, err: unknown) => void;
  /** Use the incremental parse cache under .codemap/ (opt-in; off in tests). */
  cache?: boolean;
  /** Force worker-pool parsing on/off (default: auto by repo size). */
  workers?: boolean;
}

export interface ParsedRepository {
  root: string; // absolute path scanned
  files: ParsedFile[];
  /** Cache hit/miss counts when caching is enabled. */
  cacheStats?: { hits: number; misses: number };
}

export async function parseRepository(root: string, opts: ParseOptions = {}): Promise<ParsedRepository> {
  const absRoot = path.resolve(root);
  await initParsers();

  const config = loadConfig(absRoot);
  const discovered = walk(absRoot, { exclude: config.exclude, languages: config.languages });
  const fileSet = new Set(discovered.map((d) => d.rel));
  const cache = opts.cache ? new ParseCache(absRoot) : null;

  // Phase 1 (main thread I/O): read + hash each file, take cache hits, and
  // collect the cache misses' source text to parse.
  interface Slot { rel: string; lang: Lang; hash: string; facts: CachedFacts | null; noParser?: boolean }
  const slots: Slot[] = [];
  const misses: ParseTask[] = [];
  for (const f of discovered) {
    if (!parserForFile(f.abs)) { slots.push({ rel: f.rel, lang: f.lang, hash: "", facts: null, noParser: true }); continue; }
    const buf = fs.readFileSync(f.abs);
    const hash = cache ? cache.hash(buf) : "";
    const cached = cache ? cache.get(f.rel, hash) : null;
    if (cached) {
      slots.push({ rel: f.rel, lang: f.lang, hash, facts: cached });
    } else {
      slots.push({ rel: f.rel, lang: f.lang, hash, facts: null });
      misses.push({ rel: f.rel, ext: path.extname(f.abs), text: buf.toString("utf8"), size: buf.length });
    }
  }

  // Phase 2 (CPU): parse misses — across worker threads when large enough.
  const parsedMiss = new Map<string, CachedFacts>();
  if (misses.length) {
    const useWorkers = opts.workers ?? (misses.length >= WORKER_THRESHOLD && poolAvailable());
    if (useWorkers && poolAvailable()) {
      const results = await parseTexts(misses);
      for (const t of misses) {
        const r = results.get(t.rel);
        if (r?.facts) parsedMiss.set(t.rel, r.facts);
        else opts.onError?.(t.rel, new Error(r?.error ?? "parse failed"));
      }
    } else {
      for (const t of misses) {
        try {
          parsedMiss.set(t.rel, extractFacts(parserForFile("f" + t.ext)!, t.text, t.ext, t.size));
        } catch (err) {
          opts.onError?.(t.rel, err);
        }
      }
    }
  }

  // Phase 3: assemble in order, update cache, and resolve imports.
  const files: ParsedFile[] = [];
  let done = 0;
  for (const s of slots) {
    const facts = s.facts ?? parsedMiss.get(s.rel) ?? null;
    if (s.noParser || !facts) {
      if (!s.noParser && !facts) opts.onError?.(s.rel, new Error("parse failed"));
      files.push({ path: s.rel, language: s.lang, size: 0, loc: 0, imports: [], exports: [], symbols: [], comments: [] });
    } else {
      if (cache && !s.facts) cache.set(s.rel, s.hash, facts);
      const parser = parserForFile("f" + path.extname(s.rel))!;
      const imports: ImportRef[] = importsFromCache(facts.imports);
      for (const imp of imports) {
        imp.resolved = parser.resolveImport(imp.raw, s.rel, fileSet);
        imp.external = imp.resolved === null;
      }
      files.push({ path: s.rel, language: s.lang, size: facts.size, loc: facts.loc, imports, exports: facts.exports, symbols: facts.symbols, comments: facts.comments });
    }
    opts.onProgress?.(++done, slots.length, s.rel);
  }

  if (cache) {
    cache.prune(fileSet);
    cache.save();
  }

  return { root: absRoot, files, cacheStats: cache ? { hits: cache.hits, misses: cache.misses } : undefined };
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
