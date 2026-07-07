import type { Store } from "../state/store.js";
import type { GraphModel } from "../model/graphModel.js";
import type { CameraControls } from "../camera/controls.js";
import type { Insights as InsightsData } from "../model/types.js";

// The Architecture Insights panel. Fetches deterministic analysis from
// /api/insights and renders it; clicking an insight focuses/highlights the
// relevant node(s) on the map (via the store — never touching the renderer).

export class Insights {
  private data: InsightsData | null = null;

  constructor(private el: HTMLElement, private store: Store, private model: GraphModel, private camera: CameraControls) {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      this.data = await fetch("/api/insights").then((r) => r.json());
    } catch {
      this.el.innerHTML = `<p class="muted">Insights unavailable.</p>`;
      return;
    }
    this.render();
  }

  private render(): void {
    const a = this.data!;
    this.el.innerHTML = `
      ${this.group("Circular dependencies", a.cycles.length, a.cycles.map((c, i) => `
        <li data-cycle="${i}">
          <span class="sev sev-${c.severity}">${c.severity}</span>
          <span class="ins-main">${esc(c.files.length)} files</span>
          <span class="ins-sub mono">${esc(c.files.map(base).join(" → "))}</span>
          ${c.suggestedBreak ? `<span class="ins-sub muted">✂ break ${esc(base(c.suggestedBreak.from))} → ${esc(base(c.suggestedBreak.to))}</span>` : ""}
        </li>`).join(""), a.cycles.length ? "" : "none ✓")}

      ${this.group("Top hotspots", a.hotspots.length, a.hotspots.map((h) => `
        <li data-goto="${esc(h.id)}">
          <span class="score" style="--s:${h.score}">${h.score}</span>
          <span class="ins-main mono">${esc(base(h.path))}</span>
          <span class="ins-sub muted">${esc(h.reasons.join(", "))}</span>
        </li>`).join(""))}

      ${this.group("Possible God modules", a.godModules.length, a.godModules.map((g) => `
        <li data-goto="${esc(g.id)}"><span class="ins-main mono">${esc(base(g.path))}</span>
          <span class="ins-sub muted">${esc(g.reasons.join("; "))}</span></li>`).join(""), a.godModules.length ? "" : "none")}

      ${this.group("Possibly unused", a.unused.length, a.unused.map((u) => `
        <li data-goto="${esc(u.id)}"><span class="ins-main mono">${esc(u.path)}</span>
          <span class="ins-sub muted">${esc(u.reasons.join(", "))}</span></li>`).join(""), a.unused.length ? "" : "none")}

      ${this.group("Layer violations", a.layerViolations.length, a.layerViolations.map((v) => `
        <li data-violation="${esc(v.from)}|${esc(v.to)}">
          <span class="sev sev-high">${esc(v.fromLayer)}→${esc(v.toLayer)}</span>
          <span class="ins-sub mono">${esc(base(v.from))} → ${esc(base(v.to))}</span></li>`).join(""), a.layerViolations.length ? "" : "none ✓")}
    `;
    this.wire();
  }

  private group(title: string, count: number, items: string, empty = ""): string {
    return `<div class="ins-group"><h4>${esc(title)} <span class="count">${count}</span></h4>
      <ul class="ins-list">${items || `<li class="muted">${empty || "none"}</li>`}</ul></div>`;
  }

  private wire(): void {
    const a = this.data!;
    this.el.querySelectorAll<HTMLElement>("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => this.focusOne(el.getAttribute("data-goto")!)),
    );
    this.el.querySelectorAll<HTMLElement>("[data-cycle]").forEach((el) =>
      el.addEventListener("click", () => this.highlightFiles(a.cycles[Number(el.getAttribute("data-cycle"))].files)),
    );
    this.el.querySelectorAll<HTMLElement>("[data-violation]").forEach((el) => {
      const [from, to] = el.getAttribute("data-violation")!.split("|");
      el.addEventListener("click", () => this.highlightFiles([from, to]));
    });
  }

  private focusOne(id: string): void {
    this.store.set({ highlight: null, selectedId: id });
    this.camera.focus(id);
  }

  private highlightFiles(paths: string[]): void {
    const ids = paths.map((p) => `file:${p}`).filter((id) => this.model.node(id));
    this.store.set({ selectedId: null, highlight: new Set(ids) });
    if (ids.length) this.camera.focus(ids[0], 0.5);
  }
}

function base(p: string): string {
  return p.replace(/^.*\//, "");
}
function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
