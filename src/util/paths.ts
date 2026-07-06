import path from "node:path";

/** Convert a native path to POSIX separators (stable ids across platforms). */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
