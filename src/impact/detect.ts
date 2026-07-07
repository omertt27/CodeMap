import { globToRegExp } from "../analysis/config.js";

// Heuristics for classifying files as tests or entry points. Deliberately simple
// and path/name based (no execution). Used to describe a blast radius in terms a
// developer cares about — "which tests and entry points does this reach?".

const TEST_PATTERNS = [
  "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/*_spec.*",
  "**/test/**", "**/tests/**", "**/__tests__/**",
];
const testRegexes = TEST_PATTERNS.map(globToRegExp);

export function isTestFile(path: string): boolean {
  return testRegexes.some((r) => r.test(path));
}

/**
 * Classify a likely entry point and return its kind, or null. Covers common
 * conventions across ecosystems: main/index/cli/app/server files, API routes,
 * and pages/routes directories.
 */
export function entryKind(path: string): string | null {
  const base = path.replace(/^.*\//, "");
  if (/^(main|index|cli|app|server|__main__)\.[^.]+$/.test(base)) return "main";
  if (/(^|\/)(pages)\//.test(path)) return "page/route";
  if (/(^|\/)(routes?)\//.test(path)) return "route";
  if (/(^|\/)api\//.test(path)) return "api route";
  if (/(^|\/)(handlers?|controllers?)\//.test(path)) return "handler";
  if (/^(setup|conftest)\.[^.]+$/.test(base)) return "entry";
  return null;
}

/** The base name without any extensions, e.g. "session.test.ts" → "session". */
export function stem(path: string): string {
  const base = path.replace(/^.*\//, "");
  return base.replace(/\.[^.]*$/, "").replace(/\.(test|spec)$/, "").replace(/_(test|spec)$/, "");
}
