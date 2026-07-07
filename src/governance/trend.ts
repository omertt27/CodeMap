import fs from "node:fs";
import path from "node:path";
import type { HealthScore } from "./health.js";

// Trend analysis: persist a small time series of health snapshots (one per scan)
// and report how the architecture is moving — the answer to "is our architecture
// getting healthier or worse?". Stored in `.codemap/health-history.json`.

export interface HealthSnapshot {
  timestamp: string;
  overall: number;
  maintainability: number;
  stability: number;
  modularity: number;
  coupling: number;
  complexity: number;
  cycles: number;
  godModules: number;
  hotspotAvg: number;
  avgDegree: number;
  unused: number;
}

export interface Trend {
  direction: "improving" | "declining" | "stable" | "first-scan";
  healthDelta: number;
  couplingDelta: number; // change in avgDegree (positive = more coupled)
  cyclesDelta: number;
  hotspotsDelta: number;
  godModulesDelta: number;
  previous: HealthSnapshot | null;
  current: HealthSnapshot;
  history: HealthSnapshot[];
}

const MAX_HISTORY = 100;

export function recordTrend(root: string, health: HealthScore, opts: { save?: boolean } = {}): Trend {
  const file = path.join(path.resolve(root), ".codemap", "health-history.json");
  const history = load(file);
  const previous = history.length ? history[history.length - 1] : null;

  const current: HealthSnapshot = {
    timestamp: new Date().toISOString(),
    overall: health.overall,
    maintainability: health.maintainability,
    stability: health.stability,
    modularity: health.modularity,
    coupling: health.coupling,
    complexity: health.complexity,
    cycles: health.factors.cycles,
    godModules: health.factors.godModules,
    hotspotAvg: health.factors.hotspotAvg,
    avgDegree: health.factors.avgDegree,
    unused: health.factors.unused,
  };

  const healthDelta = previous ? current.overall - previous.overall : 0;
  const trend: Trend = {
    direction: !previous ? "first-scan" : healthDelta > 2 ? "improving" : healthDelta < -2 ? "declining" : "stable",
    healthDelta,
    couplingDelta: previous ? +(current.avgDegree - previous.avgDegree).toFixed(2) : 0,
    cyclesDelta: previous ? current.cycles - previous.cycles : 0,
    hotspotsDelta: previous ? current.hotspotAvg - previous.hotspotAvg : 0,
    godModulesDelta: previous ? current.godModules - previous.godModules : 0,
    previous,
    current,
    history: [...history, current],
  };

  if (opts.save !== false) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(trend.history.slice(-MAX_HISTORY), null, 2));
    } catch {
      /* best-effort */
    }
  }
  return trend;
}

function load(file: string): HealthSnapshot[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
