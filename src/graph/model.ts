// The generic, language-agnostic code graph. Nothing here references Python,
// TypeScript, or any language — a Rust or Go parser produces exactly these node
// and edge types. This is the artifact future modules (visualization, queries,
// analysis) consume.

export type NodeType =
  | "Repository"
  | "Directory"
  | "File"
  | "Module"
  | "Class"
  | "Function"
  | "Method"
  | "Interface"
  | "Enum"
  | "Variable"
  | "Package";

export type EdgeType =
  | "CONTAINS" // structural: repo→dir→file, class→method
  | "DECLARES" // file→top-level symbol
  | "IMPORTS" // file→file or file→package
  | "EXPORTS" // file→exported symbol
  | "EXTENDS" // class→superclass
  | "IMPLEMENTS" // class→interface
  | "CALLS" // function→function (reserved; not populated yet)
  | "USES"; // symbol→symbol (reserved; not populated yet)

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  // Optional attributes, present where meaningful:
  path?: string; // File/Directory
  language?: string; // File and code symbols
  size?: number; // File (bytes)
  loc?: number; // File
  line?: number; // code symbols
  kind?: string; // original symbol kind
  exported?: boolean; // code symbols
  external?: boolean; // Package
  doc?: string; // stored docstring/comment
}

export interface GraphEdge {
  id: string;
  type: EdgeType;
  source: string;
  target: string;
}

export interface CodeGraphStats {
  files: number;
  directories: number;
  classes: number;
  interfaces: number;
  enums: number;
  functions: number;
  methods: number;
  variables: number;
  imports: number;
  packages: number;
  languages: Record<string, number>;
  primaryLanguage: string | null;
}

export interface CodeGraph {
  version: 1;
  generatedAt: string;
  root: string;
  stats: CodeGraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
