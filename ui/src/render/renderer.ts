import Graph from "graphology";
import Sigma from "sigma";
import type { GraphModel } from "../model/graphModel.js";
import type { Store } from "../state/store.js";
import type { LayoutEngine } from "../layout/layout.js";
import { CameraControls } from "../camera/controls.js";
import { DIM, EDGE_CONTAINS, EDGE_IMPORT, glyph, nodeColor, nodeSize } from "./theme.js";

// Owns the WebGL Sigma instance. Reads all interaction state from the store via
// reducers (no graph mutation on hover/select/filter → no re-layout, no churn),
// and writes user intent (hover/select) back to the store. Knows nothing about
// the sidebar, search box, or filter panel.

export class Renderer {
  readonly graph: Graph;
  readonly sigma: Sigma;
  readonly camera: CameraControls;
  private adjacency = new Map<string, Set<string>>();

  constructor(container: HTMLElement, private model: GraphModel, private store: Store, layout: LayoutEngine) {
    this.graph = this.buildGraph();
    layout.run(this.graph);
    this.buildAdjacency();

    this.sigma = new Sigma(this.graph, container, {
      minCameraRatio: 0.02,
      maxCameraRatio: 12,
      labelDensity: 0.6,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 8,
      defaultEdgeColor: EDGE_IMPORT,
      zIndex: true,
      nodeReducer: (id, data) => this.reduceNode(id, data),
      edgeReducer: (id, data) => this.reduceEdge(id, data),
    });
    this.camera = new CameraControls(this.sigma);

    this.wireEvents();
    this.store.subscribe((_, changed) => {
      if (changed.has("selectedId") || changed.has("hoveredId") || changed.has("search") || changed.has("filters")) {
        this.sigma.refresh({ skipIndexation: true });
      }
    });
  }

  // ---- graph construction ------------------------------------------------

  private buildGraph(): Graph {
    const g = new Graph({ multi: true, type: "directed" });
    for (const n of this.model.nodes) {
      g.addNode(n.id, {
        label: `${glyph(n)} ${n.name}`,
        size: nodeSize(n),
        color: nodeColor(n),
        x: 0,
        y: 0,
      });
    }
    for (const e of this.model.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      g.addEdgeWithKey(e.id, e.source, e.target, {
        type: "arrow",
        size: e.type === "IMPORTS" ? 1.4 : 0.6,
        color: e.type === "IMPORTS" ? EDGE_IMPORT : EDGE_CONTAINS,
        edgeType: e.type,
      });
    }
    return g;
  }

  private buildAdjacency(): void {
    for (const n of this.model.nodes) this.adjacency.set(n.id, new Set());
    for (const e of this.model.edges) {
      this.adjacency.get(e.source)?.add(e.target);
      this.adjacency.get(e.target)?.add(e.source);
    }
  }

  // ---- reducers (pure view transforms driven by store) -------------------

  private reduceNode(id: string, data: Record<string, unknown>) {
    const node = this.model.node(id);
    const st = this.store.get();
    const res: Record<string, unknown> = { ...data };
    if (!node || !this.model.passes(node, st.filters)) {
      res.hidden = true;
      return res;
    }
    const q = st.search.trim().toLowerCase();
    if (q && !(node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q))) {
      res.color = DIM;
      res.label = "";
    }
    if (st.selectedId) {
      if (id === st.selectedId) {
        res.highlighted = true;
        res.zIndex = 2;
      } else if (!this.adjacency.get(st.selectedId)?.has(id)) {
        res.color = DIM;
        res.label = "";
      } else {
        res.zIndex = 1;
      }
    }
    if (id === st.hoveredId) res.highlighted = true;
    return res;
  }

  private reduceEdge(id: string, data: Record<string, unknown>) {
    const st = this.store.get();
    const res: Record<string, unknown> = { ...data };
    if (st.selectedId) {
      const [s, t] = this.graph.extremities(id);
      if (s === st.selectedId || t === st.selectedId) {
        res.color = EDGE_IMPORT;
        res.size = 2;
        res.zIndex = 1;
      } else {
        res.hidden = true;
      }
    } else if (st.search.trim()) {
      res.color = EDGE_CONTAINS;
    }
    return res;
  }

  // ---- interaction -------------------------------------------------------

  private wireEvents(): void {
    this.sigma.on("enterNode", ({ node }) => this.store.set({ hoveredId: node }));
    this.sigma.on("leaveNode", () => this.store.set({ hoveredId: null }));
    this.sigma.on("clickNode", ({ node }) => this.store.set({ selectedId: node }));
    this.sigma.on("doubleClickNode", ({ node, event }) => {
      event.preventSigmaDefault();
      this.store.set({ selectedId: node });
      this.camera.focus(node);
    });
    this.sigma.on("clickStage", () => this.store.set({ selectedId: null }));

    this.enableDrag();
  }

  /** Drag nodes to reposition them (camera pan is suppressed while dragging). */
  private enableDrag(): void {
    let dragged: string | null = null;
    this.sigma.on("downNode", ({ node }) => {
      dragged = node;
      this.graph.setNodeAttribute(node, "highlighted", true);
    });
    this.sigma.getMouseCaptor().on("mousemovebody", (e) => {
      if (!dragged) return;
      const pos = this.sigma.viewportToGraph(e);
      this.graph.setNodeAttribute(dragged, "x", pos.x);
      this.graph.setNodeAttribute(dragged, "y", pos.y);
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    const release = () => {
      if (dragged) this.graph.removeNodeAttribute(dragged, "highlighted");
      dragged = null;
    };
    this.sigma.getMouseCaptor().on("mouseup", release);
  }
}
