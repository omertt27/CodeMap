# CodeMap

**Google Maps for codebases.** Point CodeMap at any repository and get an interactive architecture map — files, folders, imports, exports, functions, classes, and the dependency graph that connects them. Local-first: everything runs on your machine, nothing leaves it.

Supports **Python, JavaScript, TypeScript, and Java** today, via a small language-plugin system.

---

## Quick start

```bash
npm install
npm run build

# Scan a repo and write .codemap/graph.json
node dist/cli.js scan /path/to/repo

# Explore it in your browser (pan / zoom / search / click)
node dist/cli.js serve /path/to/repo

# Print a text architecture summary
node dist/cli.js summary /path/to/repo
```

During development you can skip the build step with `npm run dev -- <command>` (runs the TypeScript directly via `tsx`).

## Commands

| Command | What it does |
| --- | --- |
| `codemap scan [path]` | Scan a repo, extract structure, write the graph to `.codemap/graph.json`. `--json` prints the raw graph to stdout. |
| `codemap serve [path]` | Serve the interactive map on `http://127.0.0.1:4321`. `--rescan` forces a fresh scan, `--port <n>` changes the port, `--no-open` skips launching the browser. |
| `codemap summary [path]` | Print hubs, connectors, folders, external packages, and import cycles to the terminal. |
| `codemap export [path]` | Write a stable, schema-versioned graph document (files + edges + symbols) for AI agents and other tools. `--stdout`, `--compact`, `-o <file>`. |

### Configuration (optional)

Drop a `.codemap.json` at the repo root to tune scanning:

```json
{
  "exclude": ["**/*.min.js", "vendor/"],
  "languages": ["typescript", "python"]
}
```

`exclude` adds ignore patterns (gitignore syntax) on top of `.gitignore` and built-in
defaults; `languages` restricts the scan to a subset. Both are optional.

### Query API

`codemap serve` also exposes a query-oriented HTTP API over the graph — the surface a
windowed UI or an AI agent would use instead of downloading the whole graph:

| Endpoint | Returns |
| --- | --- |
| `GET /api/stats` | file/edge/language counts |
| `GET /api/search?q=&limit=` | files whose path matches |
| `GET /api/file?id=` | one file node's full metadata |
| `GET /api/neighbors?id=&dir=in\|out\|both&depth=` | a node's dependency neighbourhood |
| `GET /api/subgraph?folder=&minDegree=&limit=` | a windowed subgraph |

These are backed by a `GraphStore` interface (`src/graph/store.ts`) so a SQLite-backed
store can replace the in-memory JSON one without changing any consumer.

## The interactive map

- **Pan & zoom** the whole dependency graph (force-directed layout).
- **Search** files by path — matches highlight on the canvas and jump on click.
- **Click any node** to see its metadata: language, LOC, imports (internal + external), importers, functions, classes, and exports.
- **Colour by language**, **node size by how many files depend on it** (hubs stand out).
- Sidebar shows live **stats**, the **most depended-on files**, and any **import cycles**.

## How it works

```
repo ─▶ scanner ─▶ language parser ─▶ IR (ParsedFile[]) ─▶ GraphBuilder ─▶ CodeGraph ─▶ graph.json
        (discover)  (per language)     (language-agnostic)   (language-unaware)
```

Parsing and graph construction are fully separated:

- **Scanner** (`scanner/`) discovers source files, respecting `.gitignore`, config `exclude`, and built-in ignores (`node_modules`, `dist`, `build`, `target`, `__pycache__`, `.venv`, …).
- **Language parsers** (`languages/`) each implement one interface — `initialize` / `canParse` / `parseFile` / `extractSymbols` / `extractRelationships` / `resolveImport` — over [tree-sitter](https://tree-sitter.github.io/) WASM grammars. They emit a language-agnostic **IR** (`ParsedFile`): file metadata (path, language, size, LOC), imports/exports, symbols (class, function, method, interface, enum, variable — with `extends`/`implements` and docstrings), and stored comments.
- **GraphBuilder** (`graph/builder.ts`) turns the IR into the generic graph. It never asks which language produced the data.

Nothing outside `languages/` depends on any specific language; adding one is a single new parser.

## Graph model

`codemap scan` writes a generic, language-agnostic graph to `.codemap/graph.json`:

```json
{ "nodes": [...], "edges": [...] }
```

**Node types:** `Repository`, `Directory`, `File`, `Class`, `Function`, `Method`, `Interface`, `Enum`, `Variable`, `Package`.
**Edge types:** `CONTAINS` (repo→dir→file, class→method), `DECLARES` (file→symbol), `IMPORTS` (file→file or file→package), `EXPORTS`, `EXTENDS`, `IMPLEMENTS` (`CALLS`/`USES` are reserved for later).

See `src/graph/model.ts` for the full model and `src/languages/ir.ts` for the parser IR. (The interactive UI and query API run on an in-memory file-level projection of the same data — `src/graph/build.ts`.)

## Project layout

```
src/
  cli.ts                 CLI entrypoint (scan / summary / export / serve)
  config.ts              optional .codemap.json (exclude globs, language filter)
  languages/             language parsers — add a language here, nothing else changes
    parser.ts            LanguageParser interface + TreeSitterParser base class
    ir.ts                language-agnostic parser output (ParsedFile, ParsedSymbol)
    ast.ts               shared tree-sitter helpers
    registry.ts          the one place languages are registered
    runtime.ts           shared tree-sitter (WASM) runtime
    jsts.ts python.ts java.ts   the concrete parsers
  scanner/walk.ts        file discovery + .gitignore + built-in ignores
  scanner/repository.ts  parse coordinator → ParsedFile[] (IR)
  graph/model.ts         generic CodeGraph (nodes/edges) — the canonical output
  graph/builder.ts       language-unaware GraphBuilder: IR → CodeGraph
  graph/build.ts         in-memory file-level projection (UI / API / export)
  graph/store.ts         GraphStore interface + in-memory JsonGraphStore
  graph/summary.ts       hubs, connectors, cycles (Tarjan SCC), externals
  storage/json.ts        save/load .codemap/graph.json
  storage/export.ts      stable, schema-versioned export document
  server/serve.ts        local UI server + query API
  util/paths.ts          small path helpers
ui/                      index.html, app.js, style.css (Cytoscape 2D + 3D force-graph)
schema/                  codemap.schema.json (frozen export contract)
test/                    node:test suites + golden per-language fixtures
```

### Adding a language

Extend `TreeSitterParser` (or implement `LanguageParser` directly) with the
language's `extractSymbols` / `extractRelationships` / `resolveImport`, then add an
instance to `src/languages/registry.ts`. The scanner, graph builder, and CLI are
language-agnostic — no other file changes. (Go, Rust, PHP, and more grammars are
available offline; Ruby's prebuilt grammar is currently ABI-incompatible with the
pinned tree-sitter runtime.)

## Development

```bash
npm run build      # compile TypeScript to dist/
npm run typecheck  # type-check without emitting
npm test           # node:test suites + golden per-language fixtures
```

Tests cover the pure units (import resolution, walk/ignore rules, summary analytics,
symbol derivation) and run full `buildGraph` golden tests over on-disk fixture repos
in `test/fixtures/` (TypeScript ESM, Python packages, CommonJS `require`). CI runs
typecheck + build + tests on every push and PR.

## Scope (MVP)

Deliberately **not** included yet: AI/LLM features, MCP, semantic clustering, WebGPU rendering, runtime tracing, and languages beyond Python/JS/TS. The foundation — a clean graph and a stable data model — is built so those can layer on later.

## License

MIT
