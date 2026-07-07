import type { Store } from "../state/store.js";
import type { Renderer } from "../render/renderer.js";
import type { CameraControls } from "../camera/controls.js";
import type { Minimap } from "./minimap.js";
import type { ArchitectureDiff, Commit, HistoryReport, MapGraph } from "../model/types.js";
import { getHistory, churnMap } from "../model/historyCache.js";

// The Git Time Machine panel: scrub the timeline to watch the architecture
// evolve, toggle the churn heatmap, read evolution insights, and diff revisions.
// Drives the renderer/store; never reaches into other panels.

export class History {
  private report: HistoryReport | null = null;
  private timeline: Commit[] = [];
  private playTimer: number | null = null;

  constructor(private el: HTMLElement, private store: Store, private renderer: Renderer, private camera: CameraControls, private minimap: Minimap) {
    this.load();
  }

  private async load(): Promise<void> {
    this.report = await getHistory();
    if (!this.report.isRepo) {
      this.el.innerHTML = `<p class="muted">Not a git repository — history unavailable.</p>`;
      return;
    }
    this.renderer.setChurn(new Map([...churnMap(this.report)].map(([p, v]) => [p, v.level])));
    this.timeline = await fetch("/api/timeline").then((r) => r.json());
    this.render();
  }

  private render(): void {
    const r = this.report!;
    const e = r.evolution;
    const opts = (xs: string[]) => xs.map((x) => `<option value="${esc(x)}">${esc(x.slice(0, 8))} ${esc(sub(x, this.timeline))}</option>`).join("");
    this.el.innerHTML = `
      <div class="hist-group">
        <label class="chk"><input type="checkbox" id="churn-toggle"> Churn heatmap</label>
        <div class="churn-legend"><span style="--c:#2c4a6e"></span>low<span style="--c:#e8c020"></span>med<span style="--c:#ff5252"></span>extreme</div>
      </div>

      <div class="hist-group">
        <h4>Timeline <span class="rev-label" id="rev-label">current</span></h4>
        <input type="range" id="time-slider" min="0" max="${this.timeline.length}" value="${this.timeline.length}" step="1">
        <div class="time-controls"><button id="play">▶ Replay</button><button id="to-current">Current</button></div>
        <div id="commit-meta" class="commit-meta"></div>
      </div>

      <div class="hist-group">
        <h4>Evolution insights</h4>
        <ul class="ins-list compact">
          ${insight("Most changed", e.mostChangedModule)}
          ${insight("Fastest growing", e.fastestGrowingSubsystem)}
          ${insight("Most stable", e.mostStableSubsystem)}
          ${insight("Newest layer", e.newestArchitecturalLayer)}
          ${insight("Most volatile", e.mostVolatileDependency)}
          ${e.couplingIncreasing.length ? insight("Coupling ↑", e.couplingIncreasing.map((c) => `${c.module} ${c.before}→${c.after}`).join(", ")) : ""}
        </ul>
      </div>

      <div class="hist-group">
        <h4>Architecture diff</h4>
        <select id="diff-a">${opts(this.timeline.map((c) => c.hash))}</select>
        <select id="diff-b">${opts(this.timeline.map((c) => c.hash))}</select>
        <button id="run-diff">Compare</button>
        <div id="diff-out"></div>
      </div>
    `;
    this.wire();
  }

  private wire(): void {
    const $ = <T extends HTMLElement>(id: string) => this.el.querySelector<T>("#" + id)!;
    $("churn-toggle").addEventListener("change", (ev) =>
      this.store.set({ overlay: (ev.target as HTMLInputElement).checked ? "churn" : "none" }));

    const slider = $<HTMLInputElement>("time-slider");
    slider.addEventListener("input", () => this.scrubTo(Number(slider.value)));
    $("play").addEventListener("click", () => this.togglePlay(slider));
    $("to-current").addEventListener("click", () => { slider.value = String(this.timeline.length); this.scrubTo(this.timeline.length); });

    const a = $<HTMLSelectElement>("diff-a");
    const b = $<HTMLSelectElement>("diff-b");
    if (this.timeline.length > 1) { a.selectedIndex = 0; b.selectedIndex = this.timeline.length - 1; }
    $("run-diff").addEventListener("click", () => this.runDiff(a.value, b.value));
  }

  /** index === timeline.length → live/current; else the commit at that index. */
  private async scrubTo(index: number): Promise<void> {
    const label = this.el.querySelector("#rev-label")!;
    const meta = this.el.querySelector("#commit-meta")!;
    if (index >= this.timeline.length) {
      label.textContent = "current";
      meta.innerHTML = "";
      this.renderer.restoreBase();
      this.store.set({ revision: "current" });
    } else {
      const c = this.timeline[index];
      label.textContent = c.shortHash;
      meta.innerHTML = `<div class="mono">${esc(c.subject)}</div><div class="muted">${esc(c.author)} · ${esc(c.dateIso.slice(0, 10))}</div>`;
      try {
        const snap: MapGraph = await fetch(`/api/snapshot?rev=${encodeURIComponent(c.hash)}`).then((r) => r.json());
        this.renderer.showSnapshot(snap.nodes, snap.edges);
        this.store.set({ revision: c.hash, selectedId: null, blast: null });
      } catch { /* ignore */ }
    }
    this.camera.fit(400);
    setTimeout(() => this.minimap.redraw(), 60);
  }

  private togglePlay(slider: HTMLInputElement): void {
    if (this.playTimer !== null) { clearInterval(this.playTimer); this.playTimer = null; return; }
    let i = 0;
    slider.value = "0";
    this.scrubTo(0);
    this.playTimer = window.setInterval(() => {
      i++;
      if (i > this.timeline.length) { clearInterval(this.playTimer!); this.playTimer = null; return; }
      slider.value = String(i);
      this.scrubTo(i);
    }, 900);
  }

  private async runDiff(a: string, b: string): Promise<void> {
    const out = this.el.querySelector("#diff-out")!;
    out.innerHTML = `<div class="loading">Comparing…</div>`;
    try {
      const d: ArchitectureDiff = await fetch(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`).then((r) => r.json());
      out.innerHTML = `
        <div class="diff-stats">
          <span class="add">+${d.addedFiles.length} files</span>
          <span class="rem">−${d.removedFiles.length} files</span>
          <span>⇄ ${d.movedFiles.length}</span>
          <span class="add">+${d.addedDependencies.length} deps</span>
          <span class="rem">−${d.removedDependencies.length} deps</span>
        </div>
        ${d.newCycles.length ? `<div class="diff-warn">⚠ ${d.newCycles.length} new cycle(s)</div>` : ""}
        ${d.addedFiles.length ? diffList("Added", d.addedFiles, "add") : ""}
        ${d.removedFiles.length ? diffList("Removed", d.removedFiles, "rem") : ""}
        ${d.hotspotChanges.length ? diffList("Hotspot shifts", d.hotspotChanges.slice(0, 6).map((h) => `${h.delta > 0 ? "▲" : "▼"} ${h.path} ${h.before}→${h.after}`), "") : ""}`;
    } catch {
      out.innerHTML = `<p class="muted">Diff failed.</p>`;
    }
  }
}

function insight(label: string, value: string | null): string {
  return `<li><span class="ins-sub muted">${esc(label)}</span><span class="ins-main mono">${esc(value ?? "—")}</span></li>`;
}
function diffList(title: string, items: string[], cls: string): string {
  return `<div class="diff-block"><h5>${esc(title)}</h5><ul class="${cls}">${items.slice(0, 10).map((i) => `<li class="mono">${esc(i)}</li>`).join("")}</ul></div>`;
}
function sub(hash: string, timeline: Commit[]): string {
  return (timeline.find((c) => c.hash === hash)?.subject ?? "").slice(0, 24);
}
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
