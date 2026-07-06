import type { LanguagePlugin } from "./types.js";
import { grammarForExt, extractJsTs, resolveJsTs } from "./jsts.js";

export const javascriptPlugin: LanguagePlugin = {
  id: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  grammar: grammarForExt,
  extract: extractJsTs,
  resolve: resolveJsTs,
};
