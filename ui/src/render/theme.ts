import type { MapNode } from "../model/types.js";

// All visual constants in one place so the look is consistent and easy to retheme.

export const LANG_COLOR: Record<string, string> = {
  python: "#3776ab",
  javascript: "#e8c020",
  typescript: "#3178c6",
  java: "#b07219",
};

export const TYPE_COLOR = {
  Directory: "#6e7681",
  Package: "#8957e5",
  File: "#58a6ff",
};

export const DIM = "#2b3138";
export const HIGHLIGHT = "#f0f6fc";
export const EDGE_IMPORT = "#3a4552";
export const EDGE_CONTAINS = "#23292f";

/** A single glyph used as a lightweight type "icon" prefixed on labels. */
export function glyph(node: MapNode): string {
  if (node.type === "Directory") return "\u{1F4C1}"; // folder
  if (node.type === "Package") return "\u{1F4E6}"; // package
  return "\u{1F4C4}"; // file
}

export function nodeColor(node: MapNode): string {
  if (node.type === "Directory") return TYPE_COLOR.Directory;
  if (node.type === "Package") return TYPE_COLOR.Package;
  return (node.language && LANG_COLOR[node.language]) || TYPE_COLOR.File;
}

/** Node radius scales gently with import-degree (importance). */
export function nodeSize(node: MapNode): number {
  if (node.type === "Directory") return 6;
  if (node.type === "Package") return 4;
  return 3 + Math.min(14, Math.sqrt(node.degree) * 3);
}
