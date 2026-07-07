import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { LayoutEngine } from "./layout.js";

// The default force-directed layout. Nodes are seeded on a circle (ForceAtlas2
// needs non-coincident starting positions) then relaxed for a fixed number of
// iterations — deterministic and computed once, so rendering stays static and
// smooth afterwards (dragging updates individual nodes).

export class ForceAtlas2Layout implements LayoutEngine {
  readonly id = "forceatlas2";
  readonly label = "Force-directed";

  constructor(private iterations = 400) {}

  run(graph: Graph): void {
    seedCircle(graph);
    if (graph.order === 0) return;
    const settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: this.iterations,
      settings: { ...settings, adjustSizes: true, barnesHutOptimize: graph.order > 800, gravity: 1.2, scalingRatio: 12 },
    });
  }
}

function seedCircle(graph: Graph): void {
  const n = graph.order;
  let i = 0;
  const radius = Math.max(50, n * 1.5);
  graph.forEachNode((node) => {
    const angle = (2 * Math.PI * i) / Math.max(1, n);
    graph.mergeNodeAttributes(node, {
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 5,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 5,
    });
    i++;
  });
}
