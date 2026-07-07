import { parentPort } from "node:worker_threads";
import { initParsers, parserForExt } from "../languages/registry.js";
import { extractFacts } from "../languages/extract.js";
import type { CachedFacts } from "./cache.js";

// A parse worker: initialises the tree-sitter parsers once, then extracts facts
// from batches of source text sent by the pool. Files are read on the main
// thread (which already read them for hashing) and the text is passed in, so a
// worker only does CPU-bound parsing — the part worth parallelising.

export interface ParseTask { rel: string; ext: string; text: string; size: number }
export interface ParseResult { rel: string; facts?: CachedFacts; error?: string }

await initParsers();

parentPort!.on("message", (msg: { files: ParseTask[] }) => {
  const results: ParseResult[] = [];
  for (const t of msg.files) {
    const parser = parserForExt(t.ext);
    if (!parser) { results.push({ rel: t.rel, error: "no parser" }); continue; }
    try {
      results.push({ rel: t.rel, facts: extractFacts(parser, t.text, t.ext, t.size) });
    } catch (e) {
      results.push({ rel: t.rel, error: String(e) });
    }
  }
  parentPort!.postMessage({ results });
});

parentPort!.postMessage({ ready: true });
