import type { Store } from "../state/store.js";
import type { GraphModel } from "../model/graphModel.js";
import type { CameraControls } from "../camera/controls.js";

// Instant search. Typing updates the store's `search` (the renderer dims
// non-matches live); a result click (or Enter) selects and centers the node.

export class Search {
  constructor(
    private input: HTMLInputElement,
    private results: HTMLElement,
    private store: Store,
    private model: GraphModel,
    private camera: CameraControls,
  ) {
    this.input.addEventListener("input", () => { this.active = 0; this.onInput(); });
    this.input.addEventListener("keydown", (e) => {
      const items = [...this.results.querySelectorAll<HTMLElement>("[data-goto]")];
      if (e.key === "ArrowDown") { e.preventDefault(); this.move(1, items); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1, items); }
      else if (e.key === "Enter") { const el = items[this.active] ?? items[0]; if (el) this.go(el.getAttribute("data-goto")!); }
      else if (e.key === "Escape") this.clear();
    });
  }

  private active = 0;
  private move(delta: number, items: HTMLElement[]): void {
    if (!items.length) return;
    this.active = (this.active + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("active", i === this.active));
    items[this.active].scrollIntoView({ block: "nearest" });
  }

  private onInput(): void {
    const q = this.input.value;
    this.store.set({ search: q });
    const matches = this.model.search(q, 25);
    this.results.innerHTML = matches
      .map((n) => `<div class="result" data-goto="${escAttr(n.id)}">${highlight(n.path, q)}</div>`)
      .join("");
    this.results.querySelectorAll<HTMLElement>("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => this.go(el.getAttribute("data-goto")!)),
    );
  }

  private go(id: string): void {
    this.store.set({ selectedId: id, search: "" });
    this.input.value = "";
    this.results.innerHTML = "";
    this.camera.focus(id);
  }

  private clear(): void {
    this.input.value = "";
    this.results.innerHTML = "";
    this.store.set({ search: "" });
  }
}

function highlight(text: string, q: string): string {
  const query = q.trim().toLowerCase();
  const i = query ? text.toLowerCase().indexOf(query) : -1;
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<b>" + esc(text.slice(i, i + query.length)) + "</b>" + esc(text.slice(i + query.length));
}
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escAttr(s: string): string {
  return esc(s);
}
