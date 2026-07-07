import type { GovernanceData, HealthScore, Trend, HealthSnapshot } from "../model/types.js";

// The Governance Dashboard panel — fetches /api/governance and renders:
//   • Health score gauge + grade
//   • 5 sub-score bars
//   • Trend summary + sparkline
//   • Violations list (errors first, then warnings)
//   • Top hotspots (with map-focus on click)
// Pure presentation: reads the store only for click routing; never mutates the graph.

export class Governance {
  private data: GovernanceData | null = null;
  private onFocus: ((id: string) => void) | null = null;

  constructor(private el: HTMLElement) {
    this.load();
  }

  /** Optional callback: called when user clicks a hotspot file. */
  setFocusHandler(fn: (id: string) => void): void {
    this.onFocus = fn;
  }

  private async load(): Promise<void> {
    this.el.innerHTML = `<p class="loading">Loading governance data…</p>`;
    try {
      this.data = await fetch("/api/governance").then((r) => r.json());
    } catch {
      this.el.innerHTML = `<p class="muted">Governance data unavailable.</p>`;
      return;
    }
    this.render();
  }

  private render(): void {
    const d = this.data!;
    const h = d.health;
    const t = d.trend;

    this.el.innerHTML = `
      ${this.scoreCard(h, d.grade, t)}
      ${this.subScores(h)}
      ${this.trendCard(t)}
      ${this.violationsCard(d)}
      ${this.hotspotsCard(d)}
    `;
    this.wire();
  }

  // ── Health score card ────────────────────────────────────────────────────

  private scoreCard(h: HealthScore, grade: string, t: Trend): string {
    const hue = Math.round((h.overall / 100) * 120);
    const color = `hsl(${hue},70%,55%)`;
    const trendBadge = t.direction !== "first-scan"
      ? `<span class="gov-trend-badge gov-trend-${t.direction}">${trendIcon(t.direction)} ${t.direction}</span>`
      : `<span class="gov-trend-badge gov-trend-first">first scan</span>`;
    const f = h.factors;
    return `
      <div class="gov-card gov-score-card">
        <div class="gov-score-row">
          ${ring(h.overall, color)}
          <div class="gov-score-meta">
            <div class="gov-grade" style="color:${color}">${grade}</div>
            <div class="gov-score-label">Health Score</div>
            ${trendBadge}
          </div>
        </div>
        <div class="gov-facts">
          <span>${f.files} files</span>
          <span>${f.edges} deps</span>
          <span class="${f.cycles ? "gov-bad" : ""}">${f.cycles} cycles</span>
          <span class="${f.godModules ? "gov-warn" : ""}">${f.godModules} god mods</span>
          <span class="${f.violations.error ? "gov-bad" : f.violations.warning ? "gov-warn" : "gov-ok"}">${f.violations.error}e ${f.violations.warning}w</span>
        </div>
      </div>`;
  }

  // ── Sub-score bars ───────────────────────────────────────────────────────

  private subScores(h: HealthScore): string {
    const cats: [string, number][] = [
      ["Maintainability", h.maintainability],
      ["Stability", h.stability],
      ["Modularity", h.modularity],
      ["Coupling", h.coupling],
      ["Complexity", h.complexity],
    ];
    const bars = cats.map(([label, score]) => {
      const hue = Math.round((score / 100) * 120);
      return `<div class="gov-sub">
        <div class="gov-sub-top"><span>${esc(label)}</span><span style="color:hsl(${hue},65%,55%)">${score}</span></div>
        <div class="gov-bar"><span style="width:${score}%;background:hsl(${hue},65%,45%)"></span></div>
      </div>`;
    }).join("");
    return `<div class="gov-card">${bars}</div>`;
  }

  // ── Trend card ───────────────────────────────────────────────────────────

  private trendCard(t: Trend): string {
    if (t.direction === "first-scan") {
      return `<div class="gov-card gov-muted-card">No previous scan — trend will appear after the next run.</div>`;
    }
    const prev = t.previous!;
    const rows = [
      ["Health", t.healthDelta, "pts"],
      ["Coupling (avg degree)", t.couplingDelta, ""],
      ["Cycles", t.cyclesDelta, ""],
      ["God modules", t.godModulesDelta, ""],
    ].map(([label, delta, unit]) => {
      const d = Number(delta);
      const cls = d > 0 ? "gov-up" : d < 0 ? "gov-dn" : "gov-nc";
      const sign = d > 0 ? "+" : "";
      const icon = d > 0 ? "▲" : d < 0 ? "▼" : "·";
      return `<div class="gov-trend-row">
        <span class="gov-trend-label">${esc(String(label))}</span>
        <span class="${cls}">${icon} ${sign}${d}${unit}</span>
      </div>`;
    }).join("");

    const spark = sparkline(t.history);
    return `
      <div class="gov-card">
        <div class="gov-section-title">Trend <span class="gov-muted">(vs last scan)</span></div>
        ${rows}
        <div class="gov-spark-wrap" title="Health score over last ${t.history.length} scans">
          ${spark}
        </div>
      </div>`;
  }

  // ── Violations card ──────────────────────────────────────────────────────

  private violationsCard(d: GovernanceData): string {
    const errs = d.violations.filter((v) => v.severity === "error");
    const warns = d.violations.filter((v) => v.severity === "warning");
    if (!d.violations.length) {
      return `<div class="gov-card gov-ok-card">✓ No violations</div>`;
    }
    const rows = (list: typeof d.violations, cls: string, icon: string) =>
      list.slice(0, 25).map((v) => `
        <li class="gov-viol">
          <span class="gov-viol-icon ${cls}">${icon}</span>
          <span class="gov-viol-body">
            <span class="gov-viol-rule">${esc(v.rule)}</span>
            ${v.file ? `<span class="gov-viol-file mono">${esc(base(v.file))}</span>` : ""}
            <span class="gov-viol-detail muted">${esc(v.detail)}</span>
          </span>
        </li>`).join("");

    const more = d.violations.length > 25
      ? `<li class="muted gov-viol-more">…and ${d.violations.length - 25} more violations</li>` : "";

    return `
      <div class="gov-card">
        <div class="gov-section-title">
          Violations
          ${errs.length ? `<span class="gov-pill gov-pill-err">${errs.length} error</span>` : ""}
          ${warns.length ? `<span class="gov-pill gov-pill-warn">${warns.length} warning</span>` : ""}
        </div>
        <ul class="gov-viol-list">
          ${rows(errs, "gov-err", "✗")}
          ${rows(warns, "gov-warn-ic", "⚠")}
          ${more}
        </ul>
      </div>`;
  }

  // ── Hotspots card ────────────────────────────────────────────────────────

  private hotspotsCard(d: GovernanceData): string {
    if (!d.topHotspots.length) return "";
    const items = d.topHotspots.slice(0, 8).map((h) => {
      const hue = Math.round(((100 - h.score) / 100) * 120);
      return `<li class="gov-hs" data-goto="${esc(h.id)}">
        <span class="gov-hs-score" style="color:hsl(${hue},70%,60%)">${h.score}</span>
        <span class="gov-hs-body">
          <span class="gov-hs-name mono">${esc(base(h.path))}</span>
          <span class="gov-hs-reasons muted">${esc(h.reasons.join(", "))}</span>
        </span>
      </li>`;
    }).join("");
    return `
      <div class="gov-card">
        <div class="gov-section-title">Top Hotspots</div>
        <ul class="gov-hs-list">${items}</ul>
      </div>`;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  private wire(): void {
    this.el.querySelectorAll<HTMLElement>("[data-goto]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-goto")!;
        this.onFocus?.(id);
      });
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ring(score: number, color: string): string {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return `
    <svg class="gov-ring" viewBox="0 0 72 72" width="72" height="72">
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--panel-2)" stroke-width="7"/>
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color}" stroke-width="7"
        stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
        stroke-dashoffset="${(circ / 4).toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 36 36)"/>
      <text x="36" y="41" text-anchor="middle" font-size="16" font-weight="800" fill="${color}">${score}</text>
    </svg>`;
}

function sparkline(history: HealthSnapshot[]): string {
  if (history.length < 2) return `<span class="gov-muted" style="font-size:11px">Not enough history for sparkline</span>`;
  const W = 240, H = 40, pad = 4;
  const vals = history.map((s) => s.overall);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const range = mx - mn || 1;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - mn) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = vals[vals.length - 1];
  const hue = Math.round((last / 100) * 120);
  return `
    <svg class="gov-sparkline" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <polyline points="${pts}" fill="none" stroke="hsl(${hue},65%,50%)" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
}

function trendIcon(d: string): string {
  return d === "improving" ? "▲" : d === "declining" ? "▼" : "→";
}

function base(p: string): string {
  return p.replace(/^.*\//, "");
}

function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
