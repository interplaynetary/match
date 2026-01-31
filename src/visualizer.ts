import { Matcher } from './matcher'
import { convertExamples, type EmbeddingsStore } from './example-converter'
import { computePCATransform, type PCATransform } from './semantic-colors'
import examples from '../data/enriched-examples.json'
import embeddingsData from '../data/embeddings.json'

const embeddings = embeddingsData as EmbeddingsStore

type MatchData = {
  capacities: Array<{ id: string; expressions: string[]; label: string; embedding?: number[] }>
  needs: Array<{ id: string; expressions: string[]; label: string; embedding?: number[] }>
  pcaTransform: PCATransform
  matches: Array<{
    needId: string
    capacityId: string
    score: number
    breakdown: {
      time?: number
      space?: number
      quantity?: number
      similarity?: number
      priorityWeight?: number
      categoryMatch?: {
        overlapCategory: string
        overlapDistance: number
        isBlocked: boolean
      }
    }
    matchedExpressions?: {
      needText: string
      capacityText: string
      needChain?: string[]
      capacityChain?: string[]
    }
  }>
}

export function generateMatchData(): MatchData {
  // Use low threshold to get all potential matches; UI slider filters client-side
  const matcher = new Matcher({ similarityThreshold: 0.5 })
  const { capacities, needs, byId } = convertExamples(examples as any, embeddings)

  // Collect all embeddings for PCA transform computation
  const allEmbeddings: number[][] = []

  const capacityData = capacities.map((c) => {
    const original = byId.get(c.id)?.original
    if (c.embedding) allEmbeddings.push(c.embedding)
    return {
      id: c.id,
      expressions: c.expressions.map(e => e.text),
      label: original?.naturalLanguage?.slice(0, 50) ?? c.expressions[0]?.text ?? 'capacity',
      embedding: c.embedding,
    }
  })

  const needData = needs.map((n) => {
    const original = byId.get(n.id)?.original
    if (n.embedding) allEmbeddings.push(n.embedding)
    return {
      id: n.id,
      expressions: n.expressions.map(e => e.text),
      label: original?.naturalLanguage?.slice(0, 50) ?? n.expressions[0]?.text ?? 'need',
      embedding: n.embedding,
    }
  })

  // Compute PCA transform from all embeddings
  const pcaTransform = computePCATransform(allEmbeddings)

  const matchData: MatchData['matches'] = []
  for (const need of needs) {
    const results = matcher.findMatches(need, capacities)
    for (const result of results) {
      matchData.push({
        needId: result.needId,
        capacityId: result.capacityId,
        score: result.feasibilityScore,
        breakdown: result.breakdown,
        matchedExpressions: {
          needText: result.matchedExpressions.need.text,
          capacityText: result.matchedExpressions.capacity.text,
          needChain: result.matchedExpressions.need.categoryChain,
          capacityChain: result.matchedExpressions.capacity.categoryChain,
        },
      })
    }
  }

  return {
    capacities: capacityData,
    needs: needData,
    matches: matchData,
    pcaTransform,
  }
}

export function generateHTML(data: MatchData): string {

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Match Visualization</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    .container {
      display: flex;
      height: 100vh;
    }
    .viz {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    svg {
      max-width: 100%;
      max-height: 100%;
    }
    .sidebar {
      width: 350px;
      background: #16213e;
      padding: 20px;
      overflow-y: auto;
      border-left: 1px solid #333;
    }
    h1 { font-size: 1.4em; margin-bottom: 10px; }
    h2 { font-size: 1.1em; margin: 20px 0 10px; color: #888; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
    .stat {
      background: #0f3460;
      padding: 8px;
      border-radius: 6px;
      text-align: center;
    }
    .stat-value { font-size: 1.2em; font-weight: bold; }
    .stat-label { font-size: 0.65em; color: #888; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.7em;
      background: #0f3460;
      padding: 3px 6px;
      border-radius: 3px;
    }
    .legend-color { width: 10px; height: 10px; border-radius: 2px; }
    .node { cursor: pointer; transition: opacity 0.2s; }
    .node:hover { opacity: 0.8; }
    .node text { font-size: 8px; fill: #aaa; }
    .chord { fill-opacity: 0.4; transition: fill-opacity 0.2s; }
    .chord:hover { fill-opacity: 0.8; }
    .details { background: #0f3460; padding: 15px; border-radius: 8px; font-size: 0.85em; }
    .details p { margin: 5px 0; }
    .details .label { color: #888; }
    .match-level {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .match-level-badge {
      padding: 3px 8px;
      border-radius: 10px;
      font-size: 0.8em;
      font-weight: bold;
      white-space: nowrap;
    }
    .match-level-exact { background: #4CAF50; color: white; }
    .match-level-related { background: #2196F3; color: white; }
    .match-level-embedding { background: #9C27B0; color: white; }
    .match-connection {
      background: rgba(0,0,0,0.3);
      padding: 10px;
      border-radius: 6px;
      margin: 8px 0;
      font-size: 0.85em;
    }
    .match-connection-expr {
      padding: 6px 8px;
      background: rgba(255,255,255,0.05);
      border-radius: 4px;
      margin: 4px 0;
    }
    .match-connection-link {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: #4CAF50;
      font-size: 0.9em;
      padding: 4px 0;
    }
    .match-connection-link .link-word {
      background: #4CAF50;
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: bold;
    }
    .category-chain {
      font-family: monospace;
      font-size: 0.75em;
      background: rgba(0,0,0,0.3);
      padding: 8px;
      border-radius: 4px;
      margin: 8px 0;
      overflow-x: auto;
      line-height: 1.6;
    }
    .category-chain .overlap { background: #4CAF50; padding: 1px 4px; border-radius: 2px; color: white; }
    .criteria-grid { margin-top: 10px; }
    .criterion {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8em;
      margin-bottom: 4px;
    }
    .criterion-label { width: 55px; color: #888; }
    .criterion-bar {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .criterion-fill { height: 100%; border-radius: 3px; }
    .criterion-value { width: 32px; text-align: right; font-size: 0.9em; }
    .back-button {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #0f3460;
      border: none;
      color: #4CAF50;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85em;
      margin-bottom: 15px;
      transition: background 0.2s;
    }
    .back-button:hover { background: #1a4a7a; }
    .node-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
    }
    .node-header-icon {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .node-header-icon.capacity { border-radius: 50%; }
    .node-title { font-size: 1.1em; font-weight: bold; }
    .node-subtitle { font-size: 0.8em; color: #888; margin-top: 2px; }
    .match-list { margin-top: 15px; }
    .match-item {
      background: rgba(0,0,0,0.2);
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .match-item:hover { background: rgba(0,0,0,0.4); }
    .match-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .match-item-score { color: #4CAF50; font-weight: bold; }
    .match-item-label { font-size: 0.85em; color: #ccc; }
    .match-item-badge { font-size: 0.7em; padding: 2px 6px; border-radius: 8px; }
    .sidebar-view { display: none; }
    .sidebar-view.active { display: block; }
    .slider-container { background: #0f3460; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .slider-container label { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .slider-container input[type="range"] { width: 100%; cursor: pointer; }
    .slider-value { font-weight: bold; color: #4CAF50; }
    #tooltip {
      position: fixed;
      background: #0f3460;
      border: 1px solid #444;
      padding: 10px;
      border-radius: 6px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      max-width: 400px;
      z-index: 1000;
    }
  </style>
</head>
<body>
  <div id="tooltip"></div>
  <div class="container">
    <div class="viz">
      <svg id="chart" viewBox="-400 -400 800 800"></svg>
    </div>
    <div class="sidebar">
      <div id="general-view" class="sidebar-view active">
        <h1>Match Visualization</h1>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${data.capacities.length}</div>
            <div class="stat-label">Capacities</div>
          </div>
          <div class="stat">
            <div class="stat-value">${data.needs.length}</div>
            <div class="stat-label">Needs</div>
          </div>
          <div class="stat">
            <div class="stat-value">${data.matches.length}</div>
            <div class="stat-label">Matches</div>
          </div>
          <div class="stat">
            <div class="stat-value">${((data.matches.length / Math.max(data.needs.length, 1)) * 100).toFixed(0)}%</div>
            <div class="stat-label">Match Rate</div>
          </div>
        </div>

        <h2>Threshold</h2>
        <div class="slider-container">
          <label>
            <span>Similarity threshold</span>
            <span class="slider-value" id="threshold-value">75%</span>
          </label>
          <input type="range" id="threshold-slider" min="0" max="100" value="75" step="1">
          <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #666; margin-top: 4px;">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        <h2>Legend</h2>
        <div class="legend">
          <div class="legend-item">
            <div class="legend-color" style="background: #4CAF50; border-radius: 50%;"></div>
            <span>Capacity (outer ring)</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background: #2196F3; border-radius: 0;"></div>
            <span>Need (inner ring)</span>
          </div>
        </div>
        <p style="font-size: 0.75em; color: #666; margin-top: 8px;">
          Node colors derived from semantic embeddings
        </p>

        <h2>Hover for Details</h2>
        <div class="details" id="details">
          <p>Hover over nodes or chords to see details</p>
        </div>
      </div>

      <div id="node-view" class="sidebar-view">
        <button class="back-button" id="back-button">
          <span>←</span> Back to Overview
        </button>
        <div id="node-details"></div>
      </div>
    </div>
  </div>

  <script>
    const data = ${JSON.stringify(data)};

    // Fallback colors when embeddings are missing
    const defaultCapacityColor = '#4CAF50';
    const defaultNeedColor = '#2196F3';

    // Semantic color functions (PCA → polar → HSL)
    function dotProduct(a, b) {
      let sum = 0;
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) sum += a[i] * b[i];
      return sum;
    }

    function pcaProject(embedding, transform) {
      const x = dotProduct(transform[0], embedding);
      const y = dotProduct(transform[1], embedding);
      return [x, y];
    }

    function coordinatesToHSL(x, y) {
      const angle = Math.atan2(y, x);
      const hue = ((angle / Math.PI + 1) * 180) % 360;
      const radius = Math.sqrt(x * x + y * y);
      const saturation = (50 + Math.min(50, radius * 200)) * 0.5;
      const lightness = 45;
      return \`hsl(\${hue.toFixed(0)}, \${saturation.toFixed(0)}%, \${lightness}%)\`;
    }

    function embeddingToColor(embedding) {
      if (!embedding || !data.pcaTransform) return null;
      const [x, y] = pcaProject(embedding, data.pcaTransform);
      return coordinatesToHSL(x, y);
    }

    // Get color for a node (capacity or need)
    function getNodeColor(item, isCapacity) {
      const color = embeddingToColor(item.embedding);
      return color || (isCapacity ? defaultCapacityColor : defaultNeedColor);
    }

    const svg = document.getElementById('chart');
    const tooltip = document.getElementById('tooltip');
    const details = document.getElementById('details');
    const generalView = document.getElementById('general-view');
    const nodeView = document.getElementById('node-view');
    const nodeDetails = document.getElementById('node-details');
    const backButton = document.getElementById('back-button');

    // State for locked node view
    let lockedNodeId = null;
    let currentThreshold = 0.75;

    // Show general view
    function showGeneralView() {
      lockedNodeId = null;
      generalView.classList.add('active');
      nodeView.classList.remove('active');
      // Reset chord highlighting
      document.querySelectorAll('.chord').forEach(c => c.style.opacity = '');
      document.querySelectorAll('.node').forEach(n => n.style.opacity = '');
    }

    // Show node detail view
    function showNodeView(nodeId, isCapacity, isLocked = false) {
      if (isLocked) lockedNodeId = nodeId;

      const item = isCapacity
        ? data.capacities.find(c => c.id === nodeId)
        : data.needs.find(n => n.id === nodeId);
      if (!item) return;

      // Get matches for this node
      let matches;
      if (isCapacity) {
        matches = data.matches
          .filter(m => m.capacityId === nodeId && (m.breakdown.similarity ?? 1) >= currentThreshold)
          .map(m => ({
            ...m,
            other: data.needs.find(n => n.id === m.needId),
            otherType: 'Need'
          }));
      } else {
        matches = data.matches
          .filter(m => m.needId === nodeId && (m.breakdown.similarity ?? 1) >= currentThreshold)
          .map(m => ({
            ...m,
            other: data.capacities.find(c => c.id === m.capacityId),
            otherType: 'Capacity'
          }));
      }
      matches.sort((a, b) => b.score - a.score);

      // Only dim when locked (not on hover preview)
      if (isLocked) {
        // Highlight connected chords
        document.querySelectorAll('.chord').forEach(chord => {
          const capId = chord.getAttribute('data-cap');
          const needId = chord.getAttribute('data-need');
          const isConnected = isCapacity ? capId === nodeId : needId === nodeId;
          chord.style.opacity = isConnected ? '1' : '0.1';
        });

        // Highlight connected nodes
        const connectedIds = new Set(matches.map(m => isCapacity ? m.needId : m.capacityId));
        connectedIds.add(nodeId);
        document.querySelectorAll('.node').forEach(node => {
          const id = node.getAttribute('data-id');
          node.style.opacity = connectedIds.has(id) ? '1' : '0.3';
        });
      }

      const color = getNodeColor(item, isCapacity);
      const iconClass = isCapacity ? 'capacity' : '';

      // Get match description showing what matched
      const getMatchDesc = (m) => {
        const cat = m.breakdown?.categoryMatch;
        const exprs = m.matchedExpressions || {};
        if (cat && !cat.isBlocked && cat.overlapCategory) {
          if (cat.overlapDistance === 0) {
            return '<span class="match-item-badge match-level-exact">Both: ' + cat.overlapCategory + '</span>';
          }
          return '<span class="match-item-badge match-level-related">Via: ' + cat.overlapCategory + '</span>';
        }
        return '<span class="match-item-badge match-level-embedding">Similar meaning</span>';
      };

      nodeDetails.innerHTML = \`
        <div class="node-header">
          <div class="node-header-icon \${iconClass}" style="background: \${color};"></div>
          <div>
            <div class="node-title">\${isCapacity ? 'Capacity' : 'Need'} #\${item.id}</div>
          </div>
        </div>
        <p style="font-size: 0.9em; color: #ccc; margin-bottom: 15px;">\${item.label}</p>
        <div style="font-size: 0.85em; color: #888;">
          Expressions: \${item.expressions?.join(', ')}
        </div>
        <h2 style="margin-top: 20px;">Top Matches (\${matches.length})</h2>
        <div class="match-list">
          \${matches.length === 0 ? '<p style="color: #888;">No matches above threshold</p>' : ''}
          \${matches.slice(0, 20).map(m => \`
            <div class="match-item" data-match-cap="\${m.capacityId}" data-match-need="\${m.needId}">
              <div class="match-item-header">
                <span>\${m.otherType} #\${m.other?.id}</span>
                <span class="match-item-score">\${(m.score * 100).toFixed(0)}%</span>
              </div>
              <div class="match-item-label">\${m.other?.label || ''}</div>
              <div style="margin-top: 6px;">\${getMatchDesc(m)}</div>
            </div>
          \`).join('')}
          \${matches.length > 20 ? \`<p style="color: #888; text-align: center;">... and \${matches.length - 20} more</p>\` : ''}
        </div>
      \`;

      // Add click handlers to match items
      nodeDetails.querySelectorAll('.match-item').forEach(item => {
        item.addEventListener('click', () => {
          const capId = item.getAttribute('data-match-cap');
          const needId = item.getAttribute('data-match-need');
          const match = data.matches.find(m => m.capacityId === capId && m.needId === needId);
          const cap = data.capacities.find(c => c.id === capId);
          const need = data.needs.find(n => n.id === needId);
          if (match && cap && need) {
            showMatchTooltip({ clientX: window.innerWidth / 2, clientY: 100 }, match, cap, need);
          }
        });
      });

      generalView.classList.remove('active');
      nodeView.classList.add('active');
    }

    // Back button handler
    backButton.addEventListener('click', showGeneralView);

    // Click on SVG background to reset
    svg.addEventListener('click', (e) => {
      if (e.target === svg) showGeneralView();
    });

    const outerRadius = 350;
    const innerRadius = 280;
    const needRadius = 220;

    // Combine all nodes for positioning
    const allNodes = [
      ...data.capacities.map((c, i) => ({ ...c, isCapacity: true, index: i })),
      ...data.needs.map((n, i) => ({ ...n, isCapacity: false, index: i })),
    ];

    const totalNodes = allNodes.length;
    const capacityCount = data.capacities.length;
    const needCount = data.needs.length;

    // Position capacities on outer ring, needs on inner ring
    function getPosition(node, radius) {
      let angle;
      if (node.isCapacity) {
        angle = (node.index / capacityCount) * Math.PI * 2 - Math.PI / 2;
      } else {
        angle = (node.index / needCount) * Math.PI * 2 - Math.PI / 2;
      }
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle: angle
      };
    }

    // Draw capacity nodes (outer ring)
    data.capacities.forEach((cap, i) => {
      const pos = getPosition({ isCapacity: true, index: i }, outerRadius);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'node capacity');
      g.setAttribute('data-id', cap.id);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', 8);
      circle.setAttribute('fill', getNodeColor(cap, true));
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '1');

      g.appendChild(circle);

      g.addEventListener('mouseenter', (e) => {
        showTooltip(e, cap, 'capacity');
        if (!lockedNodeId) showNodeView(cap.id, true, false);
      });
      g.addEventListener('mouseleave', () => {
        hideTooltip();
        if (!lockedNodeId) showGeneralView();
      });
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (lockedNodeId === cap.id) {
          showGeneralView();
        } else {
          showNodeView(cap.id, true, true);
        }
      });

      svg.appendChild(g);
    });

    // Draw need nodes (inner ring)
    data.needs.forEach((need, i) => {
      const pos = getPosition({ isCapacity: false, index: i }, needRadius);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'node need');
      g.setAttribute('data-id', need.id);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.x - 6);
      rect.setAttribute('y', pos.y - 6);
      rect.setAttribute('width', 12);
      rect.setAttribute('height', 12);
      rect.setAttribute('fill', getNodeColor(need, false));
      rect.setAttribute('stroke', '#fff');
      rect.setAttribute('stroke-width', '1');

      g.appendChild(rect);

      g.addEventListener('mouseenter', (e) => {
        showTooltip(e, need, 'need');
        if (!lockedNodeId) showNodeView(need.id, false, false);
      });
      g.addEventListener('mouseleave', () => {
        hideTooltip();
        if (!lockedNodeId) showGeneralView();
      });
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (lockedNodeId === need.id) {
          showGeneralView();
        } else {
          showNodeView(need.id, false, true);
        }
      });

      svg.appendChild(g);
    });

    // Draw match chords
    const chordGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    chordGroup.setAttribute('id', 'chords');
    svg.insertBefore(chordGroup, svg.firstChild);

    data.matches.forEach((match) => {
      const capIndex = data.capacities.findIndex((c) => c.id === match.capacityId);
      const needIndex = data.needs.findIndex((n) => n.id === match.needId);

      if (capIndex === -1 || needIndex === -1) return;

      const capPos = getPosition({ isCapacity: true, index: capIndex }, outerRadius);
      const needPos = getPosition({ isCapacity: false, index: needIndex }, needRadius);

      const cap = data.capacities[capIndex];
      const need = data.needs[needIndex];

      // Compute curved path using SVG arc (Lombardi-style)
      const x1 = capPos.x, y1 = capPos.y;
      const x2 = needPos.x, y2 = needPos.y;
      const dx = x2 - x1, dy = y2 - y1;
      const chordLength = Math.sqrt(dx * dx + dy * dy);

      // Direction: bow outward from center (0,0)
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const perpX = -dy, perpY = dx; // perpendicular to chord
      const dot = midX * perpX + midY * perpY;
      const direction = dot >= 0 ? 1 : -1;

      // Sagitta (arc height) - 15% of chord length
      const curveIntensity = 0.15;
      const sagitta = chordLength * curveIntensity * direction;
      const absSagitta = Math.abs(sagitta);

      let d;
      if (chordLength === 0 || absSagitta < 0.1) {
        d = \`M \${x1},\${y1} L \${x2},\${y2}\`;
      } else {
        // Radius from chord L and sagitta h: r = (L²/4 + h²) / (2h)
        const radius = (chordLength * chordLength / 4 + absSagitta * absSagitta) / (2 * absSagitta);
        const sweepFlag = sagitta < 0 ? 1 : 0;
        d = \`M \${x1},\${y1} A \${radius},\${radius} 0 0,\${sweepFlag} \${x2},\${y2}\`;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      // Use capacity's semantic color for the connection
      path.setAttribute('stroke', getNodeColor(cap, true));
      path.setAttribute('stroke-width', Math.max(5, match.score * 12));
      const similarity = match.breakdown.similarity ?? 1;
      path.setAttribute('opacity', String(similarity * similarity));
      path.setAttribute('class', 'chord');
      path.setAttribute('data-cap', match.capacityId);
      path.setAttribute('data-need', match.needId);

      path.addEventListener('mouseenter', (e) => showMatchTooltip(e, match, cap, need));
      path.addEventListener('mouseleave', hideTooltip);

      chordGroup.appendChild(path);
    });

    // Build connection map for hover labels
    const connections = new Map();
    data.matches.forEach(match => {
      if (!connections.has(match.capacityId)) connections.set(match.capacityId, []);
      if (!connections.has(match.needId)) connections.set(match.needId, []);
      connections.get(match.capacityId).push(match.needId);
      connections.get(match.needId).push(match.capacityId);
    });

    // Container for connected node tooltips
    const tooltipContainer = document.createElement('div');
    tooltipContainer.setAttribute('id', 'connected-tooltips');
    document.body.appendChild(tooltipContainer);

    function showConnectedTooltips(nodeId) {
      tooltipContainer.innerHTML = '';
      const connectedIds = connections.get(nodeId) || [];
      const placedRects = [];

      connectedIds.forEach(id => {
        // Only show tooltip if the connecting chord is visible
        const chord = document.querySelector(\`.chord[data-cap="\${nodeId}"][data-need="\${id}"], .chord[data-cap="\${id}"][data-need="\${nodeId}"]\`);
        if (!chord || chord.style.display === 'none') return;

        const cap = data.capacities.find(c => c.id === id);
        const need = data.needs.find(n => n.id === id);
        const item = cap || need;
        if (!item) return;

        const isCapacity = !!cap;
        const type = isCapacity ? 'capacity' : 'need';

        // Find the node element to position tooltip near it
        const nodeEl = document.querySelector(\`.node[data-id="\${id}"]\`);
        if (!nodeEl) return;

        const rect = nodeEl.getBoundingClientRect();
        const tipEl = document.createElement('div');
        tipEl.style.cssText = \`
          position: fixed;
          background: #0f3460;
          border: 1px solid #444;
          padding: 10px;
          border-radius: 6px;
          font-size: 12px;
          pointer-events: none;
          max-width: 300px;
          z-index: 1000;
        \`;

        const label = item.label || item.expressions?.join(', ');
        const color = getNodeColor(item, isCapacity);
        tipEl.innerHTML = \`
          <strong style="color: \${color}">\${type === 'capacity' ? 'Capacity' : 'Need'} #\${item.id}</strong><br>
          \${label}
        \`;

        tooltipContainer.appendChild(tipEl);

        // Position after adding to DOM to get dimensions
        const tipRect = tipEl.getBoundingClientRect();
        const left = rect.left + rect.width / 2 - tipRect.width / 2;
        const top = rect.top - tipRect.height - 10;

        placedRects.push({
          el: tipEl,
          x: left,
          y: top,
          width: tipRect.width,
          height: tipRect.height
        });
      });

      // Include main tooltip in repulsion (but don't move it)
      const mainTipRect = tooltip.getBoundingClientRect();
      const mainTip = {
        x: mainTipRect.left,
        y: mainTipRect.top,
        width: mainTipRect.width,
        height: mainTipRect.height,
        fixed: true
      };

      // Force simulation to resolve overlaps
      const gap = 10;
      for (let iter = 0; iter < 100; iter++) {
        let hasOverlap = false;

        // Check connected tooltips against main tooltip
        for (const rect of placedRects) {
          const a = rect;
          const b = mainTip;
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (overlapX > -gap && overlapY > -gap) {
            const sepX = overlapX + gap;
            const sepY = overlapY + gap;
            if (sepX > 0 && sepY > 0) {
              hasOverlap = true;
              const aCx = a.x + a.width / 2, bCx = b.x + b.width / 2;
              const aCy = a.y + a.height / 2, bCy = b.y + b.height / 2;
              // Only move the connected tooltip, not the main one
              if (sepX < sepY) {
                const shift = sepX + 1;
                a.x += (aCx <= bCx) ? -shift : shift;
              } else {
                const shift = sepY + 1;
                a.y += (aCy <= bCy) ? -shift : shift;
              }
            }
          }
        }

        // Check connected tooltips against each other
        for (let i = 0; i < placedRects.length; i++) {
          for (let j = i + 1; j < placedRects.length; j++) {
            const a = placedRects[i];
            const b = placedRects[j];
            const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            if (overlapX > -gap && overlapY > -gap) {
              const sepX = overlapX + gap;
              const sepY = overlapY + gap;
              if (sepX > 0 && sepY > 0) {
                hasOverlap = true;
                const aCx = a.x + a.width / 2, bCx = b.x + b.width / 2;
                const aCy = a.y + a.height / 2, bCy = b.y + b.height / 2;
                if (sepX < sepY) {
                  const shift = sepX / 2 + 0.5;
                  if (aCx <= bCx) { a.x -= shift; b.x += shift; }
                  else { a.x += shift; b.x -= shift; }
                } else {
                  const shift = sepY / 2 + 0.5;
                  if (aCy <= bCy) { a.y -= shift; b.y += shift; }
                  else { a.y += shift; b.y -= shift; }
                }
              }
            }
          }
        }
        if (!hasOverlap) break;
      }

      // Apply final positions
      for (const rect of placedRects) {
        rect.el.style.left = rect.x + 'px';
        rect.el.style.top = rect.y + 'px';
      }
    }

    function hideConnectedTooltips() {
      tooltipContainer.innerHTML = '';
    }

    // Add hover handlers to nodes
    document.querySelectorAll('.node').forEach(node => {
      const id = node.getAttribute('data-id');
      node.addEventListener('mouseenter', () => showConnectedTooltips(id));
      node.addEventListener('mouseleave', hideConnectedTooltips);
    });

    function showTooltip(e, item, type) {
      const label = item.label || item.expressions?.join(', ');
      const color = getNodeColor(item, type === 'capacity');
      tooltip.innerHTML = \`
        <strong style="color: \${color}">\${type === 'capacity' ? 'Capacity' : 'Need'} #\${item.id}</strong><br>
        \${label}
      \`;
      tooltip.style.left = e.clientX + 10 + 'px';
      tooltip.style.top = e.clientY + 10 + 'px';
      tooltip.style.opacity = 1;

      details.innerHTML = \`
        <p><span class="label">Type:</span> \${type}</p>
        <p><span class="label">ID:</span> #\${item.id}</p>
        <p><span class="label">Expressions:</span> \${item.expressions?.join(', ')}</p>
        <p style="margin-top: 10px; font-style: italic;">\${item.label}</p>
      \`;
    }

    function showMatchTooltip(e, match, cap, need) {
      const b = match.breakdown || {};
      const catMatch = b.categoryMatch;
      const exprs = match.matchedExpressions || {};

      // Determine match type and connection
      let matchBadge, connectionHtml;
      const needText = exprs.needText || need.expressions?.[0] || 'Need';
      const capText = exprs.capacityText || cap.expressions?.[0] || 'Capacity';

      if (catMatch && !catMatch.isBlocked && catMatch.overlapCategory) {
        if (catMatch.overlapDistance === 0) {
          // Exact match - both refer to the same thing
          matchBadge = '<span class="match-level-badge match-level-exact">Both: ' + catMatch.overlapCategory + '</span>';
          connectionHtml = '<div class="match-connection">' +
            '<div class="match-connection-expr">"' + needText + '"</div>' +
            '<div class="match-connection-link"><span class="link-word">' + catMatch.overlapCategory + '</span></div>' +
            '<div class="match-connection-expr">"' + capText + '"</div>' +
            '</div>';
        } else {
          // Related via common category
          matchBadge = '<span class="match-level-badge match-level-related">Via: ' + catMatch.overlapCategory + '</span>';
          connectionHtml = '<div class="match-connection">' +
            '<div class="match-connection-expr">"' + needText + '"</div>' +
            '<div class="match-connection-link"><span>both relate to</span> <span class="link-word">' + catMatch.overlapCategory + '</span></div>' +
            '<div class="match-connection-expr">"' + capText + '"</div>' +
            '</div>';
        }
      } else {
        // Embedding-only match
        matchBadge = '<span class="match-level-badge match-level-embedding">Similar meaning</span>';
        connectionHtml = '<div class="match-connection">' +
          '<div class="match-connection-expr">"' + needText + '"</div>' +
          '<div class="match-connection-link"><span>similar to</span></div>' +
          '<div class="match-connection-expr">"' + capText + '"</div>' +
          '</div>';
      }

      // Build category chain HTML (for detailed view)
      let chainHtml = '';
      if (exprs.needChain || exprs.capacityChain) {
        const overlapCat = catMatch?.overlapCategory;
        const formatChain = (chain, label) => {
          if (!chain || chain.length === 0) return '';
          const parts = chain.map(c =>
            c === overlapCat
              ? '<span class="overlap">' + c + '</span>'
              : c
          ).join(' > ');
          return '<div><span class="label">' + label + ':</span> ' + parts + '</div>';
        };
        const needChainHtml = formatChain(exprs.needChain, 'Need');
        const capChainHtml = formatChain(exprs.capacityChain, 'Capacity');
        if (needChainHtml || capChainHtml) {
          chainHtml = '<div class="category-chain">' + needChainHtml + capChainHtml + '</div>';
        }
      }

      // Build criteria bars
      const criteria = [
        { key: 'similarity', label: 'Similarity', color: '#4CAF50' },
        { key: 'priorityWeight', label: 'Priority', color: '#2196F3' },
        { key: 'time', label: 'Time', color: '#FF9800' },
        { key: 'space', label: 'Space', color: '#00BCD4' },
        { key: 'quantity', label: 'Quantity', color: '#9C27B0' },
      ];

      const criteriaHtml = criteria
        .filter(c => b[c.key] !== undefined)
        .map(c => {
          const pct = Math.round((b[c.key] || 0) * 100);
          return '<div class="criterion">' +
            '<span class="criterion-label">' + c.label + '</span>' +
            '<div class="criterion-bar"><div class="criterion-fill" style="width: ' + pct + '%; background: ' + c.color + ';"></div></div>' +
            '<span class="criterion-value">' + pct + '%</span>' +
            '</div>';
        }).join('');

      // Tooltip
      tooltip.innerHTML = \`
        <strong>Match</strong> <span style="color: #4CAF50">\${(match.score * 100).toFixed(0)}%</span>
        \${matchBadge}
        \${connectionHtml}
      \`;
      tooltip.style.left = e.clientX + 10 + 'px';
      tooltip.style.top = e.clientY + 10 + 'px';
      tooltip.style.opacity = 1;

      // Sidebar details
      details.innerHTML = \`
        <p style="text-align: center; font-size: 1.2em; margin: 0 0 12px 0;">
          <strong>Score:</strong> <span style="color: #4CAF50">\${(match.score * 100).toFixed(0)}%</span>
        </p>
        \${matchBadge}
        \${connectionHtml}
        \${chainHtml}
        <div class="criteria-grid" style="margin-top: 12px;">
          \${criteriaHtml}
        </div>
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-top: 12px;">
          <p style="margin: 0 0 4px 0;"><strong style="color: \${getNodeColor(cap, true)}">Capacity #\${cap.id}</strong></p>
          <p style="margin: 0; font-size: 0.9em; color: #ccc;">\${cap.label}</p>
        </div>
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-top: 8px;">
          <p style="margin: 0 0 4px 0;"><strong style="color: \${getNodeColor(need, false)}">Need #\${need.id}</strong></p>
          <p style="margin: 0; font-size: 0.9em; color: #ccc;">\${need.label}</p>
        </div>
      \`;
    }

    function hideTooltip() {
      tooltip.style.opacity = 0;
    }

    // Threshold slider
    const slider = document.getElementById('threshold-slider');
    const thresholdValue = document.getElementById('threshold-value');

    function updateThreshold(value) {
      const threshold = value / 100;
      currentThreshold = threshold;
      thresholdValue.textContent = value + '%';

      document.querySelectorAll('.chord').forEach(chord => {
        const capId = chord.getAttribute('data-cap');
        const needId = chord.getAttribute('data-need');
        const match = data.matches.find(m => m.capacityId === capId && m.needId === needId);
        if (match) {
          const similarity = match.breakdown.similarity ?? 1;
          chord.style.display = similarity >= threshold ? '' : 'none';
        }
      });

      // Refresh node view if locked
      if (lockedNodeId) {
        const isCapacity = data.capacities.some(c => c.id === lockedNodeId);
        showNodeView(lockedNodeId, isCapacity, true);
      }
    }

    slider.addEventListener('input', (e) => updateThreshold(e.target.value));
    updateThreshold(75); // Apply initial threshold
  </script>
</body>
</html>`;
}

export async function generateReport(outputPath: string): Promise<void> {
  const data = generateMatchData()
  const html = generateHTML(data)
  await Bun.write(outputPath, html)
  console.log(`Report generated: ${outputPath}`)
}
