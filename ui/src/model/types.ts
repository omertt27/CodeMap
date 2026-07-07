// Shapes served by the local server. Kept independent from the backend source
// so the UI is a self-contained module.

export type MapNodeType = "File" | "Directory" | "Package";

export interface MapNode {
  id: string;
  type: MapNodeType;
  name: string;
  path: string;
  language: string | null;
  loc: number;
  degree: number;
}

export interface MapEdge {
  id: string;
  type: "IMPORTS" | "CONTAINS";
  source: string;
  target: string;
}

export interface MapGraph {
  root: string;
  generatedAt: string;
  nodes: MapNode[];
  edges: MapEdge[];
  languages: string[];
}

/** Lazy per-file detail from /api/file (the parser's file-level record). */
export interface FileDetail {
  id: string;
  path: string;
  name: string;
  lang: string;
  loc: number;
  imports: { raw: string; resolved: string | null; external: boolean; line: number }[];
  exports: string[];
  functions: { name: string; kind: string; line: number; exported: boolean }[];
  classes: { name: string; kind: string; line: number; exported: boolean }[];
}
