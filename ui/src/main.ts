import type { MapGraph } from "./model/types.js";
import { GraphModel } from "./model/graphModel.js";
import { Store } from "./state/store.js";
import { Renderer } from "./render/renderer.js";
import { Sidebar } from "./components/sidebar.js";
import { Search } from "./components/search.js";
import { Filters } from "./components/filters.js";
import { Minimap } from "./components/minimap.js";
import { Insights } from "./components/insights.js";
import { History } from "./components/history.js";
import type { Insights as InsightsData } from "./model/types.js";

// Composition root: fetch data, construct the decoupled pieces, wire them to the
// shared store, and start. This is the only file that knows about all components.

async function main(): Promise<void> {
  const graph: MapGraph = await fetch("/graph.json").then((r) => r.json());
  const model = new GraphModel(graph);
  const store = new Store(model.languages);

  const rootLabel = document.getElementById("root-path")!;
  rootLabel.textContent = graph.root;
  document.getElementById("stat-nodes")!.textContent = String(model.nodes.length);
  document.getElementById("stat-edges")!.textContent = String(model.edges.length);
  // Workspace packages (monorepos) — used to group the map by package boundary.
  const packageDirs: string[] = await fetch("/api/packages").then((r) => r.json()).then((p) => p.packageDirs).catch(() => []);
  document.getElementById("legend")!.innerHTML = `
    <div class="lg-row"><span class="lg-dot" style="width:6px;height:6px"></span><span class="lg-dot" style="width:13px;height:13px"></span> node size = dependents</div>
    <div class="lg-row"><span class="lg-dot" style="background:#5aa2ff"></span>file
      <span class="lg-dot" style="background:#454d5a"></span>dir
      <span class="lg-dot" style="background:#a371f7"></span>package</div>`;

  // Renderer + camera (WebGL).
  const renderer = new Renderer(document.getElementById("stage")!, model, store);
  const camera = renderer.camera;

  // Panels — each only depends on the store, model, and camera.
  new Sidebar(document.getElementById("sidebar")!, store, model, camera);
  new Search(
    document.getElementById("search") as HTMLInputElement,
    document.getElementById("search-results")!,
    store,
    model,
    camera,
  );
  new Filters(document.getElementById("filters")!, store, model);
  new Insights(document.getElementById("insights")!, store, model, camera);
  const minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement, renderer, camera);
  new History(document.getElementById("history")!, store, renderer, camera, minimap);

  // Fit + refresh the minimap each time the animated layout settles.
  renderer.onLayoutSettled = () => { minimap.redraw(); camera.fit(); };

  wireTabs(["filters", "insights", "history"]);

  // Toolbar.
  bind("fit", () => camera.fit());
  bind("zoom-in", () => camera.zoomIn());
  bind("zoom-out", () => camera.zoomOut());
  bind("cycles", () => toggleCycles(store));
  bind("relayout", () => renderer.relayout());
  let grouped = false;
  const setGrouped = (on: boolean) => {
    grouped = on;
    document.getElementById("group")!.classList.toggle("on", grouped);
    store.set({ selectedId: null, blast: null, highlight: null });
    if (grouped) renderer.showGroups(packageDirs);
    else renderer.restoreBase();
  };
  bind("group", () => setGrouped(!grouped));

  // Drill-down: double-click a folder node → expand to its files (semantic zoom).
  renderer.onExpandGroup = (dir) => {
    grouped = false;
    document.getElementById("group")!.classList.remove("on");
    store.setFilters({ directory: dir });
    store.set({ selectedId: null });
    renderer.restoreBase();
  };

  // Very large repos: start in the folder/package view to stay responsive.
  if (model.nodes.length > 2500) setGrouped(true);
}

/** Toolbar cycle mode: highlight every file involved in a dependency cycle. */
async function toggleCycles(store: Store): Promise<void> {
  if (store.get().highlight) {
    store.set({ highlight: null });
    return;
  }
  const insights: InsightsData = await fetch("/api/insights").then((r) => r.json());
  const ids = new Set<string>();
  for (const c of insights.cycles) for (const p of c.files) ids.add(`file:${p}`);
  store.set({ selectedId: null, highlight: ids.size ? ids : new Set(["__none__"]) });
}

function wireTabs(names: string[]): void {
  const tabs = document.querySelectorAll<HTMLElement>(".tab");
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      for (const n of names) document.getElementById(n)!.hidden = tab.dataset.tab !== n;
    }),
  );
}

function bind(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener("click", fn);
}

main().catch((err) => {
  document.getElementById("stage")!.innerHTML =
    `<div class="fatal">Failed to load graph: ${String(err)}</div>`;
});
