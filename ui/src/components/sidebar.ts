import type { Store } from "../state/store.js";
import type { GraphModel } from "../model/graphModel.js";
import type { CameraControls } from "../camera/controls.js";
import type { FileDetail, MapNode } from "../model/types.js";

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

    let last: string | null = null;
    this.store.subscribe((s) => {
      if (s.selectedId === last) return;
      last = s.selectedId;
      this.render(s.selectedId);
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
    try {
      const res = await fetch(`/api/file?id=${encodeURIComponent(id)}`);
      if (res.ok) detail = await res.json();
    } catch {
      /* offline / error → fall back to basic info */
    }
    if (my !== this.token) return; // superseded by a newer selection
    this.body.innerHTML = detail ? this.fileView(node, detail) : this.structuralView(node);
    this.wireLinks();
  }

  private fileView(node: MapNode, d: FileDetail): string {
    const internal = d.imports.filter((i) => i.resolved);
    const external = d.imports.filter((i) => !i.resolved);
    return `
      <h2>${esc(node.name)}</h2>
      <div class="path mono">${esc(d.path)}</div>
      <div class="badges">
        <span class="badge lang-${esc(d.lang)}">${esc(d.lang)}</span>
        <span class="badge">${d.loc} LOC</span>
        <span class="badge">${d.imports.length} deps</span>
      </div>
      ${section("Dependencies", `${d.imports.length}`)}
      ${listSection("Imports", internal.map((i) => row(i.resolved!, i.resolved!.replace(/^.*\//, ""))))}
      ${external.length ? block("External", external.map((i) => `<li class="mono muted">${esc(i.raw)}</li>`).join("")) : ""}
      ${d.exports.length ? block("Exported symbols", d.exports.map((x) => `<li class="mono">${esc(x)}</li>`).join("")) : ""}
      ${symbolBlock("Classes", d.classes)}
      ${symbolBlock("Functions", d.functions)}
    `;
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
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
