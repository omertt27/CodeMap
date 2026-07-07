import { parseRepository } from "../scanner/repository.js";
import { buildCodeGraph } from "../graph/builder.js";
import { projectFileGraph } from "../graph/build.js";
import { analyzeRepo, DependencyIndex, type Analysis } from "../analysis/index.js";
import { buildImpactContext, type ImpactContext } from "../impact/index.js";
import { buildHistory, isGitRepo, type HistoryReport } from "../git/index.js";
import { JsonGraphStore } from "../graph/store.js";
import type { Graph } from "../graph/types.js";
import type { CodeGraph } from "../graph/model.js";

// A cached analysis workspace for one repository root. Parses + analyzes once
// (lazily), then every MCP tool reads from the same artifacts. Purely a reuse of
// the existing pipeline — the MCP layer adds no analysis of its own.

export interface Built {
  fileGraph: Graph;
  codeGraph: CodeGraph;
  analysis: Analysis;
  index: DependencyIndex;
  impactCtx: ImpactContext;
  store: JsonGraphStore;
}

export class Workspace {
  private built: Promise<Built> | null = null;
  private history: Promise<HistoryReport> | null = null;
  /** Per-session query cache (symbol lookups, traversals, paths, blast radius). */
  private queryCache = new Map<string, unknown>();

  constructor(public readonly root: string) {}

  /** Build (or reuse the cached) analysis artifacts. */
  ensure(): Promise<Built> {
    return (this.built ??= this.build());
  }

  /** Force a fresh parse + analysis (e.g. after files change on disk). */
  rescan(): Promise<Built> {
    this.built = this.build();
    this.history = null;
    this.queryCache.clear(); // repository changed → drop cached query results
    return this.built;
  }

  /** Memoize a deterministic query result for the session (see `rescan`). */
  cached<T>(key: string, compute: () => T): T {
    if (this.queryCache.has(key)) return this.queryCache.get(key) as T;
    const v = compute();
    this.queryCache.set(key, v);
    return v;
  }

  /** Git evolution report (cached); empty when the root is not a git repo. */
  getHistory(): Promise<HistoryReport> {
    return (this.history ??= buildHistory(this.root, { evolutionGraphs: true }));
  }

  isGit(): boolean {
    return isGitRepo(this.root);
  }

  private async build(): Promise<Built> {
    const parsed = await parseRepository(this.root);
    const fileGraph = projectFileGraph(parsed);
    const codeGraph = buildCodeGraph(parsed.root, parsed.files);
    const analysis = analyzeRepo(fileGraph, this.root);
    const index = new DependencyIndex(fileGraph);
    return {
      fileGraph,
      codeGraph,
      analysis,
      index,
      impactCtx: buildImpactContext(index),
      store: new JsonGraphStore(fileGraph),
    };
  }
}
