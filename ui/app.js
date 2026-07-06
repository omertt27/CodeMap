/* CodeMap UI — 2D (Cytoscape) + 3D (force-graph) views over the same graph. */
(async function () {
  const [graph, summary, symbols] = await Promise.all([
    fetch("/graph.json").then((r) => r.json()),
    fetch("/summary.json").then((r) => r.json()),
    fetch("/symbols.json").then((r) => r.json()),
  ]);

  const LANG_COLOR = { python: "#3776ab", javascript: "#f0db4f", typescript: "#3178c6", java: "#b07219" };
  const KIND_COLOR = { function: "#7ee787", class: "#d2a8ff" };
  const DIM = "rgba(130,140,150,0.12)";

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const symbolById = new Map(symbols.symbols.map((s) => [s.id, s]));

  // File dependency degrees drive node size (importance).
  const inDeg = new Map(), outDeg = new Map();
  for (const n of graph.nodes) { inDeg.set(n.id, 0); outDeg.set(n.id, 0); }
  for (const e of graph.edges) {
    outDeg.set(e.source, (outDeg.get(e.source) || 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
  }

  const baseColor = (n) => n.ntype === "file" ? (LANG_COLOR[n.lang] || "#888") : KIND_COLOR[n.ntype];

  // ---- neutral model shared by both renderers ------------------------------
  function buildModel(mode) {
    const nodes = graph.nodes.map((n) => ({
      id: n.id, label: n.name, ntype: "file", lang: n.lang, path: n.path,
      indeg: inDeg.get(n.id) || 0,
    }));
    const links = graph.edges.map((e) => ({ source: e.source, target: e.target, ltype: "import" }));
    if (mode === "symbol") {
      for (const s of symbols.symbols) {
        nodes.push({ id: s.id, label: s.name, ntype: s.kind, lang: s.lang, path: s.path,
          line: s.line, exported: s.exported, parent: s.file });
      }
      for (const c of symbols.contains) links.push({ source: c.source, target: c.target, ltype: "contains" });
    }
    return { nodes, links };
  }

  // =========================================================================
  // State
  // =========================================================================
  const state = { view: "2d", mode: "file", focusId: null, searchIds: null };

  // =========================================================================
  // 2D renderer (Cytoscape)
  // =========================================================================
  const cy = cytoscape({
    container: document.getElementById("cy"),
    wheelSensitivity: 0.2,
    style: [
      { selector: "node", style: {
          "background-color": (e) => baseColor(e.data()),
          label: "data(label)", color: "#c9d1d9", "font-size": 9,
          "text-valign": "bottom", "text-margin-y": 3,
          "text-outline-color": "#0d1117", "text-outline-width": 2,
          "min-zoomed-font-size": 7, "border-width": 0,
          "transition-property": "opacity, border-width, border-color", "transition-duration": "0.18s",
      } },
      { selector: "node.file", style: { width: "data(size)", height: "data(size)" } },
      { selector: "node.function, node.class", style: { width: 12, height: 12, shape: "ellipse", "font-size": 7 } },
      { selector: "node.class", style: { shape: "round-rectangle" } },
      { selector: "node.grouped", style: {
          "background-opacity": 0.06, "background-color": (e) => LANG_COLOR[e.data("lang")] || "#888",
          shape: "round-rectangle", "border-width": 1, "border-color": (e) => LANG_COLOR[e.data("lang")] || "#888",
          "border-opacity": 0.5, label: "data(label)", color: "#8b949e",
          "text-valign": "top", "text-margin-y": -2, "font-size": 9, padding: 8,
      } },
      { selector: "edge", style: {
          width: 1, "line-color": "#384049", "target-arrow-color": "#384049",
          "target-arrow-shape": "triangle", "arrow-scale": 0.7, "curve-style": "bezier", opacity: 0.5,
          "transition-property": "opacity, line-color, width", "transition-duration": "0.18s",
      } },
      { selector: "edge.contains", style: { "line-color": "#2a3441", "line-style": "dashed", "target-arrow-shape": "none", opacity: 0.35 } },
      { selector: "node.faded", style: { opacity: 0.1, "text-opacity": 0 } },
      { selector: "edge.faded", style: { opacity: 0.04 } },
      { selector: "node.selected", style: { "border-width": 3, "border-color": "#58a6ff", "border-opacity": 1 } },
      { selector: "node.neighbor", style: { "border-width": 2, "border-color": "#8b949e", "border-opacity": 1 } },
      { selector: "edge.hl", style: { "line-color": "#58a6ff", "target-arrow-color": "#58a6ff", opacity: 1, width: 2 } },
      { selector: "node.nolabel", style: { label: "" } },
    ],
  });

  function cyLayout() {
    return { name: "cose", animate: true, animationDuration: 500, nodeRepulsion: 8000,
      idealEdgeLength: 90, gravity: 0.3, numIter: 1000, componentSpacing: 90, nestingFactor: 1.2 };
  }

  function rebuild2D() {
    const model = buildModel(state.mode);
    const els = [];
    for (const n of model.nodes) {
      const classes = [n.ntype];
      if (n.ntype === "file" && state.mode === "symbol") classes.push("grouped");
      els.push({ data: {
        id: n.id, label: n.label, lang: n.lang, ntype: n.ntype,
        size: 18 + Math.min(40, (n.indeg || 0) * 6), parent: n.parent,
      }, classes: classes.join(" ") });
    }
    for (const l of model.links) {
      // Containment is expressed by compound parenting in 2D — no extra edge.
      if (l.ltype === "contains") continue;
      els.push({ data: { id: `${l.source}->${l.target}`, source: l.source, target: l.target }, classes: "import" });
    }
    cy.elements().remove();
    cy.add(els);
    cy.layout(cyLayout()).run();
  }

  cy.on("tap", "node", (e) => onSelect(e.target.id()));
  cy.on("tap", (e) => { if (e.target === cy) clearFocus(); });

  const renderer2D = {
    focus(id) {
      const node = cy.getElementById(id);
      if (node.empty()) return;
      const hood = node.closedNeighborhood();
      cy.batch(() => {
        cy.elements().addClass("faded");
        hood.removeClass("faded");
        cy.nodes().removeClass("selected neighbor");
        node.removeClass("faded").addClass("selected");
        hood.nodes().not(node).addClass("neighbor");
        node.connectedEdges().removeClass("faded").addClass("hl");
      });
    },
    clear() { cy.elements().removeClass("faded selected neighbor hl"); },
    center(id) {
      const node = cy.getElementById(id);
      if (node.empty()) return;
      cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.3) }, { duration: 350, easing: "ease-in-out-cubic" });
    },
    search(ids) {
      cy.batch(() => {
        if (!ids) { cy.nodes().removeClass("faded"); cy.edges().removeClass("faded"); return; }
        cy.nodes().forEach((nd) => nd.toggleClass("faded", !ids.has(nd.id())));
        cy.edges().addClass("faded");
      });
    },
    fit() { cy.animate({ fit: { padding: 40 } }, { duration: 300 }); },
    relayout() { cy.layout(cyLayout()).run(); },
    labels(on) { cy.nodes().toggleClass("nolabel", !on); },
  };

  // =========================================================================
  // 3D renderer (3d-force-graph) — created lazily
  // =========================================================================
  let g3d = null;
  const hl = { nodes: new Set(), links: new Set() };

  function ensure3D() {
    if (g3d) return g3d;
    const el = document.getElementById("graph3d");
    g3d = ForceGraph3D()(el)
      .backgroundColor("#0d1117")
      .width(el.clientWidth).height(el.clientHeight)
      .nodeLabel((n) => `${n.label}  ·  ${n.path}`)
      .nodeVal((n) => n.ntype === "file" ? 2 + (n.indeg || 0) * 1.5 : 1)
      .nodeColor(node3dColor)
      .nodeOpacity(0.95)
      .linkColor(link3dColor)
      .linkWidth((l) => hl.links.has(l) ? 1.4 : 0.4)
      .linkDirectionalArrowLength(2.5).linkDirectionalArrowRelPos(1)
      .linkDirectionalParticles((l) => hl.links.has(l) ? 3 : 0)
      .linkDirectionalParticleSpeed(0.01).linkDirectionalParticleWidth(1.6)
      .onNodeClick((n) => onSelect(n.id, n))
      .onBackgroundClick(() => clearFocus());
    window.addEventListener("resize", () => {
      if (state.view !== "3d") return;
      g3d.width(el.clientWidth).height(el.clientHeight);
    });
    return g3d;
  }

  function node3dColor(n) {
    if (state.searchIds && !state.searchIds.has(n.id)) return DIM;
    if (state.focusId && !hl.nodes.has(n.id)) return DIM;
    if (n.id === state.focusId) return "#58a6ff";
    return baseColor(n);
  }
  function link3dColor(l) {
    const srcId = l.source.id || l.source, tgtId = l.target.id || l.target;
    if (state.searchIds && !(state.searchIds.has(srcId) && state.searchIds.has(tgtId))) return DIM;
    if (hl.links.has(l)) return "#58a6ff";
    if (state.focusId) return DIM;
    return l.ltype === "contains" ? "rgba(120,130,140,0.25)" : "rgba(120,130,140,0.4)";
  }
  function refresh3D() {
    if (!g3d) return;
    g3d.nodeColor(node3dColor).linkColor(link3dColor)
      .linkWidth(g3d.linkWidth()).linkDirectionalParticles(g3d.linkDirectionalParticles());
  }

  function rebuild3D() {
    ensure3D().graphData(buildModel(state.mode));
  }

  const renderer3D = {
    focus(id) {
      hl.nodes.clear(); hl.links.clear();
      const data = g3d.graphData();
      hl.nodes.add(id);
      for (const l of data.links) {
        const s = l.source.id || l.source, t = l.target.id || l.target;
        if (s === id || t === id) { hl.links.add(l); hl.nodes.add(s); hl.nodes.add(t); }
      }
      refresh3D();
    },
    clear() { hl.nodes.clear(); hl.links.clear(); refresh3D(); },
    center(id) {
      const n = g3d.graphData().nodes.find((x) => x.id === id);
      if (!n || n.x == null) return;
      const d = 90, r = 1 + d / Math.hypot(n.x, n.y, n.z || 1);
      g3d.cameraPosition({ x: n.x * r, y: n.y * r, z: (n.z || 1) * r }, n, 1000);
    },
    search(ids) { refresh3D(); },
    fit() { g3d.zoomToFit(600, 40); },
    relayout() { g3d.numDimensions(3); g3d.d3ReheatSimulation(); },
    labels() { /* 3D labels are hover tooltips */ },
  };

  const R = () => (state.view === "3d" ? renderer3D : renderer2D);

  // =========================================================================
  // Selection / details (shared)
  // =========================================================================
  function onSelect(id) {
    state.focusId = id;
    R().focus(id);
    if (id.startsWith("sym:")) showSymbolDetails(symbolById.get(id));
    else showFileDetails(nodeById.get(id));
  }
  function clearFocus() {
    state.focusId = null;
    R().clear();
    hideDetails();
  }
  function centerOn(id) {
    if (state.mode !== "symbol" && id.startsWith("sym:")) return;
    onSelect(id);
    R().center(id);
  }

  const details = document.getElementById("details");
  const detailsBody = document.getElementById("details-body");
  document.getElementById("details-close").onclick = clearFocus;

  function showFileDetails(n) {
    if (!n) return;
    const imports = n.imports || [];
    const internal = imports.filter((i) => i.resolved);
    const external = imports.filter((i) => !i.resolved);
    const importers = graph.edges.filter((e) => e.target === n.id).map((e) => nodeById.get(e.source));
    detailsBody.innerHTML = `
      <h3>${esc(n.name)}</h3>
      <div class="path mono">${esc(n.path)}</div>
      <div class="badges">
        <span class="badge" style="border-color:${LANG_COLOR[n.lang]}">${n.lang}</span>
        <span class="badge">${n.loc} LOC</span>
        <span class="badge">${inDeg.get(n.id) || 0} in · ${outDeg.get(n.id) || 0} out</span>
      </div>
      ${listSection("Imports (internal)", internal.map((i) => linkRow(i.line, nodeById.get("file:" + i.resolved))))}
      ${external.length ? section("External dependencies", `<ul>${external.map((i) => `<li><span class="ln">${i.line}</span><span class="ext mono">${esc(i.raw)}</span></li>`).join("")}</ul>`) : ""}
      ${listSection("Imported by", importers.map((m) => linkRow(null, m)))}
      ${symbolSection("Functions", n.functions, n.path)}
      ${symbolSection("Classes", n.classes, n.path)}
      ${n.exports && n.exports.length ? section("Exports", `<ul>${n.exports.map((x) => `<li><span class="mono">${esc(x)}</span></li>`).join("")}</ul>`) : ""}
    `;
    wireGoto();
    details.classList.remove("hidden");
  }

  function showSymbolDetails(s) {
    if (!s) return;
    const owner = nodeById.get(s.file);
    detailsBody.innerHTML = `
      <h3>${esc(s.name)}</h3>
      <div class="path mono">${esc(s.path)}:${s.line}</div>
      <div class="badges">
        <span class="badge" style="border-color:${KIND_COLOR[s.kind]}">${s.kind}</span>
        <span class="badge">${s.exported ? "exported" : "local"}</span>
        <span class="badge">line ${s.line}</span>
      </div>
      ${section("Defined in", `<ul>${linkRow(null, owner)}</ul>`)}
      ${owner ? symbolSection("Sibling functions", owner.functions.filter((f) => f.name !== s.name), owner.path) : ""}
      ${owner ? symbolSection("Sibling classes", owner.classes.filter((c) => c.name !== s.name), owner.path) : ""}
    `;
    wireGoto();
    details.classList.remove("hidden");
  }

  function hideDetails() { details.classList.add("hidden"); }
  function wireGoto() {
    detailsBody.querySelectorAll("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => centerOn(el.getAttribute("data-goto"))));
  }
  function linkRow(line, node) {
    if (!node) return "";
    const ln = line != null ? `<span class="ln">${line}</span>` : `<span class="ln"></span>`;
    return `<li>${ln}<span class="lnk" data-goto="${esc(node.id)}">${esc(node.path)}</span></li>`;
  }
  function symbolSection(title, arr, filePath) {
    if (!arr || !arr.length) return "";
    const items = arr.map((s) => {
      const symId = `sym:${filePath}#${s.kind}:${s.name}@${s.line}`;
      const nav = state.mode === "symbol" ? ` data-goto="${esc(symId)}"` : "";
      return `<li><span class="ln">${s.line}</span><span class="mono lnk"${nav}>${esc(s.name)}${s.exported ? " ·" : ""}</span></li>`;
    }).join("");
    return section(`${title} (${arr.length})`, `<ul>${items}</ul>`);
  }
  function listSection(title, rows) {
    const filled = rows.filter(Boolean);
    return filled.length ? section(title, `<ul>${filled.join("")}</ul>`) : section(title, `<div class="empty">none</div>`);
  }
  function section(title, inner) { return `<div class="detail-section"><h4>${esc(title)}</h4>${inner}</div>`; }

  // =========================================================================
  // Sidebar
  // =========================================================================
  document.getElementById("root-path").textContent = graph.root;
  const stat = (v, l) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`;
  document.getElementById("stats").innerHTML =
    stat(summary.files, "Files") + stat(summary.edges, "Edges") +
    stat(summary.functions, "Functions") + stat(summary.classes, "Classes");
  document.getElementById("legend").innerHTML = Object.entries(summary.languages)
    .map(([lang, count]) => `<li><span class="dot" style="background:${LANG_COLOR[lang] || "#888"}"></span>${lang} (${count})</li>`).join("") +
    `<li><span class="dot" style="background:${KIND_COLOR.function}"></span>function</li>` +
    `<li><span class="dot" style="background:${KIND_COLOR.class}"></span>class</li>`;

  document.getElementById("hubs").innerHTML = summary.hubs.length
    ? summary.hubs.map((h) => `<li data-goto="file:${esc(h.path)}"><span class="p">${esc(h.path)}</span><span class="n">${h.inDegree}</span></li>`).join("")
    : `<li class="p muted">No internal dependencies found</li>`;
  document.querySelectorAll("#hubs li[data-goto]").forEach((el) =>
    el.addEventListener("click", () => centerOn(el.getAttribute("data-goto"))));

  if (summary.cycles && summary.cycles.length) {
    document.getElementById("cycles-panel").hidden = false;
    const ul = document.getElementById("cycles");
    ul.innerHTML = summary.cycles.map((c) => `<li>${c.map(esc).join(" → ")}</li>`).join("");
    ul.classList.add("warn");
  }

  // =========================================================================
  // Search
  // =========================================================================
  const searchInput = document.getElementById("search");
  const searchResults = document.getElementById("search-results");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { state.searchIds = null; searchResults.innerHTML = ""; R().search(null); return; }
    const matches = graph.nodes.filter((n) => n.path.toLowerCase().includes(q)).slice(0, 40);
    searchResults.innerHTML = matches.map((n) => `<div class="result" data-goto="${esc(n.id)}">${highlight(n.path, q)}</div>`).join("");
    searchResults.querySelectorAll("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => centerOn(el.getAttribute("data-goto"))));
    state.searchIds = new Set(matches.map((n) => n.id));
    R().search(state.searchIds);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = searchResults.querySelector("[data-goto]");
      if (first) centerOn(first.getAttribute("data-goto"));
    }
  });

  // =========================================================================
  // Toolbar: view (2D/3D) + mode (files/symbols) + fit/relayout/labels
  // =========================================================================
  document.querySelectorAll("#view-seg button").forEach((btn) =>
    btn.addEventListener("click", () => setView(btn.dataset.view)));
  document.querySelectorAll("#mode-seg button").forEach((btn) =>
    btn.addEventListener("click", () => setMode(btn.dataset.mode)));

  function setView(view) {
    if (view === state.view) return;
    state.view = view;
    document.querySelectorAll("#view-seg button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    document.body.classList.toggle("view-3d", view === "3d");
    if (view === "3d") {
      rebuild3D();
      g3d.resumeAnimation && g3d.resumeAnimation();
      const el = document.getElementById("graph3d");
      g3d.width(el.clientWidth).height(el.clientHeight);
      setTimeout(() => g3d.zoomToFit(500, 50), 400);
    } else if (g3d && g3d.pauseAnimation) {
      g3d.pauseAnimation();
    }
    if (state.focusId) R().focus(state.focusId);
    R().search(state.searchIds);
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    document.querySelectorAll("#mode-seg button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    clearFocus();
    rebuild2D();
    if (g3d) rebuild3D();
  }

  document.getElementById("fit").onclick = () => R().fit();
  document.getElementById("relayout").onclick = () => R().relayout();
  document.getElementById("labels-toggle").onchange = (e) => renderer2D.labels(e.target.checked);

  // ---- boot ----------------------------------------------------------------
  rebuild2D();
  cy.ready(() => cy.fit(undefined, 40));

  function highlight(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<b>" + esc(text.slice(i, i + q.length)) + "</b>" + esc(text.slice(i + q.length));
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
