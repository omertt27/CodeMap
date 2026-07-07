import type { MapNodeType } from "../model/types.js";

// A tiny reactive store. It is the single source of UI state; every component
// (renderer, sidebar, search, filters, minimap) reads and writes here and never
// calls another component directly. That keeps the pieces decoupled — a new
// panel or overlay just subscribes to the slice it cares about.

export interface Filters {
  /** null = all languages; otherwise only these. */
  languages: Set<string> | null;
  /** Visible node types. */
  types: Set<MapNodeType>;
  /** Only files under this directory prefix (null = whole repo). */
  directory: string | null;
  /** Minimum import-degree to show. */
  minDegree: number;
}

export interface UIState {
  selectedId: string | null;
  hoveredId: string | null;
  search: string;
  filters: Filters;
}

export type Listener = (state: UIState, changed: ReadonlySet<keyof UIState>) => void;

export class Store {
  private state: UIState;
  private listeners = new Set<Listener>();

  constructor(languages: string[]) {
    this.state = {
      selectedId: null,
      hoveredId: null,
      search: "",
      filters: {
        languages: null,
        types: new Set<MapNodeType>(["File", "Directory", "Package"]),
        directory: null,
        minDegree: 0,
      },
    };
    void languages;
  }

  get(): Readonly<UIState> {
    return this.state;
  }

  /** Shallow-merge a patch and notify subscribers with the set of changed keys. */
  set(patch: Partial<UIState>): void {
    const changed = new Set<keyof UIState>();
    for (const key of Object.keys(patch) as (keyof UIState)[]) {
      if (this.state[key] !== patch[key]) {
        (this.state[key] as unknown) = patch[key];
        changed.add(key);
      }
    }
    if (changed.size) this.emit(changed);
  }

  /** Update the filters slice (always treated as a change). */
  setFilters(patch: Partial<Filters>): void {
    this.state.filters = { ...this.state.filters, ...patch };
    this.emit(new Set(["filters"]));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: Set<keyof UIState>): void {
    for (const fn of this.listeners) fn(this.state, changed);
  }
}
