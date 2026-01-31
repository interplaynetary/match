import { Matcher } from './matcher'
import { convertExamples, type EmbeddingsStore } from './example-converter'
import examples from '../data/matching-examples.json'
import embeddingsData from '../data/embeddings.json'

const embeddings = embeddingsData as EmbeddingsStore

type MatchData = {
  capacities: Array<{ id: string; expressions: string[]; category: string; label: string }>
  needs: Array<{ id: string; expressions: string[]; category: string; label: string }>
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
    }
  }>
}

export function generateMatchData(): MatchData {
  // Use low threshold to get all potential matches; UI slider filters client-side
  const matcher = new Matcher({ similarityThreshold: 0.5 })
  const { capacities, needs, byId } = convertExamples(examples as any, embeddings)

  const capacityData = capacities.map((c) => {
    const original = byId.get(c.id)?.original
    return {
      id: c.id,
      expressions: c.expressions.map(e => e.text),
      category: original?.category ?? 'unknown',
      label: original?.naturalLanguage?.slice(0, 50) ?? c.expressions[0]?.text ?? 'capacity',
    }
  })

  const needData = needs.map((n) => {
    const original = byId.get(n.id)?.original
    return {
      id: n.id,
      expressions: n.expressions.map(e => e.text),
      category: original?.category ?? 'unknown',
      label: original?.naturalLanguage?.slice(0, 50) ?? n.expressions[0]?.text ?? 'need',
    }
  })

  const matchData: MatchData['matches'] = []
  for (const need of needs) {
    const results = matcher.findMatches(need, capacities)
    for (const result of results) {
      matchData.push({
        needId: result.needId,
        capacityId: result.capacityId,
        score: result.feasibilityScore,
        breakdown: result.breakdown,
      })
    }
  }

  return {
    capacities: capacityData,
    needs: needData,
    matches: matchData,
  }
}

export function generateHTML(data: MatchData): string {
  const categories = [...new Set([
    ...data.capacities.map((c) => c.category),
    ...data.needs.map((n) => n.category),
  ])]

  const categoryColors: Record<string, string> = {
    simple_direct: '#4CAF50',
    asymmetric_type: '#2196F3',
    compositional: '#9C27B0',
    time_constrained: '#FF9800',
    location_constrained: '#00BCD4',
    skill_based: '#E91E63',
    quantity_unit: '#795548',
    edge_case: '#607D8B',
    unknown: '#9E9E9E',
  }

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
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
    .stat {
      background: #0f3460;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value { font-size: 2em; font-weight: bold; }
    .stat-label { font-size: 0.8em; color: #888; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.8em;
      background: #0f3460;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .legend-color { width: 12px; height: 12px; border-radius: 2px; }
    .node { cursor: pointer; transition: opacity 0.2s; }
    .node:hover { opacity: 0.8; }
    .node text { font-size: 8px; fill: #aaa; }
    .chord { fill-opacity: 0.4; transition: fill-opacity 0.2s; }
    .chord:hover { fill-opacity: 0.8; }
    .details { background: #0f3460; padding: 15px; border-radius: 8px; font-size: 0.85em; }
    .details p { margin: 5px 0; }
    .details .label { color: #888; }
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
          <span class="slider-value" id="threshold-value">60%</span>
        </label>
        <input type="range" id="threshold-slider" min="0" max="100" value="60" step="1">
        <div style="display: flex; justify-content: space-between; font-size: 0.7em; color: #666; margin-top: 4px;">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <h2>Categories</h2>
      <div class="legend">
        ${categories.map((cat) => `
          <div class="legend-item">
            <div class="legend-color" style="background: ${categoryColors[cat] ?? '#666'}"></div>
            <span>${cat.replace(/_/g, ' ')}</span>
          </div>
        `).join('')}
      </div>

      <h2>Legend</h2>
      <div class="legend">
        <div class="legend-item">
          <div class="legend-color" style="background: #fff; border-radius: 50%;"></div>
          <span>Capacity (outer ring)</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #fff; border-radius: 0;"></div>
          <span>Need (inner ring)</span>
        </div>
      </div>

      <h2>Hover for Details</h2>
      <div class="details" id="details">
        <p>Hover over nodes or chords to see details</p>
      </div>
    </div>
  </div>

  <script>
    const data = ${JSON.stringify(data)};
    const categoryColors = ${JSON.stringify(categoryColors)};

    const svg = document.getElementById('chart');
    const tooltip = document.getElementById('tooltip');
    const details = document.getElementById('details');

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
      const color = categoryColors[cap.category] || '#666';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'node capacity');
      g.setAttribute('data-id', cap.id);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', 8);
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '1');

      g.appendChild(circle);

      g.addEventListener('mouseenter', (e) => showTooltip(e, cap, 'capacity'));
      g.addEventListener('mouseleave', hideTooltip);

      svg.appendChild(g);
    });

    // Draw need nodes (inner ring)
    data.needs.forEach((need, i) => {
      const pos = getPosition({ isCapacity: false, index: i }, needRadius);
      const color = categoryColors[need.category] || '#666';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'node need');
      g.setAttribute('data-id', need.id);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.x - 6);
      rect.setAttribute('y', pos.y - 6);
      rect.setAttribute('width', 12);
      rect.setAttribute('height', 12);
      rect.setAttribute('fill', color);
      rect.setAttribute('stroke', '#fff');
      rect.setAttribute('stroke-width', '1');

      g.appendChild(rect);

      g.addEventListener('mouseenter', (e) => showTooltip(e, need, 'need'));
      g.addEventListener('mouseleave', hideTooltip);

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
      const color = categoryColors[cap.category] || '#666';

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
      path.setAttribute('stroke', color);
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
        tipEl.innerHTML = \`
          <strong>\${type === 'capacity' ? 'Capacity' : 'Need'} #\${item.id}</strong><br>
          <span style="color: \${categoryColors[item.category]}">\${item.category.replace(/_/g, ' ')}</span><br>
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
      tooltip.innerHTML = \`
        <strong>\${type === 'capacity' ? 'Capacity' : 'Need'} #\${item.id}</strong><br>
        <span style="color: \${categoryColors[item.category]}">\${item.category.replace(/_/g, ' ')}</span><br>
        \${label}
      \`;
      tooltip.style.left = e.clientX + 10 + 'px';
      tooltip.style.top = e.clientY + 10 + 'px';
      tooltip.style.opacity = 1;

      details.innerHTML = \`
        <p><span class="label">Type:</span> \${type}</p>
        <p><span class="label">ID:</span> #\${item.id}</p>
        <p><span class="label">Category:</span> \${item.category.replace(/_/g, ' ')}</p>
        <p><span class="label">Expressions:</span> \${item.expressions?.join(', ')}</p>
        <p style="margin-top: 10px; font-style: italic;">\${item.label}</p>
      \`;
    }

    function showMatchTooltip(e, match, cap, need) {
      const b = match.breakdown || {};
      const breakdownItems = [];
      if (b.similarity !== undefined) breakdownItems.push(\`Similarity: \${(b.similarity * 100).toFixed(0)}%\`);
      if (b.priorityWeight !== undefined) breakdownItems.push(\`Priority: \${(b.priorityWeight * 100).toFixed(0)}%\`);
      if (b.time !== undefined) breakdownItems.push(\`Time: \${(b.time * 100).toFixed(0)}%\`);
      if (b.space !== undefined) breakdownItems.push(\`Space: \${(b.space * 100).toFixed(0)}%\`);
      if (b.quantity !== undefined) breakdownItems.push(\`Quantity: \${(b.quantity * 100).toFixed(0)}%\`);

      tooltip.innerHTML = \`
        <strong>Match</strong> <span style="color: #4CAF50">\${(match.score * 100).toFixed(0)}%</span><br>
        \${breakdownItems.length > 0 ? \`<div style="font-size: 10px; color: #888; margin-top: 4px;">\${breakdownItems.join(' | ')}</div>\` : ''}
        <div style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
          <strong style="color: \${categoryColors[cap.category]}">Capacity #\${cap.id}</strong><br>
          <span style="color: #aaa">\${cap.category.replace(/_/g, ' ')}</span><br>
          \${cap.label}
        </div>
        <div style="text-align: center; margin: 4px 0; color: #4CAF50;">|</div>
        <div style="padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
          <strong style="color: \${categoryColors[need.category]}">Need #\${need.id}</strong><br>
          <span style="color: #aaa">\${need.category.replace(/_/g, ' ')}</span><br>
          \${need.label}
        </div>
      \`;
      tooltip.style.left = e.clientX + 10 + 'px';
      tooltip.style.top = e.clientY + 10 + 'px';
      tooltip.style.opacity = 1;

      details.innerHTML = \`
        <p style="text-align: center; font-size: 1.2em; margin-bottom: 15px;">
          <strong>Match Score:</strong> <span style="color: #4CAF50">\${(match.score * 100).toFixed(0)}%</span>
        </p>
        \${breakdownItems.length > 0 ? \`
        <div style="background: rgba(76,175,80,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">
          <p style="margin: 0 0 8px 0; color: #888; font-size: 0.9em;"><strong>Score Breakdown</strong></p>
          \${b.similarity !== undefined ? \`<p style="margin: 3px 0;"><span class="label">Similarity:</span> \${(b.similarity * 100).toFixed(0)}%</p>\` : ''}
          \${b.priorityWeight !== undefined ? \`<p style="margin: 3px 0;"><span class="label">Priority:</span> \${(b.priorityWeight * 100).toFixed(0)}%</p>\` : ''}
          \${b.time !== undefined ? \`<p style="margin: 3px 0;"><span class="label">Time:</span> \${(b.time * 100).toFixed(0)}%</p>\` : ''}
          \${b.space !== undefined ? \`<p style="margin: 3px 0;"><span class="label">Space:</span> \${(b.space * 100).toFixed(0)}%</p>\` : ''}
          \${b.quantity !== undefined ? \`<p style="margin: 3px 0;"><span class="label">Quantity:</span> \${(b.quantity * 100).toFixed(0)}%</p>\` : ''}
        </div>
        \` : ''}
        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; margin-bottom: 10px;">
          <p style="margin: 0 0 5px 0;"><strong style="color: \${categoryColors[cap.category]}">Capacity #\${cap.id}</strong></p>
          <p style="margin: 0 0 5px 0;"><span class="label">Category:</span> \${cap.category.replace(/_/g, ' ')}</p>
          <p style="margin: 0 0 5px 0;"><span class="label">Expressions:</span> \${cap.expressions?.join(', ')}</p>
          <p style="margin: 0; font-style: italic; color: #ccc;">\${cap.label}</p>
        </div>
        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px;">
          <p style="margin: 0 0 5px 0;"><strong style="color: \${categoryColors[need.category]}">Need #\${need.id}</strong></p>
          <p style="margin: 0 0 5px 0;"><span class="label">Category:</span> \${need.category.replace(/_/g, ' ')}</p>
          <p style="margin: 0 0 5px 0;"><span class="label">Expressions:</span> \${need.expressions?.join(', ')}</p>
          <p style="margin: 0; font-style: italic; color: #ccc;">\${need.label}</p>
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
    }

    slider.addEventListener('input', (e) => updateThreshold(e.target.value));
    updateThreshold(60); // Apply initial threshold
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
