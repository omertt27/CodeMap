import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ImportRef } from "../graph/types.js";
import type { ParsedSymbol } from "../languages/ir.js";

// Incremental parse cache. Extraction (tree-sitter parsing → symbols/imports/
// comments) is the expensive step and depends only on a file's contents, so we
// key it by a content hash. On re-scan, unchanged files are served from cache
// and never re-parsed — turning a full scan of a large repo into a diff. Import
// resolution is NOT cached (it depends on the whole file set) and re-runs each
// scan, so results stay correct as files are added or removed.

const CACHE_VERSION = 2;

/** The content-derived facts we cache (everything except import resolution). */
export interface CachedFacts {
  size: number;
  loc: number;
  exports: string[];
  symbols: ParsedSymbol[];
  comments: string[];
  imports: { raw: string; line: number }[];
}

interface CacheEntry {
  hash: string;
  facts: CachedFacts;
}

export class ParseCache {
  private entries = new Map<string, CacheEntry>();
  private file: string;
  hits = 0;
  misses = 0;

  constructor(root: string) {
    this.file = path.join(root, ".codemap", "parse-cache.json");
    this.load();
  }

  hash(buf: Buffer): string {
    return crypto.createHash("sha1").update(buf).digest("hex");
  }

  get(rel: string, hash: string): CachedFacts | null {
    const e = this.entries.get(rel);
    if (e && e.hash === hash) {
      this.hits++;
      return e.facts;
    }
    this.misses++;
    return null;
  }

  set(rel: string, hash: string, facts: CachedFacts): void {
    this.entries.set(rel, { hash, facts });
  }

  /** Drop entries for files that no longer exist. */
  prune(livePaths: Set<string>): void {
    for (const k of [...this.entries.keys()]) if (!livePaths.has(k)) this.entries.delete(k);
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(this.entries) }));
    } catch {
      /* cache is best-effort */
    }
  }

  private load(): void {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8")) as { version: number; entries: Record<string, CacheEntry> };
      if (j.version === CACHE_VERSION) for (const [k, v] of Object.entries(j.entries)) this.entries.set(k, v);
    } catch {
      /* no/invalid cache → cold start */
    }
  }
}

/** Rebuild resolvable ImportRefs from cached raw specifiers. */
export function importsFromCache(cached: CachedFacts["imports"]): ImportRef[] {
  return cached.map((i) => ({ raw: i.raw, resolved: null, external: false, line: i.line }));
}
