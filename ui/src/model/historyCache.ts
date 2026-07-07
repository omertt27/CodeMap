import type { HistoryReport } from "./types.js";

// Fetched once, shared by the History panel and the sidebar.

let cache: Promise<HistoryReport> | null = null;

export function getHistory(): Promise<HistoryReport> {
  return (cache ??= fetch("/api/history").then((r) => r.json()));
}

export function churnMap(report: HistoryReport): Map<string, { level: string; churn: number; commits: number }> {
  return new Map(report.churn.map((c) => [c.path, { level: c.level, churn: c.churn, commits: c.commits }]));
}

export function stabilityMap(report: HistoryReport): Map<string, number> {
  return new Map(report.stability.map((s) => [s.path, s.stability]));
}
