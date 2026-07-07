import type { MapGraph } from "./model/types.js";
import { GraphModel } from "./model/graphModel.js";
import { Store } from "./state/store.js";
import { Renderer } from "./render/renderer.js";
import { ForceAtlas2Layout } from "./layout/forceAtlas2.js";
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

  // Renderer + camera (WebGL).
  const renderer = new Renderer(document.getElementById("stage")!, model, store, new ForceAtlas2Layout());
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

  wireTabs(["filters", "insights", "history"]);

  // Toolbar.
  bind("fit", () => camera.fit());
  bind("zoom-in", () => camera.zoomIn());
  bind("zoom-out", () => camera.zoomOut());
  bind("cycles", () => toggleCycles(store));
  bind("relayout", () => {
    new ForceAtlas2Layout().run(renderer.graph);
    renderer.sigma.refresh();
    minimap.redraw();
    camera.fit();
  });

  camera.fit(0);
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
