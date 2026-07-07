import type { MapGraph } from "./model/types.js";
import { GraphModel } from "./model/graphModel.js";
import { Store } from "./state/store.js";
import { Renderer } from "./render/renderer.js";
import { ForceAtlas2Layout } from "./layout/forceAtlas2.js";
import { Sidebar } from "./components/sidebar.js";
import { Search } from "./components/search.js";
import { Filters } from "./components/filters.js";
import { Minimap } from "./components/minimap.js";

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
  const minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement, renderer, camera);

  // Toolbar.
  bind("fit", () => camera.fit());
  bind("zoom-in", () => camera.zoomIn());
  bind("zoom-out", () => camera.zoomOut());
  bind("relayout", () => {
    new ForceAtlas2Layout().run(renderer.graph);
    renderer.sigma.refresh();
    minimap.redraw();
    camera.fit();
  });

  camera.fit(0);
}

function bind(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener("click", fn);
}

main().catch((err) => {
  document.getElementById("stage")!.innerHTML =
    `<div class="fatal">Failed to load graph: ${String(err)}</div>`;
});
