import type { LanguagePlugin } from "./types.js";
import { grammarForExt, extractJsTs, resolveJsTs } from "./jsts.js";

export const typescriptPlugin: LanguagePlugin = {
  id: "typescript",
  extensions: [".ts", ".tsx"],
  grammar: grammarForExt,
  extract: extractJsTs,
  resolve: resolveJsTs,
};
