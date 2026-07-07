import Graph from "graphology";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import type { GraphModel } from "../model/graphModel.js";
import type { Store } from "../state/store.js";
import type { LayoutEngine } from "../layout/layout.js";
import { CameraControls } from "../camera/controls.js";
import type { MapEdge, MapNode } from "../model/types.js";
import { DIM, EDGE_CONTAINS, EDGE_IMPORT, glyph, nodeColor, nodeSize } from "./theme.js";

// Hop 0 (target) → 3+ : blue source, then red → orange → amber as impact fades.
const BLAST_COLORS = ["#58a6ff", "#ff7b72", "#f0883e", "#d29922"];
// Churn heatmap: cool (stable) → hot (frequently changed).
const CHURN_COLORS: Record<string, string> = {
  "Very Low": "#2c4a6e", Low: "#3f7bbf", Medium: "#e8c020", High: "#f0883e", Extreme: "#ff5252",
};

// Owns the WebGL Sigma instance. Reads all interaction state from the store via
// reducers (no graph mutation on hover/select/filter → no re-layout, no churn),
// and writes user intent (hover/select) back to the store. Knows nothing about
// the sidebar, search box, or filter panel.

export class Renderer {
  readonly graph: Graph;
  readonly sigma: Sigma;
  readonly camera: CameraControls;
  private adjacency = new Map<string, Set<string>>();
  private churn: Map<string, string> | null = null;

  constructor(container: HTMLElement, private model: GraphModel, private store: Store, private layout: LayoutEngine) {
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
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      zIndex: true,
      nodeReducer: (id, data) => this.reduceNode(id, data),
      edgeReducer: (id, data) => this.reduceEdge(id, data),
    });
    this.camera = new CameraControls(this.sigma);

    this.wireEvents();
    this.store.subscribe((_, changed) => {
      if (["selectedId", "hoveredId", "search", "filters", "highlight", "blast", "overlay"].some((k) => changed.has(k as never))) {
        this.sigma.refresh({ skipIndexation: true });
      }
    });
  }

  /** Provide the churn map (path → level) used by the churn overlay. */
  setChurn(churn: Map<string, string>): void {
    this.churn = churn;
  }

  /** Swap the rendered graph to a historical snapshot, keeping shared nodes in
   *  place and seeding new ones near their neighbours (so the map morphs rather
   *  than redrawing from scratch). */
  showSnapshot(nodes: MapNode[], edges: MapEdge[]): void {
    const prev = new Map<string, { x: number; y: number }>();
    this.graph.forEachNode((id, a) => prev.set(id, { x: a.x as number, y: a.y as number }));
    this.graph.clear();

    const incoming = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      const p = prev.get(n.id) ?? seedNear(n, edges, prev, incoming);
      this.graph.addNode(n.id, { label: `${glyph(n)} ${n.name}`, size: nodeSize(n), color: nodeColor(n), x: p.x, y: p.y });
    }
    for (const e of edges) {
      if (this.graph.hasNode(e.source) && this.graph.hasNode(e.target)) {
        this.graph.addEdgeWithKey(e.id, e.source, e.target, {
          type: "arrow", size: e.type === "IMPORTS" ? 1.4 : 0.6,
          color: e.type === "IMPORTS" ? EDGE_IMPORT : EDGE_CONTAINS, edgeType: e.type,
        });
      }
    }
    this.sigma.refresh();
  }

  /** Rebuild the live base graph (leaving history mode). */
  restoreBase(): void {
    this.graph.clear();
    const base = this.buildGraph();
    base.forEachNode((id, a) => this.graph.addNode(id, a));
    base.forEachEdge((id, a, s, t) => { if (this.graph.hasNode(s) && this.graph.hasNode(t)) this.graph.addEdgeWithKey(id, s, t, a); });
    this.layout.run(this.graph);
    this.sigma.refresh();
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
    if (st.blast) {
      const hop = st.blast.hops[id];
      if (hop === undefined) { res.color = DIM; res.label = ""; }
      else {
        res.color = BLAST_COLORS[Math.min(hop, 3)];
        res.zIndex = 3 - Math.min(2, hop);
        if (hop <= 1) res.highlighted = true;
      }
      return res;
    }
    if (st.overlay === "churn" && this.churn) {
      res.color = CHURN_COLORS[this.churn.get(node.path) ?? "Very Low"] ?? DIM;
    }
    const q = st.search.trim().toLowerCase();
    if (q && !(node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q))) {
      res.color = DIM;
      res.label = "";
    }
    if (st.highlight) {
      if (st.highlight.has(id)) {
        res.highlighted = true;
        res.zIndex = 2;
        res.color = "#f0883e";
      } else {
        res.color = DIM;
        res.label = "";
      }
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
    if (st.blast) {
      const [s, t] = this.graph.extremities(id);
      if (st.blast.hops[s] !== undefined && st.blast.hops[t] !== undefined) {
        res.color = "#f0883e"; res.size = 1.8; res.zIndex = 1;
      } else {
        res.hidden = true;
      }
      return res;
    }
    if (st.highlight) {
      const [s, t] = this.graph.extremities(id);
      if (st.highlight.has(s) && st.highlight.has(t)) {
        res.color = "#f0883e";
        res.size = 2.5;
        res.zIndex = 1;
      } else {
        res.hidden = true;
      }
      return res;
    }
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
    this.sigma.on("clickStage", () => this.store.set({ selectedId: null, highlight: null, blast: null }));

    this.enableDrag();
  }

  // (helpers below)

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

/** Seed a new snapshot node near the centroid of its already-placed neighbours. */
function seedNear(node: MapNode, edges: MapEdge[], prev: Map<string, { x: number; y: number }>, incoming: Set<string>): { x: number; y: number } {
  let sx = 0, sy = 0, n = 0;
  for (const e of edges) {
    const other = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
    if (other && prev.has(other)) { const p = prev.get(other)!; sx += p.x; sy += p.y; n++; }
  }
  void incoming;
  if (n) return { x: sx / n + (Math.random() - 0.5) * 20, y: sy / n + (Math.random() - 0.5) * 20 };
  return { x: (Math.random() - 0.5) * 300, y: (Math.random() - 0.5) * 300 };
}
