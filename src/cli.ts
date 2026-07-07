#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { buildGraph, projectFileGraph } from "./graph/build.js";
import { buildCodeGraph } from "./graph/builder.js";
import { parseRepository } from "./scanner/repository.js";
import { summarize } from "./graph/summary.js";
import { saveCodeGraph } from "./storage/json.js";
import { buildExport } from "./storage/export.js";
import { serve } from "./server/serve.js";
import { analyzeRepoCached } from "./analysis/cache.js";
import type { Analysis } from "./analysis/index.js";
import { analyzeImpact } from "./impact/index.js";
import type { ImpactReport } from "./impact/index.js";
import { buildHistory, diffRevisions, timeline, snapshotFileGraph, isGitRepo } from "./git/index.js";
import type { HistoryReport, ArchitectureDiff } from "./git/index.js";
import { runMcpServer } from "./mcp/server.js";

const program = new Command();

program
  .name("codemap")
  .description("Google Maps for codebases — a local-first architecture map.")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a repository, parse files, build the graph, and save it to .codemap/graph.json")
  .argument("[path]", "repository root to scan", ".")
  .option("--json", "print the graph as JSON to stdout instead of a summary")
  .action(async (root: string, opts: { json?: boolean }) => {
    const start = Date.now();
    const failures: { file: string; err: unknown }[] = [];
    const parsed = await parseRepository(root, {
      cache: true,
      onProgress: (done, total) => {
        if (!opts.json && (done % 25 === 0 || done === total)) {
          process.stderr.write(`\r  parsing ${done}/${total} files…`);
        }
      },
      onError: (file, err) => failures.push({ file, err }),
    });
    if (!opts.json) process.stderr.write("\r\x1b[K");
    const graph = buildCodeGraph(parsed.root, parsed.files);

    if (opts.json) {
      process.stdout.write(JSON.stringify(graph, null, 2) + "\n");
      return;
    }

    // Deterministic architecture analysis (parser → builder → analyzer).
    const fileGraph = projectFileGraph(parsed);
    const analysis = analyzeRepoCached(fileGraph, root);
    const summaryFile = saveArchitectureSummary(root, analysis);

    const file = saveCodeGraph(root, graph);
    const s = graph.stats;
    const ms = Date.now() - start;
    const pad = (n: number) => String(n).padStart(6);

    const cs = parsed.cacheStats;
    const cacheNote = cs ? `  \x1b[2m(${cs.hits} cached, ${cs.misses} parsed)\x1b[0m` : "";
    console.log(`\n\x1b[1mRepository scanned\x1b[0m  (${ms}ms)${cacheNote}\n`);
    console.log("Languages:");
    for (const [lang, n] of Object.entries(s.languages).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${lang}${lang === s.primaryLanguage ? " \x1b[2m(primary)\x1b[0m" : ""} — ${n} files`);
    }
    console.log("\nGraph");
    console.log(`  Files:     ${pad(s.files)}`);
    console.log(`  Classes:   ${pad(s.classes)}`);
    console.log(`  Interfaces:${pad(s.interfaces)}`);
    console.log(`  Enums:     ${pad(s.enums)}`);
    console.log(`  Functions: ${pad(s.functions)}`);
    console.log(`  Methods:   ${pad(s.methods)}`);
    console.log(`  Variables: ${pad(s.variables)}`);
    console.log(`  Imports:   ${pad(s.imports)}`);
    if (failures.length) {
      console.log(`\n\x1b[33m⚠ ${failures.length} file(s) could not be parsed:\x1b[0m`);
      for (const f of failures.slice(0, 10)) {
        console.log(`    ${f.file} — ${f.err instanceof Error ? f.err.message : String(f.err)}`);
      }
      if (failures.length > 10) console.log(`    …and ${failures.length - 10} more`);
    }

    printArchitectureSummary(analysis);
    console.log(`\nGraph saved to ${file}`);
    console.log(`Architecture summary saved to ${summaryFile}`);
    console.log(`\nRun \x1b[1mcodemap insights ${root === "." ? "" : root}\x1b[0m for details, ` +
      `or \x1b[1mcodemap serve\x1b[0m to explore.`);
  });

program
  .command("summary")
  .description("Print an architecture summary (scans if no graph exists yet)")
  .argument("[path]", "repository root", ".")
  .action(async (root: string) => {
    const graph = await buildGraph(root, { cache: true });
    const s = summarize(graph);
    const line = (label: string, val: string | number) =>
      console.log(`  ${label.padEnd(14)} ${val}`);

    console.log("\n\x1b[1mArchitecture summary\x1b[0m");
    line("Files", s.files);
    line("Dependencies", s.edges);
    line("Functions", s.functions);
    line("Classes", s.classes);
    line("Lines", s.totalLoc);
    line("Languages", Object.entries(s.languages).map(([l, c]) => `${l}:${c}`).join("  "));

    section("Top folders");
    for (const f of s.folders.slice(0, 8)) console.log(`  ${String(f.files).padStart(4)}  ${f.folder}`);

    section("Most depended-on files (hubs)");
    if (!s.hubs.length) console.log("  (none)");
    for (const h of s.hubs) console.log(`  ${String(h.inDegree).padStart(4)}  ${h.path}`);

    section("Busiest importers");
    if (!s.connectors.length) console.log("  (none)");
    for (const c of s.connectors) console.log(`  ${String(c.outDegree).padStart(4)}  ${c.path}`);

    if (s.externals.length) {
      section("Top external packages");
      for (const e of s.externals.slice(0, 8)) console.log(`  ${String(e.count).padStart(4)}  ${e.name}`);
    }

    section("Import cycles");
    if (!s.cycles.length) console.log("  none detected ✓");
    for (const c of s.cycles) console.log(`  ⚠ ${c.join(" → ")}`);

    if (s.orphans.length) {
      section("Isolated files");
      console.log(`  ${s.orphans.length} file(s) with no internal imports`);
    }
    console.log("");
  });

program
  .command("export")
  .description("Write a stable, schema-versioned graph document for AI agents and other tools")
  .argument("[path]", "repository root", ".")
  .option("-o, --out <file>", "output file", ".codemap/export.json")
  .option("--stdout", "write to stdout instead of a file")
  .option("--compact", "minified JSON (default is pretty-printed)")
  .action(async (root: string, opts: { out: string; stdout?: boolean; compact?: boolean }) => {
    const graph = await buildGraph(root, { cache: true });
    const doc = buildExport(graph);
    const json = opts.compact ? JSON.stringify(doc) : JSON.stringify(doc, null, 2);
    if (opts.stdout) {
      process.stdout.write(json + "\n");
      return;
    }
    const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(path.resolve(root), opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, "utf8");
    console.log(`✓ Exported ${doc.nodes.length} files, ${doc.symbols.length} symbols, ` +
      `${doc.edges.length} dependencies`);
    console.log(`  schemaVersion ${doc.schemaVersion} → ${outPath}`);
  });

program
  .command("insights")
  .description("Print deterministic architecture insights (cycles, hotspots, God modules, unused, layer violations)")
  .argument("[path]", "repository root", ".")
  .action(async (root: string) => {
    const graph = await buildGraph(root, { cache: true });
    const a = analyzeRepoCached(graph, root);
    printArchitectureSummary(a);

    section("Circular dependencies");
    if (!a.cycles.length) console.log("  none ✓");
    for (const c of a.cycles.slice(0, 10)) {
      console.log(`  ⚠ [${c.severity}] ${c.length} files: ${c.files.join(" → ")}`);
      if (c.suggestedBreak) console.log(`     break: ${c.suggestedBreak.from} ✂ ${c.suggestedBreak.to}`);
    }

    section("Top hotspots");
    for (const h of a.hotspots) console.log(`  ${String(h.score).padStart(3)}  ${h.path}  \x1b[2m(${h.reasons.join(", ")})\x1b[0m`);

    section("Possible God modules");
    if (!a.godModules.length) console.log("  none");
    for (const g of a.godModules.slice(0, 10)) console.log(`  ${g.path}  \x1b[2m(${g.reasons.join("; ")})\x1b[0m`);

    section("Possibly unused files");
    if (!a.unused.length) console.log("  none");
    for (const u of a.unused.slice(0, 15)) console.log(`  ${u.path}  \x1b[2m(${u.reasons.join(", ")})\x1b[0m`);
    if (a.unused.length > 15) console.log(`  …and ${a.unused.length - 15} more`);

    section("Layer violations");
    if (!a.layerViolations.length) console.log("  none ✓");
    for (const v of a.layerViolations.slice(0, 20)) console.log(`  ⚠ ${v.from} → ${v.to}  \x1b[2m(${v.rule})\x1b[0m`);
    console.log("");
  });

program
  .command("impact")
  .description("Analyze the blast radius of changing a file — \"what breaks if I change this?\"")
  .argument("<file>", "file to analyze (repo-relative or absolute path)")
  .option("--root <path>", "repository root", ".")
  .option("--json", "print the report as JSON to stdout")
  .action(async (fileArg: string, opts: { root: string; json?: boolean }) => {
    const graph = await buildGraph(opts.root, { cache: true });
    const report = analyzeImpact(graph, fileArg);
    if (!report) {
      console.error(`No file matching "${fileArg}" in ${path.resolve(opts.root)}`);
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return;
    }
    const out = saveImpactReport(opts.root, report);
    printImpact(report);
    console.log(`\nDetailed report saved to ${out}`);
  });

program
  .command("history")
  .description("Show repository evolution: churn, stability, and evolution insights")
  .argument("[path]", "repository root", ".")
  .option("--json", "print the full history report as JSON")
  .option("--max <n>", "max commits to consider", "500")
  .action(async (root: string, opts: { json?: boolean; max: string }) => {
    if (!isGitRepo(root)) return void console.error("Not a git repository.");
    const report = await buildHistory(root, { evolutionGraphs: true, maxCommits: Number(opts.max) });
    if (opts.json) return void process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    printHistory(report);
  });

program
  .command("diff")
  .description("Architecture diff between two revisions (commits, tags, or branches)")
  .argument("<a>", "base revision")
  .argument("<b>", "target revision")
  .option("--root <path>", "repository root", ".")
  .option("--json", "print the diff as JSON")
  .action(async (a: string, b: string, opts: { root: string; json?: boolean }) => {
    if (!isGitRepo(opts.root)) return void console.error("Not a git repository.");
    const diff = await diffRevisions(opts.root, a, b);
    if (!diff) return void console.error(`Could not resolve one of "${a}" / "${b}".`);
    if (opts.json) return void process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
    printDiff(diff);
  });

program
  .command("replay")
  .description("Sample the timeline and report how files/dependencies grew over history")
  .argument("[path]", "repository root", ".")
  .option("--steps <n>", "number of timeline samples", "16")
  .option("--json", "print the replay timeline as JSON")
  .action(async (root: string, opts: { steps: string; json?: boolean }) => {
    if (!isGitRepo(root)) return void console.error("Not a git repository.");
    const commits = timeline(root, Number(opts.steps));
    const steps = [];
    for (const c of commits) {
      const g = await snapshotFileGraph(root, c.hash).catch(() => null);
      steps.push({ hash: c.shortHash, date: c.dateIso.slice(0, 10), subject: c.subject, files: g?.stats.files ?? 0, edges: g?.stats.edges ?? 0 });
    }
    if (opts.json) return void process.stdout.write(JSON.stringify({ root, steps }, null, 2) + "\n");
    console.log(`\n\x1b[1mReplay — ${steps.length} snapshots\x1b[0m\n`);
    console.log("  date        files  edges  commit");
    for (const s of steps) console.log(`  ${s.date}  ${String(s.files).padStart(5)}  ${String(s.edges).padStart(5)}  ${s.hash} ${s.subject.slice(0, 40)}`);
    console.log("");
  });

program
  .command("mcp")
  .description("Run a local MCP server exposing CodeMap analysis to AI agents (stdio transport)")
  .argument("[path]", "repository root", ".")
  .action(async (root: string) => {
    // stdout is the JSON-RPC channel — never write to it here.
    await runMcpServer(path.resolve(root));
  });

program
  .command("serve")
  .description("Open the interactive architecture map in your browser")
  .argument("[path]", "repository root", ".")
  .option("-p, --port <port>", "port to listen on", "4321")
  .option("--no-open", "do not open the browser automatically")
  .action(async (root: string, opts: { port: string; open?: boolean }) => {
    console.log("Scanning repository…");
    const parsed = await parseRepository(root, { cache: true });
    const codeGraph = buildCodeGraph(parsed.root, parsed.files);
    const fileGraph = projectFileGraph(parsed);
    const analysis = analyzeRepoCached(fileGraph, root);
    const history = isGitRepo(root) ? await buildHistory(root, { evolutionGraphs: true }) : null;
    const uri = await serve({ codeGraph, fileGraph, analysis, root, history }, { port: Number(opts.port), open: opts.open ?? true });
    console.log(`\n  CodeMap is running at \x1b[1m${uri}\x1b[0m`);
    console.log(`  ${fileGraph.stats.files} files · ${fileGraph.stats.edges} edges · press Ctrl+C to stop\n`);
  });

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function saveArchitectureSummary(root: string, analysis: Analysis): string {
  const dir = path.join(path.resolve(root), ".codemap");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "architecture-summary.json");
  fs.writeFileSync(file, JSON.stringify(analysis, null, 2), "utf8");
  return file;
}

function saveImpactReport(root: string, report: ImpactReport): string {
  const dir = path.join(path.resolve(root), ".codemap");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "impact-report.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

function printImpact(r: ImpactReport): void {
  console.log(`\n\x1b[1mImpact Analysis: ${r.target}\x1b[0m\n`);
  const bar = (n: number) => "█".repeat(Math.round(n / 5)).padEnd(20, "·");
  console.log(`Blast radius score: \x1b[1m${r.blastRadiusScore} / 100\x1b[0m  ${bar(r.blastRadiusScore)}\n`);
  console.log(`Affected files:        ${r.affectedFileCount}`);
  console.log(`Direct dependents:     ${r.directDependents}`);
  console.log(`Max dependency depth:  ${r.maxHop}`);
  console.log(`Likely affected tests: ${r.likelyAffectedTests.length}`);
  console.log(`Affected entry points: ${r.affectedEntryPoints.length}`);
  console.log(`Circular dependency:   ${r.inCycle ? "yes" : "no"}`);
  if (r.affectedEntryPoints.length) {
    console.log(`\nAffected entry points:`);
    for (const e of r.affectedEntryPoints.slice(0, 8)) console.log(`  • ${e.id}  \x1b[2m(${e.kind})\x1b[0m`);
  }
  if (r.likelyAffectedTests.length) {
    console.log(`\nLikely affected tests:`);
    for (const t of r.likelyAffectedTests.slice(0, 8)) console.log(`  • ${t.id}  \x1b[2m(${t.via})\x1b[0m`);
  }
  if (r.affectedNodes.length) {
    console.log(`\nTop affected paths:`);
    r.affectedNodes.slice(0, 10).forEach((n, i) => console.log(`  ${i + 1}. ${n.id}  \x1b[2m(hop ${n.hop})\x1b[0m`));
  }
}

function printHistory(r: HistoryReport): void {
  const e = r.evolution;
  console.log(`\n\x1b[1mRepository History\x1b[0m`);
  console.log(`  ${r.commits.length} commits · ${r.branches.length} branches · ${r.tags.length} tags`);
  console.log(`\n\x1b[1mEvolution insights\x1b[0m`);
  console.log(`  Most changed module:      ${e.mostChangedModule ?? "—"}`);
  console.log(`  Fastest growing subsystem: ${e.fastestGrowingSubsystem ?? "—"}`);
  console.log(`  Most stable subsystem:    ${e.mostStableSubsystem ?? "—"}`);
  console.log(`  Newest architectural layer: ${e.newestArchitecturalLayer ?? "—"}`);
  console.log(`  Most volatile file:       ${e.mostVolatileDependency ?? "—"}`);
  if (e.couplingIncreasing.length) console.log(`  Increasingly coupled:     ${e.couplingIncreasing.map((c) => `${c.module} (${c.before}→${c.after})`).join(", ")}`);
  section("Code churn (hottest files)");
  for (const c of r.churn.slice(0, 10)) console.log(`  [${c.level.padEnd(9)}] ${String(c.churn).padStart(6)} lines · ${c.commits} commits · ${c.path}`);
  section("Least stable files");
  for (const s of r.stability.slice(0, 8)) console.log(`  ${String(s.stability).padStart(3)}/100  ${s.path}  \x1b[2m(${s.commits} commits, ${s.authors} authors)\x1b[0m`);
  console.log("");
}

function printDiff(d: ArchitectureDiff): void {
  console.log(`\n\x1b[1mArchitecture diff: ${d.from.slice(0, 8)} → ${d.to.slice(0, 8)}\x1b[0m\n`);
  console.log(`  + ${d.addedFiles.length} files   − ${d.removedFiles.length} files   ⇄ ${d.movedFiles.length} moved`);
  console.log(`  + ${d.addedDependencies.length} deps    − ${d.removedDependencies.length} deps`);
  console.log(`  ${d.newCycles.length} new cycles, ${d.removedCycles.length} resolved cycles`);
  const list = (label: string, items: string[]) => { if (items.length) { console.log(`\n${label}:`); for (const i of items.slice(0, 12)) console.log(`  ${i}`); } };
  list("Added files", d.addedFiles);
  list("Removed files", d.removedFiles);
  list("Moved files", d.movedFiles.map((m) => `${m.from} → ${m.to}`));
  if (d.newCycles.length) { console.log(`\nNew cycles:`); for (const c of d.newCycles.slice(0, 6)) console.log(`  ⚠ ${c.join(" → ")}`); }
  if (d.hotspotChanges.length) { console.log(`\nBiggest hotspot changes:`); for (const h of d.hotspotChanges.slice(0, 8)) console.log(`  ${h.delta > 0 ? "▲" : "▼"} ${h.path}  ${h.before}→${h.after}`); }
  console.log("");
}

function printArchitectureSummary(a: Analysis): void {
  const s = a.summary;
  const n = (v: number) => v.toLocaleString("en-US");
  console.log(`\n\x1b[1mArchitecture Summary\x1b[0m`);
  console.log(`  • ${n(s.files)} files analyzed`);
  console.log(`  • ${n(s.edges)} dependency edges`);
  console.log(`  • ${n(s.cycles)} circular dependency cycles found`);
  console.log(`  • ${n(s.hotspots)} hotspot files detected`);
  console.log(`  • ${n(s.godModules)} possible God modules`);
  console.log(`  • ${n(s.unused)} possibly unused files`);
  console.log(`  • ${n(s.layerViolations)} layer violations`);
  console.log(`  • Most central module: ${s.mostCentral ?? "—"}`);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
