import path from "node:path";
import type { Lang } from "../graph/types.js";
import type { LanguageParser } from "./parser.js";
import { JavaScriptParser, TypeScriptParser } from "./jsts.js";
import { PythonParser } from "./python.js";
import { JavaParser } from "./java.js";

// The one place languages are registered. To add a language, implement a
// LanguageParser and add an instance here — nothing else in the scanner, graph
// builder, or CLI changes.
const parsers: LanguageParser[] = [
  new JavaScriptParser(),
  new TypeScriptParser(),
  new PythonParser(),
  new JavaParser(),
];

const byExt = new Map<string, LanguageParser>();
for (const p of parsers) for (const ext of p.extensions) byExt.set(ext, p);

export function parserForExt(ext: string): LanguageParser | null {
  return byExt.get(ext.toLowerCase()) ?? null;
}

export function parserForFile(file: string): LanguageParser | null {
  return parserForExt(path.extname(file));
}

export function langForExt(ext: string): Lang | null {
  return parserForExt(ext)?.id ?? null;
}

export function supportedExtensions(): string[] {
  return [...byExt.keys()];
}

/** Initialise every registered parser (loads grammars). Idempotent. */
export async function initParsers(): Promise<void> {
  for (const p of parsers) await p.initialize();
}
