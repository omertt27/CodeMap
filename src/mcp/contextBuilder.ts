import type { Built } from "./workspace.js";
import type { StabilityEntry, ChurnEntry } from "../git/history.js";
import { searchSymbols } from "./symbols.js";

// The Context Builder: given a short agent request ("modify authentication"), it
// assembles only the *relevant* slice of the architecture — related files, their
// immediate dependency neighbourhood, affected modules, a compact architecture
// summary, hotspot info, and (optionally) git history. This is what lets an agent
// understand a change area without dumping the whole repo into the context window.

const STOPWORDS = new Set([
  "the", "a", "an", "to", "in", "of", "for", "and", "or", "with", "on", "at", "by",
  "how", "where", "what", "is", "are", "my", "our", "this", "that", "it", "code",
  "modify", "change", "update", "add", "remove", "fix", "refactor", "implement",
  "feature", "logic", "please", "want", "need", "make", "work", "working", "handle",
]);

export interface BuiltContext {
  query: string;
  keywords: string[];
  relatedFiles: { path: string; lang: string; loc: number; hotspotScore: number; exports: string[]; dependents: number; imports: number }[];
  dependencyEdges: { from: string; to: string }[];
  affectedModules: string[];
  architectureSummary: { files: number; edges: number; cycles: number; hotspots: number; mostCentral: string | null };
  hotspots: { path: string; score: number }[];
  git: { path: string; churn: number; stability: number; commits: number }[];
}

export interface ContextOptions {
  maxFiles?: number;
  churn?: Map<string, ChurnEntry>;
  stability?: Map<string, StabilityEntry>;
}

export function buildContext(b: Built, query: string, opts: ContextOptions = {}): BuiltContext {
  const maxFiles = opts.maxFiles ?? 12;
  const keywords = tokenize(query);

  // Score files by path and symbol-name matches against the keywords.
  const symbolFiles = new Set<string>();
  for (const kw of keywords) for (const hit of searchSymbols(b.codeGraph, b.index, kw, 30)) symbolFiles.add(hit.path);

  const scored = b.fileGraph.nodes
    .map((n) => {
      const p = n.path.toLowerCase();
      let score = keywords.reduce((s, kw) => s + (p.includes(kw) ? 2 : 0), 0);
      if (symbolFiles.has(n.path)) score += 1;
      return { node: n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, maxFiles)
    .map((x) => x.node);

  const relatedIds = new Set(scored.map((n) => n.id));

  // Immediate dependency neighbourhood of the related files.
  const neighborIds = new Set<string>(relatedIds);
  for (const n of scored) {
    for (const t of b.index.out.get(n.id) ?? []) neighborIds.add(t);
    for (const s of b.index.in.get(n.id) ?? []) neighborIds.add(s);
  }

  const dependencyEdges = b.fileGraph.edges
    .filter((e) => neighborIds.has(e.source) && neighborIds.has(e.target))
    .map((e) => ({ from: b.index.path(e.source), to: b.index.path(e.target) }));

  const affectedModules = [...new Set([...neighborIds].map((id) => topDir(b.index.path(id))))].sort();

  const relatedFiles = scored.map((n) => ({
    path: n.path,
    lang: n.lang,
    loc: n.loc,
    hotspotScore: b.analysis.metrics[n.id]?.hotspotScore ?? 0,
    exports: n.exports.slice(0, 12),
    dependents: b.index.inDegree(n.id),
    imports: b.index.outDegree(n.id),
  }));

  const hotspots = relatedFiles
    .filter((f) => f.hotspotScore > 0)
    .map((f) => ({ path: f.path, score: f.hotspotScore }))
    .sort((a, b2) => b2.score - a.score);

  const git = (opts.churn || opts.stability)
    ? scored
        .map((n) => ({
          path: n.path,
          churn: opts.churn?.get(n.path)?.churn ?? 0,
          stability: opts.stability?.get(n.path)?.stability ?? 100,
          commits: opts.churn?.get(n.path)?.commits ?? 0,
        }))
        .filter((g) => g.commits > 0)
    : [];

  const s = b.analysis.summary;
  return {
    query,
    keywords,
    relatedFiles,
    dependencyEdges,
    affectedModules,
    architectureSummary: { files: s.files, edges: s.edges, cycles: s.cycles, hotspots: s.hotspots, mostCentral: s.mostCentral },
    hotspots,
    git,
  };
}

function tokenize(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  )];
}

function topDir(p: string): string {
  const i = p.indexOf("/");
  return i < 0 ? "(root)" : p.slice(0, i);
}
