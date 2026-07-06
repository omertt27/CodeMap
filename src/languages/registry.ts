import type { Lang } from "../graph/types.js";
import { initRuntime, type GrammarName } from "./runtime.js";
import type { LanguagePlugin } from "./types.js";
import { javascriptPlugin } from "./javascript.js";
import { typescriptPlugin } from "./typescript.js";
import { pythonPlugin } from "./python.js";
import { javaPlugin } from "./java.js";

// The one place languages are registered. To add a language, implement a
// LanguagePlugin and add it here — nothing else in the scanner/graph changes.
const plugins: LanguagePlugin[] = [javascriptPlugin, typescriptPlugin, pythonPlugin, javaPlugin];

const byExt = new Map<string, LanguagePlugin>();
for (const p of plugins) for (const ext of p.extensions) byExt.set(ext, p);

export function pluginForExt(ext: string): LanguagePlugin | null {
  return byExt.get(ext.toLowerCase()) ?? null;
}

export function langForExt(ext: string): Lang | null {
  return pluginForExt(ext)?.id ?? null;
}

export function supportedExtensions(): string[] {
  return [...byExt.keys()];
}

/** Load the tree-sitter grammars every registered plugin needs (idempotent). */
export async function initLanguages(): Promise<void> {
  const grammars = new Set<GrammarName>();
  for (const p of plugins) for (const ext of p.extensions) grammars.add(p.grammar(ext));
  await initRuntime(grammars);
}
