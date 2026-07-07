import type { GovernanceResult } from "./index.js";

// Report generators for pull requests and CI: JSON (machine), Markdown (PR
// comments), and a self-contained HTML page (artifacts). Pure string builders.

export function healthReportJson(result: GovernanceResult): string {
  return JSON.stringify(result, null, 2);
}

export function markdownReport(result: GovernanceResult): string {
  const h = result.health;
  const t = result.trend;
  const arrow = (n: number) => (n > 0 ? `▲ +${n}` : n < 0 ? `▼ ${n}` : "±0");
  const cats = [
    ["Maintainability", h.maintainability], ["Stability", h.stability], ["Modularity", h.modularity],
    ["Coupling", h.coupling], ["Complexity", h.complexity],
  ] as const;

  let md = `# Architecture Report\n\n`;
  md += `**Health Score: ${h.overall}/100 (grade ${result.grade})**`;
  if (t.direction !== "first-scan") md += ` — trend: ${t.direction} (${arrow(t.healthDelta)})`;
  md += `\n\n| Category | Score |\n| --- | ---: |\n`;
  for (const [name, score] of cats) md += `| ${name} | ${score} |\n`;

  md += `\n## Summary\n\n`;
  md += `- ${h.factors.files} files, ${h.factors.edges} dependencies\n`;
  md += `- ${h.factors.cycles} cycles · ${h.factors.godModules} God modules · ${h.factors.unused} possibly-unused\n`;
  md += `- Violations: **${result.violationCounts.error} error**, ${result.violationCounts.warning} warning\n`;
  if (t.previous) {
    md += `\n## Trend since last scan\n\n`;
    md += `- Health ${arrow(t.healthDelta)} · Coupling ${arrow(t.couplingDelta)} · Cycles ${arrow(t.cyclesDelta)} · God modules ${arrow(t.godModulesDelta)}\n`;
  }
  if (result.criticalViolations.length) {
    md += `\n## Critical violations\n\n`;
    for (const v of result.criticalViolations.slice(0, 20)) md += `- \`${v.rule}\` — ${v.detail}\n`;
  }
  if (result.topHotspots.length) {
    md += `\n## Top hotspots\n\n`;
    for (const hs of result.topHotspots.slice(0, 8)) md += `- **${hs.score}** ${hs.path} — ${hs.reasons.join(", ")}\n`;
  }
  return md;
}

export function htmlReport(result: GovernanceResult): string {
  const h = result.health;
  const color = (s: number) => `hsl(${Math.round((s / 100) * 120)},70%,45%)`;
  const cats = [
    ["Maintainability", h.maintainability], ["Stability", h.stability], ["Modularity", h.modularity],
    ["Coupling", h.coupling], ["Complexity", h.complexity],
  ] as const;
  const bar = (label: string, score: number) => `
    <div class="cat"><div class="cat-top"><span>${label}</span><span>${score}</span></div>
    <div class="bar"><span style="width:${score}%;background:${color(score)}"></span></div></div>`;
  const violations = result.criticalViolations.slice(0, 40)
    .map((v) => `<li><code>${esc(v.rule)}</code> — ${esc(v.detail)}</li>`).join("");
  const hotspots = result.topHotspots.slice(0, 10)
    .map((hs) => `<li><b>${hs.score}</b> ${esc(hs.path)} <span class="muted">${esc(hs.reasons.join(", "))}</span></li>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Architecture Report</title>
<style>
  body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:32px;max-width:840px;margin:auto}
  h1{font-size:22px} .muted{color:#8b949e}
  .score{font-size:64px;font-weight:800;color:${color(h.overall)}}
  .grade{font-size:20px;color:#8b949e;margin-left:8px}
  .cat{margin:10px 0} .cat-top{display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px}
  .bar{height:8px;background:#161b22;border-radius:4px;overflow:hidden}.bar span{display:block;height:100%}
  .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 20px;margin:16px 0}
  code{background:#21262d;padding:1px 5px;border-radius:4px} ul{padding-left:18px} li{margin:3px 0}
  table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #30363d;padding:4px 8px;text-align:left}
</style></head><body>
  <h1>Architecture Report <span class="muted">— ${esc(result.root)}</span></h1>
  <div class="card"><div class="score">${h.overall}<span class="grade">/100 · grade ${result.grade} · ${esc(result.trend.direction)}</span></div>
    ${cats.map(([n, s]) => bar(n, s)).join("")}</div>
  <div class="card"><h3>Summary</h3>
    <table><tr><td>Files</td><td>${h.factors.files}</td><td>Dependencies</td><td>${h.factors.edges}</td></tr>
    <tr><td>Cycles</td><td>${h.factors.cycles}</td><td>God modules</td><td>${h.factors.godModules}</td></tr>
    <tr><td>Possibly unused</td><td>${h.factors.unused}</td><td>Avg coupling</td><td>${h.factors.avgDegree}</td></tr>
    <tr><td>Violations</td><td style="color:#ff7b72">${result.violationCounts.error} error</td><td>Warnings</td><td>${result.violationCounts.warning}</td></tr></table></div>
  ${violations ? `<div class="card"><h3>Critical violations</h3><ul>${violations}</ul></div>` : ""}
  ${hotspots ? `<div class="card"><h3>Top hotspots</h3><ul>${hotspots}</ul></div>` : ""}
  <p class="muted">Generated ${esc(result.generatedAt)} by CodeMap.</p>
</body></html>`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
