import fs from "node:fs";
import path from "node:path";
import { pluginForExt } from "../languages/registry.js";
import { parse } from "../languages/runtime.js";
import type { FileNode } from "../graph/types.js";

/**
 * Read, parse, and resolve one source file into a graph node. The language
 * plugin (chosen by extension) owns extraction and import resolution; this
 * function only bridges the filesystem to the plugin.
 *
 * @param abs     absolute path on disk
 * @param rel     repo-relative POSIX path (stable id)
 * @param fileSet all repo-relative paths, for import resolution
 */
export function scanFile(abs: string, rel: string, fileSet: ReadonlySet<string>): FileNode {
  const ext = path.extname(abs);
  const plugin = pluginForExt(ext);
  if (!plugin) throw new Error(`no language plugin for ${rel}`);

  const source = fs.readFileSync(abs, "utf8");
  const loc = source.length ? source.split(/\r\n|\r|\n/).length : 0;
  const facts = plugin.extract(parse(source, plugin.grammar(ext)));

  for (const imp of facts.imports) {
    imp.resolved = plugin.resolve(imp.raw, rel, fileSet);
    imp.external = imp.resolved === null;
  }

  return {
    id: `file:${rel}`,
    path: rel,
    name: path.posix.basename(rel),
    dir: path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel),
    lang: plugin.id,
    loc,
    imports: facts.imports,
    exports: facts.exports,
    functions: facts.functions,
    classes: facts.classes,
  };
}
