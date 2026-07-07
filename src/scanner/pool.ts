import { Worker } from "node:worker_threads";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ParseResult, ParseTask } from "./parseWorker.js";

// A small worker pool that parses source text across CPU cores. Each worker gets
// chunks of tasks round-robin and pulls a new chunk whenever it finishes, so
// work stays balanced. Falls back gracefully (the caller parses synchronously)
// when the compiled worker file isn't present — e.g. under the tsx dev loader.

const workerUrl = new URL("./parseWorker.js", import.meta.url);

export function poolAvailable(): boolean {
  try {
    return fs.existsSync(fileURLToPath(workerUrl));
  } catch {
    return false;
  }
}

export function parseTexts(tasks: ParseTask[], poolSize = defaultPoolSize()): Promise<Map<string, ParseResult>> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, ParseResult>();
    if (!tasks.length) return resolve(results);

    const chunkSize = 25;
    let cursor = 0;
    let pending = tasks.length;
    const workers: Worker[] = [];
    const n = Math.max(1, Math.min(poolSize, Math.ceil(tasks.length / chunkSize)));

    const nextChunk = (): ParseTask[] | null => {
      if (cursor >= tasks.length) return null;
      const c = tasks.slice(cursor, cursor + chunkSize);
      cursor += c.length;
      return c;
    };

    const finish = () => { for (const w of workers) w.terminate(); resolve(results); };

    for (let i = 0; i < n; i++) {
      const w = new Worker(workerUrl);
      workers.push(w);
      w.on("message", (msg: { ready?: boolean; results?: ParseResult[] }) => {
        if (msg.ready) { const c = nextChunk(); if (c) w.postMessage({ files: c }); else w.terminate(); return; }
        for (const r of msg.results ?? []) { results.set(r.rel, r); pending--; }
        const c = nextChunk();
        if (c) w.postMessage({ files: c });
        else w.terminate();
        if (pending <= 0) finish();
      });
      w.on("error", reject);
    }
  });
}

function defaultPoolSize(): number {
  return Math.max(2, Math.min(os.cpus().length - 1, 8));
}
