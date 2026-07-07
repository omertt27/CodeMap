import type { FileNode } from "../graph/types.js";
import { entryKind, isTestFile } from "../impact/detect.js";

// Deterministic "find_*" navigators for agents: locate structural regions of a
// repo by path/name convention. Pure heuristics over file paths — no execution,
// no filesystem access beyond the already-parsed graph.

export interface Located {
  path: string;
  kind?: string;
  lang?: string;
  exports?: number;
}

const loc = (f: FileNode, kind?: string): Located => ({ path: f.path, kind, lang: f.lang, exports: f.exports.length });

export function findEntryPoints(files: FileNode[]): Located[] {
  return files.map((f) => ({ f, kind: entryKind(f.path) })).filter((x) => x.kind).map((x) => loc(x.f, x.kind!));
}

export function findTests(files: FileNode[]): Located[] {
  return files.filter((f) => isTestFile(f.path)).map((f) => loc(f, "test"));
}

const API_RE = /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|views)\//i;
const API_FILE_RE = /\.(route|routes|controller|handler|api|endpoint)\.[^.]+$/i;
export function findApiRoutes(files: FileNode[]): Located[] {
  return files.filter((f) => API_RE.test(f.path) || API_FILE_RE.test(f.path)).map((f) => loc(f, "api-route"));
}

const MODEL_RE = /(^|\/)(models?|entities|entity|schema|schemas|repositor(y|ies)|migrations|dao|orm|db)\//i;
const MODEL_FILE_RE = /\.(model|entity|schema|repository|dao)\.[^.]+$/i;
export function findDatabaseModels(files: FileNode[]): Located[] {
  return files.filter((f) => MODEL_RE.test(f.path) || MODEL_FILE_RE.test(f.path)).map((f) => loc(f, "model"));
}

const CONFIG_RE = /(^|\/)(config|configs|settings)\//i;
const CONFIG_FILE_RE = /(^|\/)(config|configuration|settings|constants)\.[^.]+$|\.config\.[^.]+$/i;
export function findConfiguration(files: FileNode[]): Located[] {
  return files.filter((f) => CONFIG_RE.test(f.path) || CONFIG_FILE_RE.test(f.path)).map((f) => loc(f, "config"));
}
