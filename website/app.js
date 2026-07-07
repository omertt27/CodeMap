// CodeMap Web Experience Logic

document.addEventListener('DOMContentLoaded', () => {
  initCopyInstall();
  initMobileNav();
  initTerminalSimulator();
  initInteractiveGraph();
  initGovernanceWidget();
});

// 1. Copy Install Command
function initCopyInstall() {
  const copyBtn = document.getElementById('copy-install-btn');
  const installText = document.getElementById('npm-install-text').innerText;
  
  if (!copyBtn) return;
  
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(installText).then(() => {
      const statusText = copyBtn.querySelector('.copy-status');
      statusText.innerText = 'Copied!';
      copyBtn.style.color = '#10b981';
      
      setTimeout(() => {
        statusText.innerText = 'Copy';
        copyBtn.style.color = '';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });
}

// 2. Mobile Navigation Toggle
function initMobileNav() {
  const toggle = document.querySelector('.mobile-nav-toggle');
  const nav = document.querySelector('nav');
  
  if (!toggle) return;
  
  toggle.addEventListener('click', () => {
    nav.classList.toggle('active');
    toggle.classList.toggle('active');
    
    // Simple mobile Nav styles on toggle
    if (nav.classList.contains('active')) {
      nav.style.display = 'flex';
      nav.style.position = 'absolute';
      nav.style.top = '70px';
      nav.style.left = '0';
      nav.style.width = '100%';
      nav.style.backgroundColor = '#050814';
      nav.style.flexDirection = 'column';
      nav.style.padding = '20px';
      nav.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
      nav.style.zIndex = '99';
    } else {
      nav.style.display = '';
    }
  });
}

// 3. CLI Terminal Simulator
function initTerminalSimulator() {
  const termBody = document.getElementById('terminal-body');
  const scanBtn = document.getElementById('btn-run-scan-sim');
  const serveBtn = document.getElementById('btn-run-serve-sim');
  
  if (!termBody) return;
  
  const scanLines = [
    { text: 'codemap scan .', type: 'cmd' },
    { text: 'Scanning repository in current directory...', type: 'out' },
    { text: '✔ Discovered 453 files in workspace', type: 'info' },
    { text: '✔ Read incremental cache (412 files matched hashes)', type: 'success' },
    { text: '✔ Parsed 41 modified files on 4 worker threads [0.24s]', type: 'success' },
    { text: '✔ Built module dependency graph (538 nodes, 1,204 edges)', type: 'info' },
    { text: '✔ Analyzing structural code quality metrics...', type: 'out' },
    { text: '✔ Tarjan SCC: 0 circular dependencies detected', type: 'success' },
    { text: '✔ Saved graph document to .codemap/graph.json [0.08s]', type: 'success' },
    { text: '✔ Architecture Summary generated at .codemap/architecture-summary.json', type: 'success' },
    { text: 'CodeMap Health: 92/100 (Grade A)', type: 'health' }
  ];
  
  const serveLines = [
    { text: 'codemap serve .', type: 'cmd' },
    { text: 'Scanning repository in current directory...', type: 'out' },
    { text: '✔ Loaded cached graph.json (453 files, 1,204 edges)', type: 'success' },
    { text: '✔ Tarjan SCC: 0 circular dependencies detected', type: 'success' },
    { text: '✔ Loaded health score: 92/100 (Grade A)', type: 'success' },
    { text: 'Starting local web server...', type: 'out' },
    { text: '✔ HTTP API listening at http://127.0.0.1:4321', type: 'success' },
    { text: '✔ EventStream channel active for live updates', type: 'info' },
    { text: '✔ Launching system default browser...', type: 'success' },
    { text: 'Server active. Press Ctrl+C to stop.', type: 'warning' }
  ];
  
  let typingTimer = null;
  
  function runSimulation(lines) {
    if (typingTimer) clearInterval(typingTimer);
    termBody.innerHTML = '';
    
    let lineIdx = 0;
    
    function addNextLine() {
      if (lineIdx >= lines.length) {
        // Add final prompt line with cursor
        const pLine = document.createElement('div');
        pLine.className = 'term-line prompt-line';
        pLine.innerHTML = '<span class="term-prompt">~</span> <span class="cursor"></span>';
        termBody.appendChild(pLine);
        return;
      }
      
      const lineData = lines[lineIdx];
      const div = document.createElement('div');
      div.className = 'term-line output-line';
      
      if (lineData.type === 'cmd') {
        div.innerHTML = '<span class="term-prompt">~</span> <span class="term-command-text"></span>';
        termBody.appendChild(div);
        
        // Type out the command character by character
        const cmdSpan = div.querySelector('.term-command-text');
        let charIdx = 0;
        const text = lineData.text;
        
        const typeInterval = setInterval(() => {
          if (charIdx < text.length) {
            cmdSpan.innerText += text[charIdx];
            charIdx++;
          } else {
            clearInterval(typeInterval);
            lineIdx++;
            setTimeout(addNextLine, 350);
          }
        }, 50);
      } else {
        if (lineData.type === 'success') div.classList.add('text-success');
        else if (lineData.type === 'info') div.classList.add('text-info');
        else if (lineData.type === 'warning') div.classList.add('text-yellow');
        else if (lineData.type === 'health') {
          div.classList.add('text-cyan');
          div.style.fontWeight = 'bold';
          div.style.padding = '8px';
          div.style.border = '1px solid rgba(6,182,212,0.3)';
          div.style.backgroundColor = 'rgba(6,182,212,0.05)';
          div.style.borderRadius = '4px';
          div.style.display = 'inline-block';
          div.style.marginTop = '10px';
        } else div.classList.add('text-muted');
        
        div.innerText = lineData.text;
        termBody.appendChild(div);
        lineIdx++;
        setTimeout(addNextLine, 250);
      }
      
      // Auto scroll terminal
      termBody.scrollTop = termBody.scrollHeight;
    }
    
    addNextLine();
  }
  
  scanBtn.addEventListener('click', () => runSimulation(scanLines));
  serveBtn.addEventListener('click', () => runSimulation(serveLines));
  
  // Run serve simulation by default
  runSimulation(serveLines);
}

// 4. Interactive Sandbox Graph
function initInteractiveGraph() {
  const canvas = document.getElementById('mini-graph-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  // Set dimensions
  function resizeCanvas() {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  // Node list representing the CodeMap codebase
  const nodes = [
    { id: 'cli', label: 'src/cli.ts', x: 200, y: 150, radius: 10, type: 'ts', loc: 180, importsCount: 4, dependentsCount: 0, blastRadius: 5, exports: ['runCli', 'parseArgs'], imports: ['src/scanner/walk.ts', 'src/graph/builder.ts', 'src/governance/rules.ts', 'node:path'] },
    { id: 'walk', label: 'src/scanner/walk.ts', x: 350, y: 100, radius: 9, type: 'ts', loc: 220, importsCount: 2, dependentsCount: 3, blastRadius: 25, exports: ['walkDir', 'isIgnored'], imports: ['languages/parser.ts', 'util/paths.ts'] },
    { id: 'parser', label: 'src/languages/parser.ts', x: 500, y: 120, radius: 11, type: 'ts', loc: 150, importsCount: 2, dependentsCount: 5, blastRadius: 35, exports: ['LanguageParser', 'TreeSitterParser'], imports: ['src/languages/ir.ts', 'web-tree-sitter'] },
    { id: 'jsts', label: 'src/languages/jsts.ts', x: 600, y: 80, radius: 8, type: 'ts', loc: 410, importsCount: 4, dependentsCount: 1, blastRadius: 15, exports: ['JsTsParser'], imports: ['src/languages/parser.ts', 'tree-sitter-wasms'] },
    { id: 'python', label: 'src/languages/python.py', x: 630, y: 160, radius: 8, type: 'python', loc: 280, importsCount: 3, dependentsCount: 1, blastRadius: 12, exports: ['PythonParser'], imports: ['src/languages/parser.ts', 'tree-sitter-wasms'] },
    { id: 'builder', label: 'src/graph/builder.ts', x: 300, y: 250, radius: 11, type: 'ts', loc: 320, importsCount: 3, dependentsCount: 4, blastRadius: 45, exports: ['GraphBuilder', 'buildGraph'], imports: ['src/languages/parser.ts', 'src/graph/store.ts'] },
    { id: 'hotspots', label: 'src/analysis/hotspots.ts', x: 180, y: 350, radius: 8, type: 'ts', loc: 240, importsCount: 3, dependentsCount: 2, blastRadius: 30, exports: ['calculatePageRank', 'getHotspots'], imports: ['src/graph/store.ts'] },
    { id: 'rules', label: 'src/governance/rules.ts', x: 450, y: 340, radius: 10, type: 'ts', loc: 280, importsCount: 5, dependentsCount: 3, blastRadius: 55, exports: ['evaluateRules', 'RuleViolation'], imports: ['src/graph/store.ts'] },
    { id: 'database', label: 'src/graph/sqliteStore.ts', x: 320, y: 450, radius: 13, type: 'db', loc: 390, importsCount: 2, dependentsCount: 8, blastRadius: 95, exports: ['SqliteGraphStore'], imports: ['node:sqlite'] },
    { id: 'ui', label: 'ui/src/main.ts', x: 100, y: 280, radius: 9, type: 'ts', loc: 110, importsCount: 6, dependentsCount: 1, blastRadius: 10, exports: ['initUi', 'renderGraph'], imports: ['src/graph/sqliteStore.ts'] },
    { id: 'mcp', label: 'src/mcp/server.ts', x: 550, y: 420, radius: 10, type: 'ts', loc: 340, importsCount: 7, dependentsCount: 1, blastRadius: 20, exports: ['McpServer', 'registerTools'], imports: ['src/graph/sqliteStore.ts', 'src/analysis/hotspots.ts'] }
  ];
  
  // Link edges
  const links = [
    { source: 'cli', target: 'walk' },
    { source: 'cli', target: 'builder' },
    { source: 'cli', target: 'rules' },
    { source: 'walk', target: 'parser' },
    { source: 'jsts', target: 'parser' },
    { source: 'python', target: 'parser' },
    { source: 'builder', target: 'parser' },
    { source: 'builder', target: 'database' },
    { source: 'hotspots', target: 'database' },
    { source: 'rules', target: 'database' },
    { source: 'ui', target: 'database' },
    { source: 'mcp', target: 'database' },
    { source: 'mcp', target: 'hotspots' }
  ];
  
  // Normalize layout coordinates initially relative to dimensions
  nodes.forEach(n => {
    n.x = (n.x / 750) * canvas.width * 0.8 + canvas.width * 0.1;
    n.y = (n.y / 550) * canvas.height * 0.8 + canvas.height * 0.1;
    n.vx = 0;
    n.vy = 0;
  });
  
  // Simulation State
  let selectedNode = nodes[0];
  let hoveredNode = null;
  let draggedNode = null;
  let showLabels = true;
  let showBlastRadius = false;
  
  // Settings buttons
  const resetBtn = document.getElementById('btn-reset-zoom');
  const labelsBtn = document.getElementById('btn-toggle-labels');
  const blastBtn = document.getElementById('btn-blast-radius');
  
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // Re-center nodes
      nodes.forEach((n, idx) => {
        // Simple default positioning grid
        const angle = (idx / nodes.length) * Math.PI * 2;
        n.x = canvas.width / 2 + Math.cos(angle) * (canvas.width * 0.25);
        n.y = canvas.height / 2 + Math.sin(angle) * (canvas.height * 0.25);
        n.vx = 0;
        n.vy = 0;
      });
    });
  }
  
  if (labelsBtn) {
    labelsBtn.addEventListener('click', () => {
      showLabels = !showLabels;
      labelsBtn.innerText = showLabels ? 'Labels On' : 'Labels Off';
    });
  }
  
  if (blastBtn) {
    blastBtn.addEventListener('click', () => {
      showBlastRadius = !showBlastRadius;
      blastBtn.classList.toggle('active');
      blastBtn.innerText = showBlastRadius ? 'Hide Impact' : 'Show Impact';
    });
  }
  
  // Inspector sidebar elements
  const inspectIcon = document.getElementById('inspect-icon');
  const inspectFilename = document.getElementById('inspect-filename');
  const inspectPath = document.getElementById('inspect-path');
  const inspectLoc = document.getElementById('inspect-loc');
  const inspectImports = document.getElementById('inspect-imports');
  const inspectDependents = document.getElementById('inspect-dependents');
  const inspectImpact = document.getElementById('inspect-impact');
  const inspectImportsList = document.getElementById('inspect-imports-list');
  const inspectExportsList = document.getElementById('inspect-exports-list');
  
  function updateInspector(node) {
    if (!node) return;
    
    inspectIcon.innerText = node.type.toUpperCase();
    inspectIcon.className = `badge-lang ${node.type}`;
    
    inspectFilename.innerText = node.label.split('/').pop();
    inspectPath.innerText = node.label;
    inspectLoc.innerText = node.loc > 0 ? `${node.loc} lines` : 'N/A';
    inspectImports.innerText = node.importsCount;
    inspectDependents.innerText = node.dependentsCount;
    inspectImpact.innerText = node.blastRadius;
    
    // Setup imports
    inspectImportsList.innerHTML = '';
    node.imports.forEach(imp => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="list-dot bg-blue"></span> ${imp}`;
      inspectImportsList.appendChild(li);
    });
    
    // Setup exports
    inspectExportsList.innerHTML = '';
    node.exports.forEach(exp => {
      const li = document.createElement('li');
      li.innerHTML = `🛡 Export: <span class="text-white">${exp}</span>`;
      inspectExportsList.appendChild(li);
    });
  }
  
  // Set default inspector to CLI node
  updateInspector(selectedNode);
  
  // Physics engine parameters
  const kRepulsion = 1500;
  const kSpring = 0.05;
  const restLength = 90;
  const gravity = 0.025;
  const friction = 0.82;
  
  function updatePhysics() {
    // 1. Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Repulsion force
        const force = kRepulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        
        if (nodes[i] !== draggedNode) {
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
        }
        if (nodes[j] !== draggedNode) {
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }
    }
    
    // 2. Attraction along links (springs)
    links.forEach(link => {
      const sourceNode = nodes.find(n => n.id === link.source);
      const targetNode = nodes.find(n => n.id === link.target);
      
      if (!sourceNode || !targetNode) return;
      
      const dx = targetNode.x - sourceNode.x;
      const dy = targetNode.y - sourceNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      
      const stretch = dist - restLength;
      const force = stretch * kSpring;
      
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      
      if (sourceNode !== draggedNode) {
        sourceNode.vx += fx;
        sourceNode.vy += fy;
      }
      if (targetNode !== draggedNode) {
        targetNode.vx -= fx;
        targetNode.vy -= fy;
      }
    });
    
    // 3. Gravity/Center pulling & friction
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    nodes.forEach(n => {
      if (n === draggedNode) return;
      
      // Pull to center
      n.vx += (cx - n.x) * gravity;
      n.vy += (cy - n.y) * gravity;
      
      // Apply forces to velocity and position
      n.x += n.vx;
      n.y += n.vy;
      
      // Apply friction
      n.vx *= friction;
      n.vy *= friction;
      
      // Boundaries
      n.x = Math.max(n.radius + 10, Math.min(canvas.width - n.radius - 10, n.x));
      n.y = Math.max(n.radius + 10, Math.min(canvas.height - n.radius - 10, n.y));
    });
  }
  
  // Blast radius calculation: Breadth-First Search (BFS) starting from target node
  // In blast radius view, we trace dependents (backwards traversal)
  // For simplicity, we calculate which nodes depend on the selected/hovered node
  function getBlastDistances(rootNode) {
    const distances = {};
    if (!rootNode) return distances;
    
    distances[rootNode.id] = 0;
    const queue = [rootNode.id];
    
    while (queue.length > 0) {
      const curr = queue.shift();
      const currDist = distances[curr];
      
      // Find all nodes that depend on 'curr' (source is dependent, target is dependency)
      // i.e., links where target === curr, source is the dependent
      links.forEach(link => {
        if (link.target === curr) {
          const dependentId = link.source;
          if (distances[dependentId] === undefined) {
            distances[dependentId] = currDist + 1;
            queue.push(dependentId);
          }
        }
      });
    }
    
    return distances;
  }
  
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Determine blast distances if highlight is active
    let blastDistances = {};
    if (showBlastRadius && selectedNode) {
      blastDistances = getBlastDistances(selectedNode);
    }
    
    // Draw links (edges)
    links.forEach(link => {
      const sourceNode = nodes.find(n => n.id === link.source);
      const targetNode = nodes.find(n => n.id === link.target);
      
      if (!sourceNode || !targetNode) return;
      
      ctx.beginPath();
      ctx.moveTo(sourceNode.x, sourceNode.y);
      ctx.lineTo(targetNode.x, targetNode.y);
      
      // Visual highlighting
      let isHighlighted = false;
      let strokeColor = 'rgba(255, 255, 255, 0.08)';
      let lineWidth = 1;
      
      if (hoveredNode) {
        if (hoveredNode.id === sourceNode.id || hoveredNode.id === targetNode.id) {
          isHighlighted = true;
          strokeColor = hoveredNode.id === sourceNode.id ? 'rgba(99, 102, 241, 0.6)' : 'rgba(6, 182, 212, 0.6)';
          lineWidth = 2;
        }
      } else if (selectedNode) {
        if (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id) {
          isHighlighted = true;
          strokeColor = selectedNode.id === sourceNode.id ? 'rgba(99, 102, 241, 0.3)' : 'rgba(6, 182, 212, 0.3)';
          lineWidth = 1.5;
        }
      }
      
      if (showBlastRadius && blastDistances[targetNode.id] !== undefined && blastDistances[sourceNode.id] !== undefined) {
        strokeColor = 'rgba(239, 68, 68, 0.4)';
        lineWidth = 2;
      }
      
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    });
    
    // Draw nodes
    nodes.forEach(node => {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
      
      // Node coloring & highlighting
      let fillStyle = '#0a0f1d';
      let strokeStyle = '#475569';
      let lineWidth = 2;
      let alpha = 1;
      
      // Apply base colors depending on language/type
      if (node.type === 'python') {
        strokeStyle = '#eab308'; // Yellow
      } else if (node.type === 'db') {
        strokeStyle = '#10b981'; // Success Emerald
      } else {
        strokeStyle = '#3b82f6'; // TS/JS Blue
      }
      
      // Highlights & Selection
      const isSelected = selectedNode && selectedNode.id === node.id;
      const isHovered = hoveredNode && hoveredNode.id === node.id;
      const isRelated = hoveredNode && (links.some(l => (l.source === hoveredNode.id && l.target === node.id) || (l.target === hoveredNode.id && l.source === node.id)));
      
      if (hoveredNode) {
        if (isHovered) {
          fillStyle = 'rgba(99, 102, 241, 0.15)';
          lineWidth = 3;
        } else if (isRelated) {
          lineWidth = 2;
        } else {
          alpha = 0.3; // Dim unrelated
        }
      } else if (isSelected) {
        fillStyle = 'rgba(99, 102, 241, 0.1)';
        lineWidth = 3.5;
        strokeStyle = '#6366f1'; // Primary Glow
      }
      
      // Blast Radius overlay colors
      if (showBlastRadius && selectedNode) {
        const distance = blastDistances[node.id];
        if (distance !== undefined) {
          alpha = 1;
          if (distance === 0) {
            strokeStyle = '#ef4444'; // Red for source
            fillStyle = 'rgba(239, 68, 68, 0.1)';
          } else if (distance === 1) {
            strokeStyle = '#f97316'; // Orange for direct dependents
          } else {
            strokeStyle = '#eab308'; // Yellow for transitive
          }
        } else if (hoveredNode === null) {
          alpha = 0.25; // Dim unaffected nodes
        }
      }
      
      ctx.fillStyle = fillStyle;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = alpha;
      
      // Outer glow for selected
      if (isSelected && !showBlastRadius) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#6366f1';
      }
      
      ctx.fill();
      ctx.stroke();
      
      // Reset shadows
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      
      // Draw inner node dot
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius - 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeStyle;
      ctx.fill();
      
      // Draw labels
      if (showLabels) {
        ctx.font = isSelected ? 'bold 11px var(--font-sans)' : '11px var(--font-sans)';
        ctx.fillStyle = isSelected ? '#ffffff' : 'var(--text-secondary)';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y - node.radius - 8);
      }
      
      ctx.globalAlpha = 1.0;
    });
  }
  
  // Click/Hover Detection Helper
  function getNodeAtPosition(x, y) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const dx = x - node.x;
      const dy = y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < node.radius + 15) { // Click tolerance buffer
        return node;
      }
    }
    return null;
  }
  
  // Mouse Events
  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const clickedNode = getNodeAtPosition(x, y);
    if (clickedNode) {
      draggedNode = clickedNode;
      selectedNode = clickedNode;
      updateInspector(clickedNode);
    }
  });
  
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (draggedNode) {
      draggedNode.x = x;
      draggedNode.y = y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
    } else {
      const prevHovered = hoveredNode;
      hoveredNode = getNodeAtPosition(x, y);
      if (prevHovered !== hoveredNode) {
        canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
      }
    }
  });
  
  canvas.addEventListener('mouseup', () => {
    draggedNode = null;
  });
  
  canvas.addEventListener('mouseleave', () => {
    draggedNode = null;
    hoveredNode = null;
  });
  
  // Touch Events for Mobile
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;
      
      const clickedNode = getNodeAtPosition(x, y);
      if (clickedNode) {
        draggedNode = clickedNode;
        selectedNode = clickedNode;
        updateInspector(clickedNode);
        e.preventDefault();
      }
    }
  }, { passive: false });
  
  canvas.addEventListener('touchmove', e => {
    if (draggedNode && e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;
      
      draggedNode.x = x;
      draggedNode.y = y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      e.preventDefault();
    }
  }, { passive: false });
  
  canvas.addEventListener('touchend', () => {
    draggedNode = null;
  });
  
  // Animation Loop
  function tick() {
    updatePhysics();
    draw();
    requestAnimationFrame(tick);
  }
  tick();
}

// 5. Governance Dashboard Interactive Widget
function initGovernanceWidget() {
  const fixBtnContainer = document.querySelector('.governance-violations-panel');
  if (!fixBtnContainer) return;
  
  // Create and append a gorgeous "Resolve Violation" action button to make it interactive!
  const fixBtn = document.createElement('button');
  fixBtn.className = 'btn btn-secondary';
  fixBtn.style.width = '100%';
  fixBtn.style.marginTop = '12px';
  fixBtn.style.fontSize = '0.8rem';
  fixBtn.style.padding = '8px 12px';
  fixBtn.style.borderColor = 'rgba(16,185,129,0.3)';
  fixBtn.style.color = 'var(--success)';
  fixBtn.innerText = '⚡ Resolve Violation (Refactor Connection)';
  
  fixBtnContainer.appendChild(fixBtn);
  
  const scoreNum = document.getElementById('gov-score-num');
  const scoreGrade = document.getElementById('gov-score-grade');
  const ringFg = document.getElementById('gov-ring-fg');
  const statusBadge = document.querySelector('.gov-badge-green');
  const sliders = document.querySelectorAll('.slider-fill');
  const slidersVal = document.querySelectorAll('.slider-val');
  
  let isFixed = false;
  
  fixBtn.addEventListener('click', () => {
    if (isFixed) {
      // Revert to original violation state
      isFixed = false;
      fixBtn.innerText = '⚡ Resolve Violation (Refactor Connection)';
      fixBtn.style.color = 'var(--success)';
      fixBtn.style.borderColor = 'rgba(16,185,129,0.3)';
      
      // Update violation item UI
      const vItem = document.querySelector('.violation-item');
      if (vItem) vItem.style.display = 'flex';
      
      const vHeader = document.querySelector('.panel-heading');
      if (vHeader) vHeader.innerText = 'Active Violations (1)';
      
      // Score dial animation back to 88 (A-)
      animateScore(96, 88, 'A-', 37.7); // offset 37.7
      
      statusBadge.innerText = 'Pass';
      statusBadge.className = 'gov-badge-green';
      
      // Reset sliders
      updateSlider(1, 82); // Stability back to 82%
      updateSlider(3, 65); // Coupling back to 65%
      
    } else {
      // Transition to resolved/perfect state
      isFixed = true;
      fixBtn.innerText = '🔄 Revert Connection (Introduce Violation)';
      fixBtn.style.color = 'var(--warning)';
      fixBtn.style.borderColor = 'rgba(245,158,11,0.3)';
      
      // Hide violation item
      const vItem = document.querySelector('.violation-item');
      if (vItem) vItem.style.display = 'none';
      
      const vHeader = document.querySelector('.panel-heading');
      if (vHeader) vHeader.innerText = 'Active Violations (0)';
      
      // Score dial animation to 96 (A)
      // 96% offset: 314.16 - (314.16 * 0.96) = 12.56
      animateScore(88, 96, 'A', 12.56);
      
      statusBadge.innerText = 'Perfect';
      statusBadge.className = 'gov-badge-green';
      statusBadge.style.backgroundColor = 'rgba(6, 182, 212, 0.1)';
      statusBadge.style.color = 'var(--accent-cyan)';
      statusBadge.style.borderColor = 'rgba(6, 182, 212, 0.2)';
      
      // Boost sliders
      updateSlider(1, 94); // Stability increases to 94%
      updateSlider(3, 85); // Coupling improves to 85%
    }
  });
  
  function updateSlider(idx, targetVal) {
    if (!sliders[idx]) return;
    sliders[idx].style.width = `${targetVal}%`;
    slidersVal[idx].innerText = targetVal;
  }
  
  function animateScore(start, end, grade, targetOffset) {
    let current = start;
    const step = start < end ? 1 : -1;
    
    const interval = setInterval(() => {
      if (current === end) {
        clearInterval(interval);
      } else {
        current += step;
        scoreNum.innerText = current;
      }
    }, 30);
    
    scoreGrade.innerText = grade;
    ringFg.style.strokeDashoffset = targetOffset;
  }
}
