import type { MapNode } from "../model/types.js";

// All visual constants in one place so the look is consistent and easy to retheme.

export const LANG_COLOR: Record<string, string> = {
  python: "#4b9fea",
  javascript: "#e8c020",
  typescript: "#3178c6",
  java: "#e8734a",
};

export const TYPE_COLOR = {
  Directory: "#454d5a",
  Package: "#a371f7",
  File: "#5aa2ff",
};

export const DIM = "#262c34";
export const HIGHLIGHT = "#f0f6fc";
export const EDGE_IMPORT = "#39424e";
export const EDGE_CONTAINS = "#1c2129";
export const LABEL_COLOR = "#c9d1d9";

/** Top-level directory of a path (used for clustering + colour grouping). */
export function topDir(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? "(root)" : path.slice(0, i);
}

export function nodeColor(node: MapNode): string {
  if (node.type === "Directory") return TYPE_COLOR.Directory;
  if (node.type === "Package") return TYPE_COLOR.Package;
  return (node.language && LANG_COLOR[node.language]) || TYPE_COLOR.File;
}

/** Node radius scales gently with import-degree (importance). */
export function nodeSize(node: MapNode): number {
  if (node.type === "Directory") return 4;
  if (node.type === "Package") return 3;
  return 3 + Math.min(15, Math.sqrt(node.degree) * 3.2);
}
