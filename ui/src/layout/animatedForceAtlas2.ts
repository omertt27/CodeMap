import type Graph from "graphology";
import type Sigma from "sigma";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";

// Force-directed layout run live in a Web Worker so the graph visibly *settles*
// on screen without freezing the main thread. Nodes are first seeded by
// directory cluster (so files from the same folder start together) and heavier
// CONTAINS edges pull each file toward its directory — producing "districts"
// rather than one hairball. Stops itself once the layout has relaxed.

export class AnimatedForceAtlas2 {
  private supervisor: FA2Layout | null = null;
  private raf = 0;

  constructor(private durationMs = 2800) {}

  start(graph: Graph, sigma: Sigma, onSettle?: () => void): void {
    this.stop();
    seedByCluster(graph);
    sigma.refresh();
    if (graph.order === 0) { onSettle?.(); return; }

    const settings = {
      ...forceAtlas2.inferSettings(graph),
      barnesHutOptimize: graph.order > 400,
      gravity: 1.6,
      scalingRatio: 16,
      slowDown: 2,
      edgeWeightInfluence: 1,
      adjustSizes: true,
    };
    this.supervisor = new FA2Layout(graph, { settings, getEdgeWeight: "weight" });
    this.supervisor.start();

    // Re-render every frame while the worker mutates positions.
    const tick = () => {
      sigma.refresh({ skipIndexation: true });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    window.setTimeout(() => {
      this.stop();
      onSettle?.();
    }, this.durationMs);
  }

  stop(): void {
    if (this.supervisor) {
      this.supervisor.stop();
      this.supervisor.kill();
      this.supervisor = null;
    }
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }
}

/** Seed positions grouped by cluster so ForceAtlas2 starts from real structure. */
function seedByCluster(graph: Graph): void {
  const byCluster = new Map<string, string[]>();
  graph.forEachNode((id, a) => {
    const c = (a.cluster as string) || "(root)";
    (byCluster.get(c) ?? byCluster.set(c, []).get(c)!).push(id);
  });
  const clusters = [...byCluster.keys()];
  const ringR = Math.max(180, clusters.length * 55);
  clusters.forEach((c, i) => {
    const ang = (2 * Math.PI * i) / Math.max(1, clusters.length);
    const cx = Math.cos(ang) * ringR;
    const cy = Math.sin(ang) * ringR;
    const nodes = byCluster.get(c)!;
    const r = Math.max(25, nodes.length * 3);
    nodes.forEach((id, j) => {
      const a2 = (2 * Math.PI * j) / Math.max(1, nodes.length);
      graph.mergeNodeAttributes(id, {
        x: cx + Math.cos(a2) * r * (0.4 + Math.random() * 0.6),
        y: cy + Math.sin(a2) * r * (0.4 + Math.random() * 0.6),
      });
    });
  });
}
