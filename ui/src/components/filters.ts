import type { Store } from "../state/store.js";
import type { GraphModel } from "../model/graphModel.js";
import type { MapNodeType } from "../model/types.js";
import { LANG_COLOR, TYPE_COLOR } from "../render/theme.js";

// Filter panel. Emits filter changes into the store; the renderer's reducers do
// the rest (instant, no graph rebuild). Fully decoupled from rendering.

const NODE_TYPES: MapNodeType[] = ["File", "Directory", "Package"];

export class Filters {
  constructor(private el: HTMLElement, private store: Store, private model: GraphModel) {
    this.el.innerHTML = this.template();
    this.wire();
  }

  private template(): string {
    const langCount = (l: string) => this.model.nodes.filter((n) => n.language === l).length;
    const typeCount = (t: string) => this.model.nodes.filter((n) => n.type === t).length;
    const langs = this.model.languages
      .map(
        (l) => `<label class="chk"><input type="checkbox" data-lang="${l}" checked>
          <span class="dot" style="background:${LANG_COLOR[l] ?? "#888"}"></span>${l}<span class="cnt">${langCount(l)}</span></label>`,
      )
      .join("");
    const types = NODE_TYPES.map(
      (t) => `<label class="chk"><input type="checkbox" data-type="${t}" checked>
        <span class="dot" style="background:${(TYPE_COLOR as Record<string, string>)[t] ?? "#888"}"></span>${t}<span class="cnt">${typeCount(t)}</span></label>`,
    ).join("");
    const dirs = ["<option value=\"\">All directories</option>"]
      .concat(this.model.directories.map((d) => `<option value="${d}">${d}</option>`))
      .join("");
    return `
      <div class="filter-group"><h4>Language</h4>${langs || '<span class="muted">—</span>'}</div>
      <div class="filter-group"><h4>Type</h4>${types}</div>
      <div class="filter-group"><h4>Directory</h4><select data-directory>${dirs}</select></div>
      <div class="filter-group"><h4>Min dependencies: <span data-deg-label>0</span></h4>
        <input type="range" data-mindeg min="0" max="${this.model.maxDegree}" value="0" step="1"></div>
    `;
  }

  private wire(): void {
    this.el.querySelectorAll<HTMLInputElement>("[data-lang]").forEach((cb) =>
      cb.addEventListener("change", () => this.applyLanguages()),
    );
    this.el.querySelectorAll<HTMLInputElement>("[data-type]").forEach((cb) =>
      cb.addEventListener("change", () => this.applyTypes()),
    );
    this.el.querySelector<HTMLSelectElement>("[data-directory]")!.addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.store.setFilters({ directory: v || null });
    });
    const range = this.el.querySelector<HTMLInputElement>("[data-mindeg]")!;
    const label = this.el.querySelector<HTMLElement>("[data-deg-label]")!;
    range.addEventListener("input", () => {
      label.textContent = range.value;
      this.store.setFilters({ minDegree: Number(range.value) });
    });
  }

  private applyLanguages(): void {
    const boxes = [...this.el.querySelectorAll<HTMLInputElement>("[data-lang]")];
    const checked = boxes.filter((b) => b.checked).map((b) => b.dataset.lang!);
    this.store.setFilters({ languages: checked.length === boxes.length ? null : new Set(checked) });
  }

  private applyTypes(): void {
    const checked = [...this.el.querySelectorAll<HTMLInputElement>("[data-type]")]
      .filter((b) => b.checked)
      .map((b) => b.dataset.type as MapNodeType);
    this.store.setFilters({ types: new Set(checked) });
  }
}
