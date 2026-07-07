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
| `codemap insights [path]` | Deterministic architecture analysis: circular deps, hotspots, possible God modules, possibly-unused files, layer violations. |
| `codemap impact <file>` | Blast radius of changing a file — "what breaks if I change this?". Saves `.codemap/impact-report.json`. `--json`, `--root <path>`. |
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

A **GPU-accelerated** map (Sigma.js / WebGL — no SVG) that stays fluid into the
thousands of nodes. Renders **files, directories, and dependencies** from the
generic graph.

- **Navigate:** smooth pan, mouse-wheel/infinite zoom, drag nodes, double-click to focus, fit-to-screen, and a click-to-jump **minimap**.
- **Search** (`auth.ts`) — dims non-matches live and centers the node on select.
- **Click a node → inspector**: file path, language, imports (internal + external), exported symbols, classes, functions, and dependency count — all lazily fetched from the parser via `/api/file`. Parser data only, no AI.
- **Filter** by language, node type, directory, and minimum dependency count — updates instantly via render reducers (no graph rebuild).
- Nodes are coloured by language/type and sized by import-degree.

**Architecture.** The UI (`ui/src/`) is modular ESM bundled offline by esbuild, with
each concern isolated behind a shared reactive store — `render/` (Sigma),
`state/` (store), `camera/`, `layout/` (a `LayoutEngine` interface with a
ForceAtlas2 implementation, so other layouts drop in), and `components/`
(sidebar, search, filters, minimap). Nothing is tightly coupled: components read
and write the store and never call each other. Clean extension points are left for
future overlays (semantic clusters, Git history, AI overlays, impact analysis) —
they become new store slices + reducer contributions without touching the renderer.

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

## Architecture intelligence

A standalone, deterministic analyzer (`src/analysis/` — no AI, no UI dependency)
turns the dependency graph into insight. `codemap scan` runs it, prints an
**Architecture Summary**, and saves `.codemap/architecture-summary.json`;
`codemap insights` prints the detail; the UI's **Insights** panel renders it and
clicking an item focuses/highlights the nodes on the map.

- **Dependency analysis** per file: direct/transitive imports & dependents, in/out degree, dependency depth (shown in the sidebar).
- **Circular dependencies** (Tarjan SCC) with files, length, severity, and a suggested edge to cut — plus a cycle-highlight mode.
- **Hotspots** — a 0–100 score from dependents, PageRank centrality, dependencies, size, and public-API width; each explains *why*.
- **Possible God modules** — configurable thresholds (LOC, functions, classes, exports, dependents); flagged only when several trip at once.
- **Possibly unused files** — conservative: no dependents **and** unreachable from entry points (tests count as entries).
- **Layer violations** — a small rule system (`repo-map.config.json`).

```json
{
  "layers": [
    { "name": "ui", "patterns": ["src/components/**", "src/pages/**"] },
    { "name": "database", "patterns": ["src/db/**", "src/models/**"] }
  ],
  "rules": [{ "from": "ui", "cannotImport": ["database"] }]
}
```

The analyzer is reusable as-is by the CLI, UI, and (later) an MCP server, an AI
assistant, or CI checks — it consumes the graph and returns plain data.

### Impact analysis (blast radius)

`src/impact/` (a separate module, `… → architecture analyzer → impact analyzer → UI`)
answers **"what breaks if I change this file?"** via reverse dependency traversal.

- **Reverse BFS** assigns every dependent a **hop distance** (0 = target, 1 = direct, 2+ = transitive) and a reason (`imports …`).
- **Blast-radius score (0–100)** from affected count, max depth, affected entry points, affected tests, target centrality, and cycle participation.
- **Likely affected tests** — by transitive import *and* by name (`session.ts` → `session.test.ts`).
- **Affected entry points** — main/CLI/app/server files, API routes, pages/routes.
- In the UI, **"Show blast radius"** paints the map by hop (source → red → orange → amber, unaffected dimmed); clicking any affected node shows *why* it's affected.

`codemap impact <file>` prints the report and writes `.codemap/impact-report.json`;
the server exposes `/api/impact?id=<file:path>`.

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
  graph/mapView.ts       compact map projection served to the visualization
  analysis/              deterministic architecture analyzer (UI-independent)
    graph.ts             dependency index + PageRank + reachability
    cycles.ts hotspots.ts godModules.ts deadCode.ts layers.ts
    metrics.ts config.ts index.ts
  impact/                deterministic blast-radius analyzer (reuses analysis/)
    impact.ts detect.ts index.ts
  server/serve.ts        local UI server + query API + insights + impact
  util/paths.ts          small path helpers
ui/                      the interactive map (WebGL)
  index.html style.css
  src/render/            Sigma renderer + theme
  src/state/             reactive store (single source of UI state)
  src/model/             graph model + types
  src/layout/            LayoutEngine interface + ForceAtlas2
  src/camera/            camera controls
  src/components/        sidebar, search, filters, minimap
  src/main.ts            composition root
schema/                  codemap.schema.json (frozen export contract)
test/                    node:test suites + golden per-language fixtures
```

The UI is bundled offline with esbuild (`npm run build:ui`, or `npm run dev:ui` to watch).

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
