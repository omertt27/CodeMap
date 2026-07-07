import type Graph from "graphology";

// Layout is abstracted behind this interface so alternative engines (hierarchical,
// circular, cluster-based, or a live worker) can be added later without touching
// the renderer. A layout only assigns x/y to nodes.

export interface LayoutEngine {
  readonly id: string;
  readonly label: string;
  /** Assign x/y coordinates to every node in the graph (mutates in place). */
  run(graph: Graph): void;
}
