import type { Store } from "../state/store.js";
import type { GraphModel } from "../model/graphModel.js";
import type { CameraControls } from "../camera/controls.js";
import type { FileDetail, ImpactReport, MapNode, NodeMetricsData } from "../model/types.js";
import type { BlastState } from "../state/store.js";
import { getHistory, churnMap, stabilityMap } from "../model/historyCache.js";

// The inspector panel. Subscribes to `selectedId`; for files it lazily fetches
// the parser's record (/api/file) so the payload stays small. Only shows what
// the parser extracted — no AI. Talks to the store, model, and camera; never to
// the renderer or other panels.

export class Sidebar {
  private el: HTMLElement;
  private body: HTMLElement;
  private token = 0; // guards out-of-order async responses

  constructor(root: HTMLElement, private store: Store, private model: GraphModel, private camera: CameraControls) {
    this.el = root;
    this.el.innerHTML = `<button class="close" aria-label="Close">×</button><div class="sidebar-body"></div>`;
    this.body = this.el.querySelector(".sidebar-body")!;
    this.el.querySelector(".close")!.addEventListener("click", () => this.store.set({ selectedId: null }));

    this.store.subscribe((s, changed) => {
      if (changed.has("selectedId") || changed.has("blast")) this.render(s.selectedId);
    });
  }

  private async render(id: string | null): Promise<void> {
    const my = ++this.token;
    if (!id) {
      this.el.classList.remove("open");
      return;
    }
    const node = this.model.node(id);
    if (!node) return;
    this.el.classList.add("open");

    if (node.type !== "File") {
      this.body.innerHTML = this.structuralView(node);
      return;
    }

    this.body.innerHTML = `<div class="loading">Loading…</div>`;
    let detail: FileDetail | null = null;
    let metrics: NodeMetricsData | null = null;
    let impact: ImpactReport | null = null;
    try {
      const [fRes, mRes, iRes] = await Promise.all([
        fetch(`/api/file?id=${encodeURIComponent(id)}`),
        fetch(`/api/metrics?id=${encodeURIComponent(id)}`),
        fetch(`/api/impact?id=${encodeURIComponent(id)}`),
      ]);
      if (fRes.ok) detail = await fRes.json();
      if (mRes.ok) metrics = await mRes.json();
      if (iRes.ok) impact = await iRes.json();
    } catch {
      /* offline / error → fall back to basic info */
    }
    if (my !== this.token) return; // superseded by a newer selection
    this.body.innerHTML = detail
      ? this.blastBanner(id) + this.fileView(node, detail, metrics) + this.impactSection(id, impact)
      : this.structuralView(node);
    this.wireLinks();
    this.wireImpact(impact);
    if (detail) this.appendHistory(node.path, my);
  }

  /** Append git churn + stability once the (cached) history report is ready. */
  private async appendHistory(filePath: string, my: number): Promise<void> {
    let report;
    try { report = await getHistory(); } catch { return; }
    if (my !== this.token || !report.isRepo) return;
    const churn = churnMap(report).get(filePath);
    const stability = stabilityMap(report).get(filePath);
    if (churn === undefined && stability === undefined) return;
    const html = `<div class="detail-block"><h3>History</h3>
      ${stability !== undefined ? `<div class="stat-row"><span>Stability</span><span class="mono">${stability}/100</span></div>` : ""}
      ${churn ? `<div class="stat-row"><span>Churn</span><span class="mono">${churn.churn} lines · ${churn.level}</span></div>
                 <div class="stat-row"><span>Commits</span><span class="mono">${churn.commits}</span></div>` : ""}
    </div>`;
    this.body.insertAdjacentHTML("beforeend", html);
  }

  /** Shown when the selected file is part of an active blast radius. */
  private blastBanner(id: string): string {
    const b = this.store.get().blast;
    if (!b || b.targetId === id || b.hops[id] === undefined) return "";
    return `<div class="blast-banner">Affected by <b class="mono">${esc(b.targetPath.replace(/^.*\//, ""))}</b>
      · hop ${b.hops[id]} · <span class="muted">${esc(b.reasons[id] ?? "")}</span></div>`;
  }

  private impactSection(id: string, impact: ImpactReport | null): string {
    if (!impact) return "";
    const active = this.store.get().blast?.targetId === id;
    const s = impact.blastRadiusScore;
    return `
      <div class="detail-block impact">
        <h3>Impact — blast radius</h3>
        <div class="blast-score" style="--s:${s}"><span class="num">${s}</span><span class="of">/ 100</span></div>
        <div class="stat-row"><span>Affected files</span><span class="mono">${impact.affectedFileCount}</span></div>
        <div class="stat-row"><span>Max hop distance</span><span class="mono">${impact.maxHop}</span></div>
        <div class="stat-row"><span>Direct dependents</span><span class="mono">${impact.directDependents}</span></div>
        <div class="stat-row"><span>Transitive dependents</span><span class="mono">${impact.transitiveDependents}</span></div>
        <div class="stat-row"><span>Likely affected tests</span><span class="mono">${impact.likelyAffectedTests.length}</span></div>
        <div class="stat-row"><span>Affected entry points</span><span class="mono">${impact.affectedEntryPoints.length}</span></div>
        <div class="stat-row"><span>In circular dependency</span><span class="mono">${impact.inCycle ? "yes" : "no"}</span></div>
        <button class="blast-toggle${active ? " on" : ""}" data-blast="${esc(id)}">${active ? "Hide blast radius" : "Show blast radius"}</button>
        ${impact.affectedEntryPoints.length ? block("Affected entry points", impact.affectedEntryPoints.slice(0, 8).map((e) => `<li><span class="lnk mono" data-goto="file:${esc(e.id)}">${esc(e.id.replace(/^.*\//, ""))}</span><span class="muted"> ${esc(e.kind)}</span></li>`).join("")) : ""}
        ${impact.likelyAffectedTests.length ? block("Likely affected tests", impact.likelyAffectedTests.slice(0, 8).map((t) => `<li><span class="lnk mono" data-goto="file:${esc(t.id)}">${esc(t.id.replace(/^.*\//, ""))}</span><span class="muted"> ${esc(t.via)}</span></li>`).join("")) : ""}
      </div>`;
  }

  private wireImpact(impact: ImpactReport | null): void {
    const btn = this.body.querySelector<HTMLElement>("[data-blast]");
    if (!btn || !impact) return;
    btn.addEventListener("click", () => {
      const active = this.store.get().blast?.targetId === impact.targetId;
      this.store.set({ blast: active ? null : buildBlast(impact) });
    });
  }

  private fileView(node: MapNode, d: FileDetail, m: NodeMetricsData | null): string {
    const internal = d.imports.filter((i) => i.resolved);
    const external = d.imports.filter((i) => !i.resolved);
    return `
      <h2>${esc(node.name)}</h2>
      <div class="path mono">${esc(d.path)}</div>
      <div class="badges">
        <span class="badge lang-${esc(d.lang)}">${esc(d.lang)}</span>
        <span class="badge">${d.loc} LOC</span>
        <span class="badge">${d.imports.length} deps</span>
        ${m && m.hotspotScore > 0 ? `<span class="badge risk" style="--s:${m.hotspotScore}">risk ${m.hotspotScore}</span>` : ""}
      </div>
      ${m ? this.metricsBlock(m) : ""}
      ${listSection("Imports", internal.map((i) => row(i.resolved!, i.resolved!.replace(/^.*\//, ""))))}
      ${external.length ? block("External", external.map((i) => `<li class="mono muted">${esc(i.raw)}</li>`).join("")) : ""}
      ${d.exports.length ? block("Exported symbols", d.exports.map((x) => `<li class="mono">${esc(x)}</li>`).join("")) : ""}
      ${symbolBlock("Classes", d.classes)}
      ${symbolBlock("Functions", d.functions)}
    `;
  }

  private metricsBlock(m: NodeMetricsData): string {
    const rows: [string, string | number][] = [
      ["Direct imports", m.directImports],
      ["Direct dependents", m.directDependents],
      ["Transitive imports", m.transitiveImports],
      ["Transitive dependents", m.transitiveDependents],
      ["In / out degree", `${m.inDegree} / ${m.outDegree}`],
      ["Dependency depth", m.depth],
      ["Centrality", m.centrality.toFixed(4)],
    ];
    return `<div class="detail-block"><h3>Dependency analysis</h3>${
      rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><span class="mono">${v}</span></div>`).join("")
    }</div>`;
  }

  private structuralView(node: MapNode): string {
    const kind = node.type === "Directory" ? "Directory" : "Package";
    return `
      <h2>${esc(node.name)}</h2>
      <div class="path mono">${esc(node.path)}</div>
      <div class="badges"><span class="badge">${kind}</span><span class="badge">${node.degree} links</span></div>
      ${node.type === "Package" ? `<p class="muted">External dependency imported by this repository.</p>` : ""}
    `;
  }

  private wireLinks(): void {
    this.body.querySelectorAll<HTMLElement>("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-goto")!;
        if (this.model.node(id)) {
          this.store.set({ selectedId: id });
          this.camera.focus(id);
        }
      }),
    );
  }
}

function symbolBlock(title: string, syms: { name: string; line: number; exported: boolean }[]): string {
  if (!syms.length) return "";
  const items = syms
    .map((s) => `<li><span class="ln">${s.line}</span><span class="mono">${esc(s.name)}${s.exported ? " ·" : ""}</span></li>`)
    .join("");
  return block(`${title} (${syms.length})`, items);
}
function listSection(title: string, rows: string[]): string {
  return rows.length ? block(title, rows.join("")) : "";
}
function row(id: string, label: string): string {
  return `<li><span class="lnk mono" data-goto="file:${esc(id)}">${esc(label)}</span></li>`;
}
function block(title: string, inner: string): string {
  return `<div class="detail-block"><h3>${esc(title)}</h3><ul>${inner}</ul></div>`;
}
function section(title: string, value: string): string {
  return `<div class="stat-row"><span>${esc(title)}</span><span class="mono">${esc(value)}</span></div>`;
}
function buildBlast(impact: ImpactReport): BlastState {
  const hops: Record<string, number> = { [impact.targetId]: 0 };
  const reasons: Record<string, string> = {};
  for (const n of impact.affectedNodes) {
    const id = `file:${n.id}`;
    hops[id] = n.hop;
    reasons[id] = n.reason;
  }
  return { targetId: impact.targetId, targetPath: impact.target, score: impact.blastRadiusScore, hops, reasons };
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
