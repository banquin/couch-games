// SVG star-map renderer shared by the TV board and the phone mini-map.
import { buildMap } from '../engine/map.js';

const NS = 'http://www.w3.org/2000/svg';
export const CELL = 100;
export const CARGO_ICON = { Ice: '❄', Ore: '⛰', Spores: '✿', Relics: '♜', Plasma: '✦', Silk: '◈', Medics: '✚', Glass: '◇' };

export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const mapCache = new Map();
export function mapFor(view) {
  const key = JSON.stringify(view.cfg.map) + view.n;
  if (!mapCache.has(key)) mapCache.set(key, buildMap(view.cfg, view.n));
  return mapCache.get(key);
}

function seeded(n) { let s = n; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// Builds the static layers once. Returns an object with update functions.
export function createBoard(svg, view, opts = {}) {
  const map = mapFor(view);
  const W = map.w * CELL, H = map.h * CELL;
  svg.setAttribute('viewBox', `-20 -20 ${W + 40} ${H + 40}`);
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <radialGradient id="bgGlow" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="#1b2550"/><stop offset="0.6" stop-color="#0d1330"/><stop offset="1" stop-color="#070a1c"/>
    </radialGradient>
    <radialGradient id="wellGlow"><stop offset="0" stop-color="#000"/><stop offset="0.35" stop-color="#1a0f3a"/>
      <stop offset="0.75" stop-color="#5b2ca8" stop-opacity="0.45"/><stop offset="1" stop-color="#5b2ca8" stop-opacity="0"/></radialGradient>
    <radialGradient id="nebA"><stop offset="0" stop-color="#ff6fae" stop-opacity=".10"/><stop offset="1" stop-color="#ff6fae" stop-opacity="0"/></radialGradient>
    <radialGradient id="nebB"><stop offset="0" stop-color="#3ec5ff" stop-opacity=".10"/><stop offset="1" stop-color="#3ec5ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%"><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    <radialGradient id="shadowGrad" cx="70%" cy="70%" r="70%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="rocks" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="40" height="40" fill="#151a2e"/><circle cx="10" cy="12" r="6" fill="#2a3050"/>
      <circle cx="30" cy="28" r="8" fill="#232842"/><circle cx="28" cy="8" r="3" fill="#323a5e"/></pattern>
    <marker id="arrowHead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
    ${Object.entries(view.cfg.planets).map(([k, p]) => `
      <radialGradient id="pl-${k}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/>
      <stop offset="0.25" stop-color="${p.color}"/><stop offset="1" stop-color="${shade(p.color, -0.6)}"/></radialGradient>`).join('')}
  `;
  el('rect', { x: -20, y: -20, width: W + 40, height: H + 40, rx: 30, fill: 'url(#bgGlow)' }, svg);
  el('ellipse', { cx: W * 0.78, cy: H * 0.22, rx: W * 0.35, ry: H * 0.22, fill: 'url(#nebA)' }, svg);
  el('ellipse', { cx: W * 0.2, cy: H * 0.8, rx: W * 0.32, ry: H * 0.25, fill: 'url(#nebB)' }, svg);
  // stars
  const stars = el('g', { opacity: 0.8 }, svg);
  const r = seeded(7);
  for (let i = 0; i < (opts.mini ? 60 : 160); i++) {
    el('circle', { cx: r() * W, cy: r() * H, r: r() * 2.2 + 0.4, fill: r() > 0.85 ? '#ffe9b0' : '#cfe0ff', opacity: 0.25 + r() * 0.6 }, stars);
  }
  // grid
  const grid = el('g', { stroke: '#8fa6ff', 'stroke-opacity': opts.mini ? 0.12 : 0.07, 'stroke-width': 2 }, svg);
  for (let x = 0; x <= map.w; x++) el('line', { x1: x * CELL, y1: 0, x2: x * CELL, y2: H }, grid);
  for (let y = 0; y <= map.h; y++) el('line', { x1: 0, y1: y * CELL, x2: W, y2: y * CELL }, grid);

  // closed spaces (asteroid fields)
  const terrain = el('g', {}, svg);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (map.cells[y][x].kind === 'closed') {
      el('rect', { x: x * CELL + 3, y: y * CELL + 3, width: CELL - 6, height: CELL - 6, rx: 14, fill: 'url(#rocks)', opacity: 0.95 }, terrain);
    }
  }
  // wells
  map.wells.forEach((w, i) => {
    const cx = (w.x + 0.5) * CELL, cy = (w.y + 0.5) * CELL;
    el('circle', { cx, cy, r: CELL * 1.75, fill: 'url(#wellGlow)' }, terrain);
    const sw = el('g', { class: 'well-swirl', style: `transform-origin:${cx}px ${cy}px` }, terrain);
    for (let k = 1; k <= 3; k++) el('circle', { cx, cy, r: CELL * (0.45 * k), fill: 'none', stroke: '#b98cff', 'stroke-opacity': 0.5 - k * 0.1, 'stroke-width': 3, 'stroke-dasharray': `${10 + k * 6} ${14 + k * 4}` }, sw);
    el('circle', { cx, cy, r: CELL * 0.2, fill: '#05030d', stroke: '#d9b8ff', 'stroke-width': 3 }, terrain);
    if (!opts.mini) {
      const t = el('text', { x: cx, y: cy + CELL * 1.5 + 30, class: 'well-label', 'text-anchor': 'middle' }, terrain);
      t.textContent = w.name;
    }
  });
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const c = map.cells[y][x];
    if (c.kind !== 'ring') continue;
    const cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
    const [dx, dy] = c.pull;
    const len = 26;
    el('rect', { x: x * CELL + 6, y: y * CELL + 6, width: CELL - 12, height: CELL - 12, rx: 16, fill: '#7a4dff', 'fill-opacity': 0.09, stroke: '#a985ff', 'stroke-opacity': 0.22, 'stroke-width': 2 }, terrain);
    const n = Math.hypot(dx, dy);
    el('line', { x1: cx - dx / n * len, y1: cy - dy / n * len, x2: cx + dx / n * len, y2: cy + dy / n * len,
      stroke: '#b79cff', 'stroke-width': 7, 'stroke-linecap': 'round', 'marker-end': 'url(#arrowHead)', color: '#b79cff', opacity: 0.7 }, terrain);
  }
  // planets
  const planetLayer = el('g', {}, svg);
  const STYLE = ['ring', 'bands', 'moon', 'craters', 'plain-big', 'ring2'];
  Object.values(map.planets).forEach((p, idx) => {
    const cx = (p.x + 0.5) * CELL, cy = (p.y + 0.5) * CELL;
    // docking zone: the 8 spaces where you can load/deliver
    el('rect', { x: (p.x - 1) * CELL + 5, y: (p.y - 1) * CELL + 5, width: CELL * 3 - 10, height: CELL * 3 - 10, rx: 24,
      fill: p.color, 'fill-opacity': 0.07, stroke: p.color, 'stroke-opacity': 0.4, 'stroke-width': 2 }, planetLayer);
    const st = STYLE[idx % STYLE.length];
    const R = CELL * (st === 'plain-big' ? 0.46 : 0.4);
    const pg = el('g', {}, planetLayer);
    if (st === 'ring' || st === 'ring2') el('ellipse', { cx, cy, rx: CELL * 0.66, ry: CELL * 0.17, fill: 'none', stroke: p.color, 'stroke-width': st === 'ring2' ? 7 : 4, opacity: 0.45, transform: `rotate(${st === 'ring2' ? 22 : -18} ${cx} ${cy})` }, pg);
    el('circle', { cx, cy, r: R, fill: `url(#pl-${p.key})`, filter: opts.mini ? null : 'url(#glow)' }, pg);
    const clipId = 'clip-' + p.key + (opts.mini ? 'm' : '');
    const cp = el('clipPath', { id: clipId }, pg); el('circle', { cx, cy, r: R }, cp);
    const deco = el('g', { 'clip-path': `url(#${clipId})` }, pg);
    if (st === 'bands') for (const dy of [-0.45, -0.1, 0.3]) el('rect', { x: cx - R, y: cy + R * dy, width: R * 2, height: R * 0.16, fill: shade(p.color, -0.35), opacity: 0.6 }, deco);
    if (st === 'craters') for (const [dx, dy, rr] of [[-0.35, -0.2, 0.18], [0.3, 0.25, 0.13], [0.1, -0.45, 0.09]]) el('circle', { cx: cx + R * dx, cy: cy + R * dy, r: R * rr, fill: shade(p.color, -0.4), opacity: 0.55 }, deco);
    el('circle', { cx, cy, r: R, fill: 'url(#shadowGrad)' }, deco);
    if (st === 'ring' || st === 'ring2') { // front half of the ring
      const path = `M ${cx - CELL * 0.66} ${cy} A ${CELL * 0.66} ${CELL * 0.17} 0 0 0 ${cx + CELL * 0.66} ${cy}`;
      el('path', { d: path, fill: 'none', stroke: p.color, 'stroke-width': st === 'ring2' ? 7 : 4, opacity: 0.9, transform: `rotate(${st === 'ring2' ? 22 : -18} ${cx} ${cy})` }, pg);
    }
    if (st === 'moon') el('circle', { cx: cx + R * 1.2, cy: cy - R * 0.9, r: R * 0.22, fill: shade(p.color, 0.4) }, pg);
    const t = el('text', { x: cx, y: cy - CELL * 0.6, class: 'planet-label', 'text-anchor': 'middle', fill: p.color }, planetLayer);
    t.textContent = opts.mini ? p.name.slice(0, 3) : p.name;
  });
  el('rect', { x: -20, y: -20, width: W + 40, height: H + 40, rx: 30, fill: 'url(#vignette)', 'pointer-events': 'none' }, svg);
  const contractLayer = el('g', {}, svg);
  const overlay = el('g', {}, svg);   // ghost paths, highlights
  const shipLayer = el('g', {}, svg);
  const fxLayer = el('g', {}, svg);
  const ships = {};

  function updateContracts(contracts, players = [], markIds = []) {
    contractLayer.innerHTML = '';
    const byPlanet = {};
    const carried = new Set(players.flatMap(p => (p.hold || []).filter(h => !h.salvage).map(h => h.cid)));
    for (const c of contracts) {
      if (!view.cfg.sharedCargo && carried.has(c.id)) continue; // already picked up
      (byPlanet[c.from] = byPlanet[c.from] || []).push(c);
    }
    for (const [k, list] of Object.entries(byPlanet)) {
      const p = map.planets[k]; if (!p) continue;
      list.forEach((c, i) => {
        const dest = map.planets[c.to];
        const cw = 78;
        const cx = (p.x + 0.5) * CELL + (i - (list.length - 1) / 2) * (cw + 6), cy = (p.y + 0.5) * CELL + CELL * 0.8;
        const g = el('g', { class: 'contract-chip' + (markIds.includes(c.id) ? ' marked' : '') }, contractLayer);
        el('rect', { x: cx - cw / 2, y: cy - 22, width: cw, height: 44, rx: 12, fill: '#0b1026', stroke: dest ? dest.color : '#fff', 'stroke-width': 4 }, g);
        el('rect', { x: cx + 2, y: cy - 18, width: cw / 2 - 6, height: 36, rx: 8, fill: dest ? dest.color : '#fff' }, g);
        const t = el('text', { x: cx - cw / 4 + 1, y: cy + 12, 'text-anchor': 'middle', class: 'chip-text' }, g);
        t.textContent = c.points;
        const d = el('text', { x: cx + cw / 4 - 1, y: cy + 11, 'text-anchor': 'middle', class: 'chip-dest' }, g);
        d.textContent = dest ? dest.name[0] : '?';
      });
    }
  }

  function shipShape(p) {
    const g = el('g', { class: 'ship', 'data-id': p.id }, shipLayer);
    const body = el('g', { class: 'ship-body' }, g);
    el('circle', { r: 46, class: 'active-ring', fill: 'none', stroke: p.color, 'stroke-width': 6 }, g);
    el('circle', { r: 40, fill: p.color, opacity: 0.16 }, body);
    el('path', { d: 'M-9,22 L0,44 L9,22 Z', class: 'flame', fill: '#ffd36b' }, body);
    el('path', { d: 'M0,-38 L25,26 L0,15 L-25,26 Z', fill: p.color, stroke: '#fff', 'stroke-width': 4, 'stroke-linejoin': 'round' }, body);
    el('path', { d: 'M0,-20 L8,4 L-8,4 Z', fill: '#fff', opacity: 0.85 }, body);
    const nm = (p.name || '?').slice(0, opts.mini ? 1 : 5);
    const pw = opts.mini ? 30 : 16 + nm.length * 15;
    el('rect', { x: -pw / 2, y: 38, width: pw, height: 28, rx: 14, fill: p.color, stroke: '#070a1c', 'stroke-width': 3 }, g);
    const lbl = el('text', { y: 59, 'text-anchor': 'middle', class: 'ship-label' }, g);
    lbl.textContent = nm;
    const cargo = el('g', { class: 'ship-cargo' }, g);
    return { g, body, cargo, rot: 0 };
  }
  const ROT = { N: 0, E: 90, S: 180, W: 270 };

  function updateShips(players, positions, facing = {}) {
    for (const p of players) {
      if (!ships[p.id]) ships[p.id] = shipShape(p);
      const s = ships[p.id];
      const [x, y] = positions ? positions[p.id] : [p.x, p.y];
      s.g.style.transform = `translate(${(x + 0.5) * CELL}px, ${(y + 0.5) * CELL}px)`;
      if (facing[p.id]) s.rot = ROT[facing[p.id]];
      s.body.style.transform = `rotate(${s.rot}deg)`;
      s.cargo.innerHTML = '';
      (p.hold || []).forEach((h, i) => {
        const dest = map.planets[h.to];
        el('rect', { x: 34, y: -44 + i * 26, width: 24, height: 24, rx: 5, fill: h.salvage ? '#666' : (dest ? dest.color : '#fff'), stroke: '#0b1026', 'stroke-width': 3 }, s.cargo);
        const t = el('text', { x: 46, y: -25 + i * 26, 'text-anchor': 'middle', class: 'pip-text' }, s.cargo);
        t.textContent = dest ? dest.name[0] : '';
      });
    }
  }

  function fx(x, y, text, cls = '') {
    const fxX = Math.min(Math.max((x + 0.5) * CELL, 170), W - 170), fxY = Math.max((y + 0.5) * CELL - 40, 70);
    const t = el('text', { x: fxX, y: fxY, 'text-anchor': 'middle', class: 'fx ' + cls }, fxLayer);
    t.textContent = text;
    setTimeout(() => t.remove(), 1600);
  }

  function highlightShip(id) {
    for (const [k, s] of Object.entries(ships)) s.g.classList.toggle('active', k === id);
  }

  return { map, svg, overlay, updateContracts, updateShips, fx, highlightShip, ships };
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}
