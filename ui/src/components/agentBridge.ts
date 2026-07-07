import type { Store } from "../state/store.js";
import type { GraphModel } from "../model/graphModel.js";
import type { CameraControls } from "../camera/controls.js";
import type { ImpactReport } from "../model/types.js";

// Makes the map a shared workspace for humans and AI agents. An MCP tool posts a
// highlight command to the server (/api/highlight); the server broadcasts it over
// SSE; this bridge applies it to the store so the agent's query lights up on the
// map — "show authentication" highlights auth nodes, "blast radius" the affected
// set, "circular dependency" the cycle. One-way and read-only; ignores anything
// it can't map to a known node.

export class AgentBridge {
  constructor(private store: Store, private model: GraphModel, private camera: CameraControls) {
    try {
      const es = new EventSource("/api/events");
      es.onmessage = (e) => { try { void this.handle(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
    } catch {
      /* EventSource unavailable → feature simply off */
    }
  }

  private toIds(paths: string[]): Set<string> {
    return new Set(paths.map((p) => `file:${p}`).filter((id) => this.model.node(id)));
  }

  private async handle(msg: { type: string; ids?: string[]; files?: string[]; target?: string }): Promise<void> {
    if (msg.type === "nodes" || msg.type === "cycle") {
      const ids = this.toIds(msg.type === "cycle" ? msg.files ?? [] : msg.ids ?? []);
      this.store.set({ selectedId: null, blast: null, highlight: ids.size ? ids : new Set(["__none__"]) });
      const first = [...ids][0];
      if (first) this.camera.focus(first, 0.5);
      return;
    }
    if (msg.type === "blast" && msg.target) {
      const id = `file:${msg.target}`;
      if (!this.model.node(id)) return;
      try {
        const r: ImpactReport = await fetch(`/api/impact?id=${encodeURIComponent(id)}`).then((x) => x.json());
        const hops: Record<string, number> = { [r.targetId]: 0 };
        const reasons: Record<string, string> = {};
        for (const n of r.affectedNodes) { hops[`file:${n.id}`] = n.hop; reasons[`file:${n.id}`] = n.reason; }
        this.store.set({ selectedId: null, highlight: null, blast: { targetId: r.targetId, targetPath: r.target, score: r.blastRadiusScore, hops, reasons } });
        this.camera.focus(r.targetId, 0.4);
      } catch {
        /* impact unavailable */
      }
    }
  }
}
