#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { buildGraph } from "./graph/build.js";
import { summarize } from "./graph/summary.js";
import { loadGraph, saveGraph, graphPath } from "./storage/json.js";
import { buildExport } from "./storage/export.js";
import { serve } from "./server/serve.js";

const program = new Command();

program
  .name("codemap")
  .description("Google Maps for codebases — a local-first architecture map.")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a repository and write the dependency graph to .codemap/graph.json")
  .argument("[path]", "repository root to scan", ".")
  .option("--json", "print the graph as JSON to stdout instead of a summary")
  .action(async (root: string, opts: { json?: boolean }) => {
    const start = Date.now();
    const failures: { file: string; err: unknown }[] = [];
    const graph = await buildGraph(root, {
      onProgress: (done, total) => {
        if (!opts.json && (done % 25 === 0 || done === total)) {
          process.stderr.write(`\r  scanning ${done}/${total} files…`);
        }
      },
      onError: (file, err) => failures.push({ file, err }),
    });
    if (!opts.json) process.stderr.write("\r\x1b[K");
    const file = saveGraph(root, graph);
    if (opts.json) {
      process.stdout.write(JSON.stringify(graph, null, 2) + "\n");
      return;
    }
    const ms = Date.now() - start;
    console.log(`✓ Scanned ${graph.stats.files} files in ${ms}ms`);
    console.log(`  ${graph.stats.edges} dependency edges, ` +
      `${graph.stats.functions} functions, ${graph.stats.classes} classes`);
    console.log(`  Graph written to ${file}`);
    if (failures.length) {
      console.log(`\n\x1b[33m⚠ ${failures.length} file(s) could not be parsed:\x1b[0m`);
      for (const f of failures.slice(0, 10)) {
        console.log(`    ${f.file} — ${f.err instanceof Error ? f.err.message : String(f.err)}`);
      }
      if (failures.length > 10) console.log(`    …and ${failures.length - 10} more`);
    }
    console.log(`\nRun \x1b[1mcodemap serve ${root === "." ? "" : root}\x1b[0m to explore it.`);
  });

program
  .command("summary")
  .description("Print an architecture summary (scans if no graph exists yet)")
  .argument("[path]", "repository root", ".")
  .action(async (root: string) => {
    const graph = loadGraph(root) ?? (await buildGraph(root));
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
    const graph = loadGraph(root) ?? (await buildGraph(root));
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
  .command("serve")
  .description("Open the interactive architecture map in your browser")
  .argument("[path]", "repository root", ".")
  .option("-p, --port <port>", "port to listen on", "4321")
  .option("--rescan", "re-scan before serving instead of using the cached graph")
  .option("--no-open", "do not open the browser automatically")
  .action(async (root: string, opts: { port: string; rescan?: boolean; open?: boolean }) => {
    let graph = opts.rescan ? null : loadGraph(root);
    if (!graph) {
      console.log("Scanning repository…");
      graph = await buildGraph(root);
      saveGraph(root, graph);
    } else {
      console.log(`Loaded cached graph from ${graphPath(root)}`);
    }
    const uri = await serve(graph, { port: Number(opts.port), open: opts.open ?? true });
    console.log(`\n  CodeMap is running at \x1b[1m${uri}\x1b[0m`);
    console.log(`  ${graph.stats.files} files · ${graph.stats.edges} edges · press Ctrl+C to stop\n`);
  });

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
