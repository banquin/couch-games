// Board drawing for the TV and phone: department grids, the race track, and transient effects.
// Pure markup from views; no rules here. Swapping to a 3D renderer replaces this file + icons.js.
import { DEPTS, DEPT_INFO, MACHINES, TECHS, TERRAIN, CONFIG } from '../config.js';
import { machineSvg, resIcon, deptBadge, RES_COLOR, BOLT } from './icons.js';
import { esc, W, COLS, NC, NR, NCELLS, dn, dc } from './text.js';

const CS = 100, GAP = 6, STEP = CS + GAP;
export const GRID_W = STEP * NC - GAP, GRID_H = STEP * NR - GAP;
export const cellXY = i => [(i % NC) * STEP, Math.floor(i / NC) * STEP];

// One department's 4×4 grid as an <svg>. opts:
//  dials {cell:v}, cells (phone extras), ghost {cell,type|tech}, sel cell, hl Set, letters bool,
//  heatCap, lanes {col: 'hit'|'cov'|'warn'|'req'}, cls extra class, upgrade cell, tap bool
export function gridSvg(grid, color, opts = {}) {
  const top = opts.letters ? 30 : 0;
  let s = `<svg class="dgrid ${opts.cls || ''}" viewBox="-4 ${-top - 4} ${GRID_W + 8} ${GRID_H + top + 8}" style="--c:${color}">`;
  s += `<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18263d"/><stop offset="1" stop-color="#0c1525"/></linearGradient>
    <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="12" fill="#ff4d3a55"/></pattern></defs>`;
  for (let c = 0; c < NC; c++) {
    const x = c * STEP;
    const lane = opts.lanes && opts.lanes[c];
    if (lane) s += `<rect class="lane ${lane}" x="${x - 3}" y="-3" width="${CS + 6}" height="${GRID_H + 6}" rx="14"/>`;
    if (opts.letters) s += `<text class="col-l ${lane || ''}" x="${x + CS / 2}" y="-9" text-anchor="middle">${COLS[c]}</text>`;
  }
  for (let i = 0; i < NCELLS; i++) s += tile(grid[i], i, color, opts);
  return s + '</svg>';
}

function tile(m, i, color, o) {
  const [x, y] = cellXY(i);
  const extra = (o.cells && o.cells[i]) || {};
  const sel = o.sel === i ? ' sel' : '';
  const hl = o.hl && o.hl.has(i) ? ' hl' : '';
  const tap = o.tap ? ' tap' : '';
  if (!m) {
    const g = o.ghost && o.ghost.cell === i ? o.ghost : null;
    return `<g class="tile empty${sel}${hl}${tap}${g ? ' ghost' : ''}" data-cell="${i}" transform="translate(${x},${y})">
      <rect class="tbg" width="${CS}" height="${CS}" rx="14"/>
      ${g ? `<g class="glyph" transform="translate(10,8) scale(.8)">${machineSvg(g.type || 'module', color)}</g><text class="tg-x" x="50" y="94" text-anchor="middle">NEW</text>` : (o.tap ? `<text class="plus" x="50" y="62" text-anchor="middle">+</text>` : '')}
    </g>`;
  }
  const def = MACHINES[m.type];
  const idle = m.idle || extra.idle;
  const off = m.jam || m.tripped || idle || (m.type === 'module' && !m.online) || (m.type === 'projector' && !m.charged);
  const cls = ['tile', 'm-' + m.type, off ? 'off' : 'active', m.jam ? 'jam' : '', idle ? 'idle' : '', m.hot ? 'hot' : '', extra.moved ? 'moved' : ''].join(' ');
  const up = o.upgrade === i;
  let s = `<g class="${cls}${sel}${hl}${tap}${up ? ' up' : ''}" data-cell="${i}" transform="translate(${x},${y})" style="--glow:${color}">
    <rect class="tbg" width="${CS}" height="${CS}" rx="14"/>
    <rect class="tshine" x="4" y="4" width="${CS - 8}" height="30" rx="10"/>
    <g class="glyph" transform="translate(12,6) scale(.76)">${machineSvg(m.type, color)}</g>`;
  // level pips (bottom-left)
  const maxL = def.levels || 1;
  if (maxL > 1) for (let l = 0; l < maxL; l++) s += `<rect class="lvl ${l < m.lvl ? 'on' : ''}" x="${8 + l * 11}" y="86" width="8" height="8" rx="2" transform="rotate(45 ${12 + l * 11} 90)"/>`;
  // dial badge (top-right)
  const dial = o.dials && o.dials[i] != null ? o.dials[i] : (m.type === 'engine' ? m.throttle : m.set);
  let badge = '';
  if (m.type === 'reactor' || m.type === 'turbine') badge = `⚡${dial || 0}`;
  else if (m.type === 'engine') badge = `T${dial || 0}`;
  else if (m.type === 'capacitor') badge = `${m.store || 0}`;
  else if (m.type === 'module' && m.tech) badge = (TECHS[m.tech] ? TECHS[m.tech].name : m.tech).split(' ').map(w => w[0]).join('');
  if (badge) s += `<g class="badge"><rect x="${CS - 44}" y="4" width="40" height="24" rx="7"/><text x="${CS - 24}" y="22" text-anchor="middle">${esc(badge)}</text></g>`;
  // engine heat pips (right edge)
  if (m.type === 'engine') {
    const cap = o.heatCap || 4, h = extra.startHeat != null ? extra.startHeat : m.heat || 0;
    for (let k = 0; k < cap; k++) s += `<rect class="heat ${k < h ? 'on' : ''} ${k >= cap - 1 ? 'top' : ''}" x="${CS - 11}" y="${80 - k * 11}" width="7" height="8" rx="2"/>`;
  }
  // status ribbon
  const why = m.jam ? 'JAMMED' : m.tripped ? 'TRIPPED' : idle ? 'MOVING' : (m.type === 'module' && !m.online) ? 'OFFLINE' : (m.type === 'projector' && !m.charged) ? 'EMPTY' : m.hot ? 'HOT' : '';
  if (m.jam) s += `<rect class="jamhatch" width="${CS}" height="${CS}" rx="14" fill="url(#hatch)"/>`;
  if (why) s += `<g class="ribbon ${why.toLowerCase()}"><rect x="10" y="60" width="80" height="20" rx="5"/><text x="50" y="75" text-anchor="middle">${why}</text></g>`;
  if (up) s += `<text class="tg-x" x="50" y="58" text-anchor="middle">▲ LVL</text>`;
  return s + '</g>';
}

// ---------------- TV department panel ----------------
export function deptPanel(v, d, opts = {}) {
  const x = v.depts[d], info = DEPT_INFO[d];
  const human = x.seat && !x.auto;
  const who = x.seat ? esc(x.seat.name) + (x.auto ? ' <span class="muted">(autopilot)</span>' : '') : '<span class="muted">Bot</span>';
  const lanes = {};
  if (v.strikeLanes) for (const l of v.strikeLanes) if (l.dept === d) lanes[l.col] = 'warn';
  for (const c of x.covReq || []) if (!lanes[c]) lanes[c] = 'req';
  if (opts.ev && opts.ev.ev) for (const s of opts.ev.ev.strikes) if (s.dept === d && s.at >= 0) lanes[s.at] = s.covered ? 'cov' : s.hit.length ? 'hit' : 'miss';
  const ghost = x.building && x.building.type ? { cell: x.building.cell, type: x.building.type } : x.building && x.building.tech ? { cell: x.building.cell, type: 'module' } : null;
  const head = `<div class="ph">
      ${deptBadge(info.color, info.short[0], 34)}
      <div class="ph-name"><b>${esc(info.name)}</b><span class="ph-who">${who}</span></div>
      <span class="ph-lvl" title="Highest level ${esc(info.name)} can build">LV ${x.unlocked}</span>
      ${x.seat ? `<button class="ph-auto ${x.auto ? 'on' : ''}" data-auto="${d}">${x.auto ? 'Give back' : 'Autopilot'}</button>` : ''}
      <span class="ph-lamp ${x.ready ? 'on' : ''}">${x.ready ? 'READY' : human ? 'PLANNING' : '…'}</span>
    </div>`;
  const grid = gridSvg(x.grid, info.color, { letters: true, lanes, ghost, upgrade: x.building && x.building.upgrade != null ? x.building.upgrade : null });
  return `<div class="panel-in" style="--c:${info.color}">${head}<div class="pbody">${grid}<div class="pside">${side(v, d)}</div></div></div>`;
}

const chip = (res, n, label, cls = '') => `<div class="st ${cls}">${resIcon(res, 20)}<b>${n}</b><span>${esc(label)}</span></div>`;
function side(v, d) {
  const x = v.depts[d], p = v.projection;
  const out = [];
  // what this department wants
  if (d !== 'power' && x.asks.power) out.push(chip('power', x.asks.power, 'asks ' + W.power, pledged(v, d, 'power') < x.asks.power ? 'short' : ''));
  if (x.asks.plates) out.push(chip('plates', x.asks.plates, 'asks ' + W.plates, pledged(v, d, 'plates') < x.asks.plates ? 'short' : ''));
  if (d === 'power') {
    if (p) out.push(chip('power', p.gen, 'making'));
    const tot = Object.values(x.outbox).reduce((s, o) => s + (o.power || 0), 0);
    out.push(chip('power', tot, 'pledged'));
    out.push(sendBars(v, x.outbox, 'power'));
  }
  if (d === 'fab') {
    if (p) out.push(chip('plates', p.plates, W.plates + ' made'));
    if (x.recipe.gears) out.push(chip('gears', x.recipe.gears, W.gears + ' to make'));
    if (x.recipe.cores) out.push(chip('cores', x.recipe.cores, W.cores + ' to make'));
    out.push(sendBars(v, x.outbox, 'plates'));
  }
  if (d === 'loco') {
    if (p) out.push(chip('strides', p.dist, 'planned'));
    if (x.asks.gears) out.push(chip('gears', x.asks.gears, 'asks ' + W.gears));
    if (v.fork) out.push(`<div class="st"><span class="route">${esc(W.route)}: <b>${esc(TERRAIN[v.fork[v.route]].name)}</b></span></div>`);
  }
  if (d === 'research') {
    out.push(chip('insight', x.hold.insight, W.insight));
    if (v.techsOnline.length) out.push(`<div class="st techs">${v.techsOnline.map(t => `<span class="tech">${esc(TECHS[t].name)}</span>`).join('')}</div>`);
    if (v.overclock.length) out.push(`<div class="st"><span>Overclock: ${v.overclock.map(o => `<b style="color:${dc(o)}">${esc(DEPT_INFO[o].short)}</b>`).join(' ')}</span></div>`);
  }
  if (d === 'shield') {
    const req = DEPTS.filter(o => (v.depts[o].covReq || []).length);
    if (req.length) out.push(`<div class="st"><span>${esc(W.cover)} asked: ${req.map(o => `<b style="color:${dc(o)}">${esc(DEPT_INFO[o].short)} ${v.depts[o].covReq.map(c => COLS[c]).join('')}</b>`).join(' ')}</span></div>`);
    else out.push(`<div class="st muted"><span>Only ${esc(dn('shield'))} sees the ${esc(W.lightning)}</span></div>`);
  }
  // holds
  const hold = ['plates', 'gears', 'cores'].filter(k => x.hold[k]).map(k => `<span class="hold">${resIcon(k, 16)}${x.hold[k]}</span>`).join('');
  if (hold) out.push(`<div class="st holds"><span class="muted">has</span>${hold}</div>`);
  return out.join('');
}
function pledged(v, d, res) {
  if (res === 'power') return ((v.depts.power.outbox[d] || {}).power || 0);
  return ((v.depts.fab.outbox[d] || {}).plates || 0);
}
function sendBars(v, outbox, res) {
  const rows = Object.entries(outbox).filter(([k]) => k !== 'fab' || res !== 'plates');
  const max = Math.max(4, ...rows.map(([, o]) => o[res] || 0));
  return `<div class="bars">${rows.map(([k, o]) => {
    const n = o[res] || 0, ask = v.depts[k] ? v.depts[k].asks[res] || 0 : 0;
    return `<div class="bar ${n < ask ? 'short' : ''}" style="--c:${dc(k)}"><span>${esc(DEPT_INFO[k].short)}</span><i style="width:${(n / max) * 100}%"></i><b>${n}${ask ? `<small>/${ask}</small>` : ''}</b></div>`;
  }).join('')}</div>`;
}

// ---------------- the race track (TV left column, viewBox 0 0 200 1000) ----------------
// Kept as persistent elements so the city and storm glide between positions.
export function drawTrack(svg, v, track) {
  const lo = Math.min(v.stormStart, 0) - 5, hi = v.haven;
  const Y = p => 940 - ((p - lo) / (hi - lo)) * 860;
  const key = `${lo}:${hi}`;
  if (svg.dataset.key !== key) {
    svg.dataset.key = key;
    let s = `<defs><linearGradient id="stormg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff2d55" stop-opacity=".85"/><stop offset=".85" stop-color="#7a1530" stop-opacity=".7"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></linearGradient>
      <linearGradient id="haveng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5cf2a8" stop-opacity=".5"/><stop offset="1" stop-color="#5cf2a8" stop-opacity="0"/></linearGradient></defs>`;
    s += `<rect x="70" y="${Y(hi)}" width="60" height="${Y(lo) - Y(hi)}" rx="30" class="trk-road"/>`;
    for (let p = 0; p <= hi; p += 25) s += `<line x1="64" x2="136" y1="${Y(p)}" y2="${Y(p)}" class="trk-tick"/><text x="58" y="${Y(p) + 6}" text-anchor="end" class="trk-n">${p}</text>`;
    s += `<rect x="40" y="${Y(hi) - 70}" width="120" height="90" fill="url(#haveng)"/><text x="100" y="${Y(hi) - 28}" text-anchor="middle" class="trk-haven">${esc(W.haven.toUpperCase())}</text><text x="100" y="${Y(hi) - 8}" text-anchor="middle" class="trk-n">${hi}</text>`;
    s += `<g id="tHist"></g><rect id="tStorm" x="50" width="100" rx="10" fill="url(#stormg)"/>`;
    s += `<g id="tStormLbl" class="trk-glide"><text x="100" y="0" text-anchor="middle" class="trk-storm">${esc(W.Storm.toUpperCase())}</text><text id="tStormN" x="100" y="24" text-anchor="middle" class="trk-n"></text></g>`;
    s += `<g id="tCity" class="trk-glide">${cityGlyph()}<text id="tCityN" x="30" y="-30" class="trk-city-n"></text></g>`;
    svg.innerHTML = s;
  }
  const city = track ? track.city : v.city, storm = track ? track.storm : v.storm;
  svg.querySelector('#tCity').style.transform = `translate(100px, ${Y(city)}px)`;
  svg.querySelector('#tCityN').textContent = city;
  const sy = Y(storm);
  svg.querySelector('#tStorm').setAttribute('y', sy);
  svg.querySelector('#tStorm').setAttribute('height', Math.max(0, 960 - sy));
  svg.querySelector('#tStormLbl').style.transform = `translate(0, ${sy + 34}px)`;
  svg.querySelector('#tStormN').textContent = storm;
  svg.querySelector('#tHist').innerHTML = (v.history || []).map(h => `<circle cx="100" cy="${Y(h.city)}" r="4" class="trk-dot"/>`).join('');
}
function cityGlyph() {
  // A small train climbing the track (seen from the side, nose up). Replaced by the chosen art direction later.
  return `<g transform="translate(-26,-44)">
    <circle class="smoke" cx="26" cy="-4" r="7" fill="#c9d4e6" opacity=".8"/>
    <rect x="18" y="0" width="16" height="10" rx="2" fill="#3d6596"/>
    <rect x="10" y="8" width="32" height="26" rx="6" fill="#ff5a4e" stroke="#ffd2a0" stroke-width="2"/>
    <rect x="16" y="14" width="20" height="8" rx="2" fill="#ffd23e" class="blink"/>
    <rect x="12" y="36" width="28" height="18" rx="3" fill="#ffb02e"/><rect x="12" y="56" width="28" height="18" rx="3" fill="#4aa8ff"/>
    <rect x="12" y="76" width="28" height="12" rx="3" fill="#5cf2a8"/>
    <g class="wheels" fill="#dfe9f5"><circle cx="8" cy="22" r="3"/><circle cx="44" cy="22" r="3"/><circle cx="8" cy="46" r="3"/><circle cx="44" cy="46" r="3"/><circle cx="8" cy="66" r="3"/><circle cx="44" cy="66" r="3"/></g>
  </g>`;
}

// ---------------- transient effects (in a layer above the board, so re-renders don't erase them) ----------------
function layer() {
  let l = document.getElementById('fx');
  if (!l) { l = document.createElement('div'); l.id = 'fx'; document.body.appendChild(l); }
  return l;
}
function gridRect(dept) {
  const svg = document.querySelector(`#p-${dept} .dgrid`);
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const k = Math.min(r.width / vb.width, r.height / vb.height);
  const ox = r.left + (r.width - vb.width * k) / 2 - vb.x * k, oy = r.top + (r.height - vb.height * k) / 2 - vb.y * k;
  return { k, ox, oy, r };
}
function put(el, ms = 1800) { layer().appendChild(el); setTimeout(() => el.remove(), ms); return el; }

export function laneFlash(dept, col, kind = 'hit') {
  const g = gridRect(dept); if (!g) return;
  const el = document.createElement('div');
  el.className = 'fx-lane ' + kind;
  const x = g.ox + (col * STEP - 4) * g.k, w = (CS + 8) * g.k;
  Object.assign(el.style, { left: x + 'px', top: (g.oy - 4 * g.k) + 'px', width: w + 'px', height: (GRID_H + 8) * g.k + 'px' });
  el.innerHTML = `<svg viewBox="0 0 24 24" class="fx-bolt">${BOLT}</svg>${kind === 'cov' ? '<div class="fx-dome"></div>' : ''}<span>${kind === 'cov' ? esc(W.cover.toUpperCase()) + 'ED' : kind === 'hit' ? 'JAMMED' : 'MISS'}</span>`;
  put(el, 2000);
}
export function cellFx(dept, cell, text, cls = '') {
  const g = gridRect(dept); if (!g) return;
  const el = document.createElement('div');
  el.className = 'fx-pop ' + cls;
  let x, y;
  if (cell == null) { x = g.r.left + g.r.width / 2; y = g.r.top + g.r.height * .45; }
  else { const [cx, cy] = cellXY(cell); x = g.ox + (cx + CS / 2) * g.k; y = g.oy + (cy + CS / 2) * g.k; }
  Object.assign(el.style, { left: x + 'px', top: y + 'px' });
  el.innerHTML = text;
  put(el, 1700);
}
