// The TV's city, drawn like a factory map: square district platforms around the
// Main Drive, machines on each tile, and conveyor belts carrying items between
// every pair of buildings that feed each other (bridges cross district borders).
// Seat 0 sits at the bottom; seats run counter-clockwise, so each player's
// right-hand neighbour is the next platform to their right (seen from outside).
import { CARDS } from '../config.js';
import { tileGlyph, resPath, RES_COLOR, KIND_TINT } from './art.js';
import { neighbors } from '../engine/production.js';

const NS = 'http://www.w3.org/2000/svg';
const rad = a => a * Math.PI / 180;
const CORE = 120;

export function seatAngle(N, d) { return 90 - d * 360 / N; }
export function layout(N) {
  const T = N === 3 ? 112 : N === 4 ? 104 : 94;
  const S = 3 * T;
  const Rc = Math.max(CORE + 34 + S / 2, (S + 70) / (2 * Math.sin(Math.PI / N)));
  return { T, S, Rc };
}
// Tile centre and the 4 corners of its (rotated) square.
export function tileGeom(N, d, t) {
  const { T, Rc } = layout(N);
  const r = Math.floor(t / 3), c = t % 3;
  const phi = rad(seatAngle(N, d) - 90);
  const rot = (x, y) => [x * Math.cos(phi) - y * Math.sin(phi), x * Math.sin(phi) + y * Math.cos(phi)];
  const lx = (c - 1) * T, ly = Rc + (r - 1) * T;
  const [cx, cy] = rot(lx, ly);
  const h = T / 2 - 4;
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => rot(lx + x, ly + y));
  return { cx, cy, corners, T, rot };
}
const el = (tag, attrs = {}, html = '') => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};
const pts = cs => cs.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');

export function createRing(svg, N, players) {
  const { T, S, Rc } = layout(N);
  const VB = Math.ceil(Math.hypot(Rc + S / 2, S / 2) + 70);
  svg.setAttribute('viewBox', `${-VB} ${-VB} ${2 * VB} ${2 * VB}`);
  svg.innerHTML = '';
  svg.appendChild(el('defs', {}, `
    <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="12" height="12" fill="#05080faa"/><line x1="0" y1="0" x2="0" y2="12" stroke="#ff5a3c55" stroke-width="5"/></pattern>
    <pattern id="floor" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#0d1420"/><path d="M24,0 H0 V24" fill="none" stroke="#182336" stroke-width="1.5"/></pattern>
    <radialGradient id="coreGlow"><stop offset="0" stop-color="#ffb04a" stop-opacity=".9"/><stop offset=".35" stop-color="#ff8f2e" stop-opacity=".35"/><stop offset="1" stop-color="#ff8f2e" stop-opacity="0"/></radialGradient>`));

  // orbit rings in the background (holographic map feel)
  const bg = el('g', { class: 'bg-rings' });
  for (const R of [CORE + 20, Rc, Rc + S / 2 + 30]) bg.appendChild(el('circle', { r: R, class: 'orbit' }));
  svg.appendChild(bg);

  // platforms
  const platG = el('g', { class: 'platforms' });
  for (let d = 0; d < N; d++) {
    const g0 = tileGeom(N, d, 0), g8 = tileGeom(N, d, 8);
    const phi = rad(seatAngle(N, d) - 90);
    const rot = (x, y) => [x * Math.cos(phi) - y * Math.sin(phi), x * Math.sin(phi) + y * Math.cos(phi)];
    const h = S / 2 + 10;
    const cs = [[-h, Rc - h], [h, Rc - h], [h, Rc + h], [-h, Rc + h]].map(([x, y]) => rot(x, y));
    platG.appendChild(el('polygon', { points: pts(cs), class: 'platform', fill: 'url(#floor)', stroke: players[d].color }));
    // corner brackets in the player's colour
    const bl = 34;
    const br = [[-h, Rc - h, 1, 1], [h, Rc - h, -1, 1], [h, Rc + h, -1, -1], [-h, Rc + h, 1, -1]].map(([x, y, sx, sy]) =>
      `M${rot(x + sx * bl, y).join(',')} L${rot(x, y).join(',')} L${rot(x, y + sy * bl).join(',')}`).join(' ');
    platG.appendChild(el('path', { d: br, class: 'bracket', stroke: players[d].color }));
    void g0; void g8;
  }
  svg.appendChild(platG);

  // Three layers so belts run over the floor tiles but under the machines.
  const floorG = el('g', { class: 'tiles floor' });
  const beltG = el('g', { class: 'belts' });
  const machG = el('g', { class: 'tiles machines' });
  const tiles = [];
  for (let d = 0; d < N; d++) for (let t = 0; t < 9; t++) {
    const G = tileGeom(N, d, t);
    const g = el('g', { class: 'tile empty', 'data-k': d * 9 + t });
    g.appendChild(el('polygon', { points: pts(G.corners), class: 'tbg' }));
    g.appendChild(el('polygon', { points: pts(G.corners), class: 'thatch', fill: 'url(#hatch)' }));
    floorG.appendChild(g);
    const m = el('g', { class: 'tile empty' });
    const sc = T / 92 * 0.74;
    const gl = el('g', { class: 'glyph', transform: `translate(${G.cx.toFixed(1)},${G.cy.toFixed(1)}) scale(${sc.toFixed(3)})` });
    m.appendChild(gl);
    const badge = el('g', { class: 'badge', transform: `translate(${(G.cx - 34 * sc).toFixed(1)},${(G.cy - 34 * sc).toFixed(1)})` });
    m.appendChild(badge);
    machG.appendChild(m);
    tiles.push({ g, m, gl, badge, G, card: null });
  }
  svg.appendChild(floorG);
  svg.appendChild(beltG);
  svg.appendChild(machG);

  // core: the Main Drive, a lattice ring that fills in stage by stage
  const core = el('g', { class: 'core' });
  core.appendChild(el('circle', { r: CORE + 10, fill: 'url(#coreGlow)' }));
  core.appendChild(el('circle', { r: CORE - 6, class: 'core-ring' }));
  const lattice = el('g', { class: 'lattice' });
  core.appendChild(lattice);
  const coreInfo = el('g', { class: 'core-info' });
  core.appendChild(coreInfo);
  const pipsG = el('g', { class: 'pips' });
  core.appendChild(pipsG);
  svg.appendChild(core);

  const nameG = el('g', { class: 'names' });
  for (let d = 0; d < N; d++) {
    const a = rad(seatAngle(N, d)), R = Rc + S / 2 + 44;
    const x = R * Math.cos(a), y = R * Math.sin(a);
    const g = el('g', { class: 'name-tag', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, 'data-d': d });
    g.appendChild(el('path', { d: 'M-100,-22 L88,-22 L100,-10 L100,22 L-88,22 L-100,10 Z', fill: '#070b13', stroke: players[d].color, 'stroke-width': 3 }));
    g.appendChild(el('text', { class: 'name-text', x: -8, y: 9, 'text-anchor': 'middle', fill: players[d].color }, escapeXml(players[d].name.toUpperCase())));
    g.appendChild(el('rect', { class: 'ready-dot', x: 72, y: -8, width: 16, height: 16, rx: 3 }));
    nameG.appendChild(g);
  }
  svg.appendChild(nameG);
  const fxG = el('g', { class: 'fxs' });
  svg.appendChild(fxG);

  // Belts: one per (producer -> consumer, resource) pair that could feed each other.
  let beltKey = '';
  let belts = [];
  function buildBelts(districts) {
    const key = JSON.stringify(districts.map(D => D.map(b => b && b.card)));
    if (key === beltKey) return;
    beltKey = key;
    beltG.innerHTML = '';
    belts = [];
    for (let d = 0; d < N; d++) for (let t = 0; t < 9; t++) {
      const b = districts[d][t];
      if (!b) continue;
      const needs = CARDS[b.card].needs;
      for (const [d2, t2] of neighbors(N, d, t)) {
        const p = districts[d2][t2];
        if (!p) continue;
        const makes = CARDS[p.card].makes;
        const res = Object.keys(needs).filter(r => makes[r]);
        res.forEach((r, i) => {
          const A = tiles[d2 * 9 + t2].G, B = tiles[d * 9 + t].G;
          const dx = B.cx - A.cx, dy = B.cy - A.cy, L = Math.hypot(dx, dy);
          const off = (i - (res.length - 1) / 2) * 12;
          const nx = -dy / L * off, ny = dx / L * off;
          const x1 = A.cx + nx, y1 = A.cy + ny, x2 = B.cx + nx, y2 = B.cy + ny;
          const g = el('g', { class: 'belt' + (d2 !== d ? ' bridge' : '') });
          g.appendChild(el('line', { x1, y1, x2, y2, class: 'belt-bed' }));
          g.appendChild(el('line', { x1, y1, x2, y2, class: 'belt-items', stroke: RES_COLOR[r] }));
          beltG.appendChild(g);
          belts.push({ g, from: d2 * 9 + t2, to: d * 9 + t, res: r });
        });
      }
      // dock belts to the core
      if (t < 3 && CARDS[b.card].makes.part) {
        const A = tiles[d * 9 + t].G, a = Math.atan2(A.cy, A.cx);
        const g = el('g', { class: 'belt dockbelt' });
        const x2 = (CORE - 8) * Math.cos(a), y2 = (CORE - 8) * Math.sin(a);
        g.appendChild(el('line', { x1: A.cx, y1: A.cy, x2, y2, class: 'belt-bed' }));
        g.appendChild(el('line', { x1: A.cx, y1: A.cy, x2, y2, class: 'belt-items', stroke: RES_COLOR.part }));
        beltG.appendChild(g);
        belts.push({ g, from: d * 9 + t, to: 'core', res: 'part' });
      }
    }
  }
  function setBelts(running) {
    // a belt moves when its producer runs
    for (const B of belts) B.g.classList.toggle('on', running.has(B.from));
  }

  function setTiles(districts, st = {}) {
    // st: { lit:Set (running), starved:Map(k->missing), off:Set, fresh:Set, surge:Set }
    buildBelts(districts);
    const lit = st.lit || st.active || new Set();
    for (let d = 0; d < N; d++) for (let t = 0; t < 9; t++) {
      const k = d * 9 + t, Tl = tiles[k], b = districts[d][t];
      const card = b ? b.card : null;
      if (card !== Tl.card) { Tl.gl.innerHTML = card ? tileGlyph(card) : ''; Tl.card = card; }
      const def = card && CARDS[card];
      let cls = 'tile ' + (card ? def.kind : 'empty');
      if (card) cls += lit.has(k) ? ' active' : ' idle';
      if (st.starved && st.starved.has(k)) cls += ' starved';
      if (st.off && st.off.has(k)) cls += ' off';
      if (st.fresh && st.fresh.has(k)) cls += ' fresh';
      if (st.surge && st.surge.has(k)) cls += ' surge';
      Tl.g.setAttribute('class', cls);
      Tl.m.setAttribute('class', cls);
      if (card) for (const e of [Tl.g, Tl.m]) {
        e.style.setProperty('--glow', RES_COLOR[Object.keys(def.makes)[0]] || '#fff');
        e.style.setProperty('--tint', KIND_TINT[def.kind]);
      }
      const miss = st.starved && st.starved.get(k);
      const off = st.off && st.off.has(k);
      Tl.badge.innerHTML = miss ? `<g class="warn"><path d="M0,-21 L21,16 L-21,16 Z" fill="#2a0a0a" stroke="#ff4d3a" stroke-width="3.5" stroke-linejoin="round"/>${resPath(Object.keys(miss)[0], 0, 4, 0.8)}</g>`
        : off ? `<g><circle r="18" fill="#05080f" stroke="#ff4d3a" stroke-width="3"/>${resPath('power', 0, 0, 1.1, { color: '#ff4d3a' })}</g>` : '';
    }
    setBelts(lit);
  }
  function setCore(v) {
    const st = v.core.current, done = v.core.stage, total = v.core.stages.length;
    // lattice: one arc segment per stage, lit when finished
    let lat = '';
    for (let i = 0; i < total; i++) {
      const a0 = -90 + i * 90 + 4, a1 = a0 + 82;
      const R = CORE - 6;
      const P = (a, r) => `${(r * Math.cos(rad(a))).toFixed(1)},${(r * Math.sin(rad(a))).toFixed(1)}`;
      lat += `<path d="M${P(a0, R)} A${R},${R} 0 0 1 ${P(a1, R)}" class="seg ${i < done ? 'done' : i === done ? 'now' : ''}"/>`;
      for (let j = 1; j < 5; j++) { const a = a0 + j * 82 / 5; lat += `<line x1="${P(a, R - 10).split(',')[0]}" y1="${P(a, R - 10).split(',')[1]}" x2="${P(a, R + 8).split(',')[0]}" y2="${P(a, R + 8).split(',')[1]}" class="seg-tick ${i < done ? 'done' : ''}"/>`; }
    }
    lattice.innerHTML = lat;
    coreInfo.innerHTML = `<text class="core-title" y="-50" text-anchor="middle">MAIN DRIVE</text>
      <text class="core-stage" y="-12" text-anchor="middle">${st ? `STAGE ${done + 1}/${total}` : 'COMPLETE'}</text>
      ${st ? `<g transform="translate(0,22)"><text class="core-need" x="-10" y="9" text-anchor="middle">${st.need}×</text>${resPath('part', 20, 0, 1.25)}</g><text class="core-sub" y="58" text-anchor="middle">PER DISTRICT</text>` : ''}
      ${v.bonus ? `<g transform="translate(0,${st ? 84 : 30})"><text class="core-bonus" text-anchor="middle" x="-10" y="8">+${v.bonus}</text>${resPath('stride', 22, 0, 0.9)}</g>` : ''}`;
    pipsG.innerHTML = '';
    if (!st) return;
    for (let d = 0; d < N; d++) {
      const a = rad(seatAngle(N, d)), R = CORE + 16;
      const x = R * Math.cos(a), y = R * Math.sin(a);
      const have = v.core.progress[d], full = have >= st.need;
      pipsG.appendChild(el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, class: 'pip' + (full ? ' full' : '') },
        `<rect x="-22" y="-15" width="44" height="30" rx="5" fill="${full ? v.players[d].color : '#070b13'}" stroke="${v.players[d].color}" stroke-width="3"/>
         <text y="7" text-anchor="middle" class="pip-text" fill="${full ? '#070b13' : v.players[d].color}">${full ? '✓' : `${have}/${st.need}`}</text>`));
    }
  }
  function setReady(v) {
    nameG.querySelectorAll('.name-tag').forEach(g => {
      const p = v.players[Number(g.dataset.d)];
      g.classList.toggle('ready', !!p.ready && v.phase === 'plan');
      g.classList.toggle('waiting', !p.ready && v.phase === 'plan');
    });
  }
  function flows(list, dur = 900) {
    // brief bright pulse along the belts that just started carrying items
    for (const f of list) {
      const B = belts.find(b => b.from === f.from && b.to === f.to && b.res === f.res);
      if (B) { B.g.classList.remove('pulse-now'); void B.g.getBBox; B.g.classList.add('pulse-now'); setTimeout(() => B.g.classList.remove('pulse-now'), dur); }
    }
  }
  function dock(d, res, dur = 900) {
    const t = [0, 1, 2].map(i => d * 9 + i).find(k => tiles[k].card && CARDS[tiles[k].card].makes.part) ?? d * 9 + 1;
    const A = tiles[t].G;
    const dot = el('g', { class: 'flow-dot' }, `<circle r="15" fill="#070b13" stroke="${RES_COLOR[res] || '#fff'}" stroke-width="3"/>${resPath(res, 0, 0, 0.9)}`);
    dot.animate([{ transform: `translate(${A.cx}px,${A.cy}px)` }, { transform: 'translate(0px,0px)', opacity: 0.1 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
    fxG.appendChild(dot);
    setTimeout(() => dot.remove(), dur + 100);
  }
  function fx(k, text, cls = '') {
    const G = k === 'core' ? { cx: 0, cy: 0 } : tiles[k].G;
    const t = el('text', { x: G.cx, y: G.cy, class: 'fx ' + cls, 'text-anchor': 'middle' }, escapeXml(text));
    fxG.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }
  return { setTiles, setCore, setReady, flows, dock, fx, N };
}
function escapeXml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
