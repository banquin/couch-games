// Role bots. Each fills one department's plan. planBots() runs them in the order a good table would talk:
// consumers say what they want → Power pledges → Fab plans on its power → consumers fit to pledges → re-pledge.
// Styles: 'greedy' (default), 'random' (any legal plan), 'idle' (keeps last plan, just taps Ready),
// 'deaf' (ignores asks: Power and Fab split evenly).
import * as E from './engine.js';
import { DEPTS, MACHINES, THROTTLE, TERRAIN, TECHS, OVERCLOCK, CONFIG } from '../config.js';
import { makeRng, rand, randInt } from './rng.js';

const empties = g => g.map((m, i) => m ? -1 : i).filter(i => i >= 0);
const count = (g, type) => g.filter(m => m && m.type === type).length;
const cellsOf = (g, type) => g.map((m, i) => m && m.type === type ? i : -1).filter(i => i >= 0);
const nAdj = (g, i, type) => E.adj(i).filter(j => g[j] && g[j].type === type).length;
function bestCell(g, score) {
  let best = -1, bs = -Infinity;
  for (const i of empties(g)) { const s = score(i); if (s > bs) { bs = s; best = i; } }
  return best;
}
// columns Shield's Projectors can cover (any department)
function coveredCols(state) {
  const cols = new Set();
  state.depts.shield.grid.forEach((m, i) => { if (m && m.type === 'projector') cols.add(E.colOf(i)); });
  return cols;
}
const safeBonus = (state, i) => coveredCols(state).has(E.colOf(i)) ? 0.4 : 0;

function set(state, d, plan) { return E.applyAction(state, { type: 'draft', dept: d, plan }); }
function cur(state, d) { return E.clone(state.depts[d].plan); }
function nextFork(state) { return state.forks[state.round] ? state.forks[state.round] : null; }

// ---------------- Power ----------------
function planPower(state, o) {
  const pw = state.depts.power, g = pw.grid, p = cur(state, 'power');
  const consumers = ['fab', 'loco', 'shield', 'research'];
  const ask = d => state.depts[d].plan.asks.power;
  const D = consumers.reduce((s, d) => s + ask(d), 0);
  const loco = state.depts.loco.plan;
  let need = D;
  const capStore = g.reduce((s, m) => s + (m && m.type === 'capacitor' && E.on(m) ? m.store : 0), 0);
  p.dials = {};
  // Reactors first: cheap, steady. Ramp ahead if Locomotion flags a sprint.
  for (const i of cellsOf(g, 'reactor')) {
    const m = g[i];
    if (!E.on(m)) continue;
    const [lo, hi] = E.reactorRange(state, g, i);
    let v = Math.min(hi, Math.max(lo, need + (loco.sprint ? 3 : 1)));
    p.dials[i] = v; need -= v;
  }
  // Turbines: stay cool (≤ half) unless needed.
  const turbs = cellsOf(g, 'turbine').filter(i => E.on(g[i]));
  const cooled = i => E.adj(i).some(j => g[j] && g[j].type === 'cooler' && E.on(g[j]));
  for (const i of turbs) { const full = MACHINES.turbine.max[g[i].lvl - 1], max = E.turbineMax(g, i); const v = Math.max(0, Math.min(need - Math.min(capStore, 2), cooled(i) ? max : Math.floor(full / 2), max)); p.dials[i] = v; need -= v; }
  for (const i of turbs) { if (need <= Math.min(capStore, 2)) break; const max = E.turbineMax(g, i); const add = Math.min(max - p.dials[i], need); p.dials[i] += add; need -= add; }
  const gen = Object.values(p.dials).reduce((s, v) => s + v, 0) + (TERRAIN[E.terrainOf(state, state.round, loco.route)].power || 0);
  let supply = gen + capStore;
  const order = o.deaf ? consumers : ['fab', 'loco', 'shield', 'research'];
  p.order = order; p.outbox = {};
  for (const d of order) {
    const want = o.deaf ? Math.floor((gen + capStore) / 4) : ask(d);
    const give = Math.max(0, Math.min(want, supply)); supply -= give;
    p.outbox[d] = { power: give };
  }
  // Build: grow ahead of demand.
  const plates = pw.hold.plates;
  // Build: grow ahead of demand, choosing the best sustained power per plate.
  const sustained = (gg) => cellsOf(gg, 'reactor').reduce((s2, i) => s2 + Math.max(0, MACHINES.reactor.max[gg[i].lvl - 1] - 2 * nAdj(gg, i, 'reactor')), 0)
    + cellsOf(gg, 'turbine').reduce((s2, i) => { const f = MACHINES.turbine.max[gg[i].lvl - 1]; return s2 + (E.adj(i).some(j => gg[j] && gg[j].type === 'cooler') ? f : Math.floor(f / 2)); }, 0);
  const base = sustained(g);
  const cands = [];
  for (const type of ['reactor', 'turbine', 'cooler', 'capacitor']) for (const c of empties(g)) {
    const gg = g.slice(); gg[c] = { type, lvl: 1 };
    let gain = sustained(gg) - base;
    if (type === 'capacitor') gain = (count(g, 'capacitor') < 1 + Math.floor(state.round / 3) ? 2 : 0.5) + (state.last && state.last.ev.trip ? 2 : 0);
    if (type === 'cooler') gain += 0.5 * nAdj(g, c, 'reactor');
    gain += safeBonus(state, c);
    cands.push({ b: { type, cell: c }, gain, cost: E.buildCost(state, type) });
  }
  for (const i of cellsOf(g, 'reactor').concat(cellsOf(g, 'turbine'), cellsOf(g, 'capacitor'))) {
    const m = g[i]; const cost = E.upgradeCost(state, m); if (cost === Infinity) continue;
    const gain = m.type === 'reactor' ? 3 : m.type === 'turbine' ? 1 : 1.5;
    cands.push({ b: { upgrade: i }, gain, cost });
  }
  const deficit = D + 4 - base;
  cands.sort((x, y) => (y.gain / y.cost) - (x.gain / x.cost));
  const choose = pl => { const c = cands.find(x => x.cost <= pl && (deficit > 0 || x.b.type === 'capacitor' || x.b.upgrade != null || x.gain >= 3)); return c ? c.b : null; };
  p.build = choose(plates);
  p.next = choose(99) || { type: 'reactor' };
  if (p.next && p.next.cell != null && p.build && p.build.cell === p.next.cell) p.next = { type: p.next.type };
  set(state, 'power', p);
}

// ---------------- Fabrication ----------------
function fabBuild(state, g, plates, lp) {
  const fc = E.fabCaps(state, g, 99);
  const loAsk = state.depts.loco.plan.asks.gears, reAsk = state.depts.research.plan.asks.cores;
  const smeltCell = bestCell(g, i => 3 * nAdj(g, i, 'drill') + nAdj(g, i, 'press') + safeBonus(state, i));
  const drillCell = bestCell(g, i => 3 * nAdj(g, i, 'smelter') + safeBonus(state, i));
  const pressCell = bestCell(g, i => 3 * nAdj(g, i, 'smelter') + 2 * nAdj(g, i, 'assembler') + safeBonus(state, i));
  const asmCell = bestCell(g, i => 3 * nAdj(g, i, 'press') + safeBonus(state, i));
  const opts = [];
  if (fc.ore > fc.smelt + 1 && smeltCell >= 0) opts.push({ type: 'smelter', cell: smeltCell });
  if (fc.smelt > fc.ore + 1 && drillCell >= 0) opts.push({ type: 'drill', cell: drillCell });
  if (loAsk > fc.press && pressCell >= 0) opts.push({ type: 'press', cell: pressCell });
  if (count(state.depts.research.grid, 'analyzer') && !count(g, 'assembler') && asmCell >= 0) opts.push({ type: 'assembler', cell: asmCell });
  const lowDrill = cellsOf(g, 'drill').find(i => g[i].lvl < 2), lowSmelt = cellsOf(g, 'smelter').find(i => g[i].lvl < 2);
  if (fc.smelt >= fc.ore && lowDrill != null) opts.push({ upgrade: lowDrill });
  if (fc.ore >= fc.smelt && lowSmelt != null) opts.push({ upgrade: lowSmelt });
  if (drillCell >= 0) opts.push({ type: 'drill', cell: drillCell });
  const cost = b => b.upgrade != null ? E.upgradeCost(state, g[b.upgrade]) : E.buildCost(state, b.type);
  return { now: opts.find(b => cost(b) <= plates) || null, next: opts[0] || null };
}

function planFab(state, o) {
  const fb = state.depts.fab, p = cur(state, 'fab');
  const g0 = fb.grid;
  // a free move that raises output
  p.moves = [];
  const val = gg => { const c = E.fabCaps(state, gg, 99); return c.plates + 1.5 * Math.min(c.press, 3); };
  let best = val(g0), bm = null;
  for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) {
    if (!g0[a] && !g0[b]) continue;
    const gg = E.gridAfterMoves(g0, [[a, b]]); const v = val(gg);
    if (v > best + 1.9) { best = v; bm = [a, b]; }
  }
  if (bm && !o.noMoves) p.moves = [bm];
  const g = E.gridAfterMoves(g0, p.moves);
  const b = fabBuild(state, g, fb.hold.plates, p);
  p.build = b.now; p.next = b.next;
  let platesLeft = fb.hold.plates - (b.now ? (b.now.upgrade != null ? E.upgradeCost(state, g[b.now.upgrade]) : E.buildCost(state, b.now.type)) : 0);
  const gAfter = g.slice();
  if (b.now && b.now.type) gAfter[b.now.cell] = E.newMachine({ nextId: 0 }, b.now.type);
  const powerPledge = (state.depts.power.plan.outbox.fab || {}).power || 0;
  const ter = TERRAIN[E.terrainOf(state, state.round, state.depts.loco.plan.route)];
  const fc = E.fabCaps(state, gAfter, Math.max(powerPledge, 0), ter, (state.depts.research.plan.overclock || []).includes('fab'));
  const gc = E.techActive(state, 'finepress') ? 1 : 2;
  let pool = fc.plates + platesLeft;
  const gearsWant = state.depts.loco.plan.asks.gears, coresWant = state.depts.research.plan.asks.cores;
  const gears = o.deaf ? Math.min(1, fc.press) : Math.min(gearsWant, fc.press, Math.floor(pool / gc));
  pool -= gears * gc;
  const cores = o.deaf ? 0 : Math.min(coresWant, fc.asm, Math.max(0, fc.press - gears), Math.floor(pool / (gc + 1)));
  pool -= cores * (gc + 1);
  p.recipe = { gears, cores };
  // keep enough for Fab's own next build early on, then ship plates where they complete a build
  const nextCost = b.next ? (b.next.upgrade != null ? E.upgradeCost(state, g[b.next.upgrade]) : E.buildCost(state, b.next.type)) : 0;
  const keep = state.round <= 5 ? Math.min(Math.max(0, nextCost - CONFIG.salvage), Math.floor(pool / 3)) : 0;
  pool = Math.max(0, pool - keep);
  const want = d => state.depts[d].plan.asks.plates;
  const rank = { power: 0, loco: 1, shield: 2, research: 3 };
  const ds = ['power', 'loco', 'shield', 'research'];
  if (!o.deaf) ds.sort((a, b) => (want(a) > pool ? 1 : 0) - (want(b) > pool ? 1 : 0) || rank[a] - rank[b]);
  p.order = ds; p.outbox = {};
  for (const d of ds) { const w = o.deaf ? Math.floor(pool / 4) : Math.min(want(d), pool); p.outbox[d] = { plates: Math.max(0, w) }; pool -= Math.max(0, w); }
  // anything Fab can't hold goes to whoever has room, rather than overflowing
  const fabRoom = CONFIG.caps.plates;
  if (!o.deaf) for (const d of ['loco', 'power', 'shield', 'research']) {
    if (pool <= fabRoom) break;
    const room = CONFIG.caps.plates - state.depts[d].hold.plates - p.outbox[d].plates + 2;
    const t = Math.max(0, Math.min(room, pool - fabRoom)); p.outbox[d].plates += t; pool -= t;
  }
  set(state, 'fab', p);
}

// ---------------- Locomotion ----------------
function bestThrottles(state, g, budget, gears, grade, nextGrade, oc) {
  const eng = cellsOf(g, 'engine').filter(i => E.on(g[i]));
  const gbs = cellsOf(g, 'gearbox').filter(i => E.on(g[i]));
  const cap = E.heatCap(state);
  const gt = E.techActive(state, 'geartrains');
  const evalTs = ts => {
    let draw = 0, gUse = 0, strides = 0, pen = 0;
    for (const i of eng) {
      const t = ts[i], m = g[i];
      const h0 = E.startHeat(state, g, i, oc);
      if (h0 + THROTTLE.heat[t] > cap) return null;
      draw += THROTTLE.draw[t]; if (t === 3 && !gt) gUse++;
      let s = MACHINES.engine.strides[m.lvl - 1][t];
      const gb = E.adj(i).filter(j => gbs.includes(j)).length;
      if (t >= 2) s += gb * (t === 3 ? 2 : 1);
      strides += s;
      const after = h0 + THROTTLE.heat[t] - 1 - E.radiatorCool(g, i);
      pen += Math.max(0, after + 3 - cap) * (nextGrade > grade ? 2.5 : 0.8);
    }
    const gbDraw = Math.min(gbs.length, Math.max(0, budget - draw));
    if (draw + gbDraw > budget || gUse > gears) return null;
    return { score: strides * grade - pen - draw * 0.05, strides };
  };
  // local search: start at T0, repeatedly take the single throttle step that helps most
  const ts = {}; for (const i of eng) ts[i] = 0;
  let curv = evalTs(ts) || { score: 0, strides: 0 };
  for (let it = 0; it < eng.length * 4; it++) {
    let best = null, bi = -1, bt = 0;
    for (const i of eng) for (const t of [ts[i] + 1, ts[i] + 2]) {
      if (t > 3) continue;
      const old = ts[i]; ts[i] = t; const v = evalTs(ts); ts[i] = old;
      if (v && v.score > curv.score + 1e-9 && (!best || v.score > best.score)) { best = v; bi = i; bt = t; }
    }
    if (!best) break;
    ts[bi] = bt; curv = best;
  }
  return { ts, strides: curv.strides };
}

function planLoco(state, o, pass) {
  const lo = state.depts.loco, p = cur(state, 'loco');
  const g = lo.grid;
  const fork = state.forks[state.round - 1];
  const nf = nextFork(state);
  const nextGrade = nf ? TERRAIN[nf[0]].grade : 1;
  const pledge = (state.depts.power.plan.outbox.loco || {}).power || 0;
  const budget = pass === 1 ? Math.max(pledge, (state.depts.loco.plan.asks.power || 0)) + 3 : pledge;
  const gears = lo.hold.gears + (pass === 1 ? 2 : state.depts.fab.plan.recipe.gears);
  const oc = (state.depts.research.plan.overclock || []).includes('loco');
  // route: fast unless the storm is far enough behind to take the richer ground
  const evalRoute = r => { const t = TERRAIN[fork[r]]; const bt = bestThrottles(state, g, budget, gears, t.grade, nextGrade, oc); return { bt, dist: Math.floor(bt.strides * t.grade) }; };
  const a = evalRoute(0), b = evalRoute(1);
  const tb = TERRAIN[fork[1]];
  const fabSlack = Math.max(0, E.fabCaps(state, state.depts.fab.grid, 99).smelt - E.fabCaps(state, state.depts.fab.grid, 99).ore);
  const early = state.round <= 4 ? 1.2 : state.round <= 6 ? 0.8 : 0.4;
  const bonus = early * (tb.plates ? 5 * tb.plates : tb.ore ? Math.min(2 * count(state.depts.fab.grid, 'drill'), fabSlack + 2) : tb.power ? tb.power * 0.8 : 0);
  const speedNext = E.stormSpeed(state, state.round) + E.stormSpeed(state, state.round + 1);
  const gapIfRich = state.city + b.dist - (state.storm + E.stormSpeed(state, state.round)) - 0.6 * E.stormSpeed(state, state.round + 1);
  const remaining = state.rules.haven - state.city;
  let route = (b.dist + bonus > a.dist && gapIfRich > 4) ? 1 : 0;
  if (o.random) route = randInt(o.rng, 2);
  p.route = route;
  const chosen = route ? b : a;
  p.dials = {};
  g.forEach((m, i) => { if (m && m.type === 'engine') p.dials[i] = chosen.bt.ts[i] != null ? chosen.bt.ts[i] : 0; });
  p.sprint = nf ? TERRAIN[nf[0]].grade > 1 : false;
  // Build
  const plates = lo.hold.plates;
  const eng = cellsOf(g, 'engine');
  const lastShort = state.last && state.last.ev.broken.some(x => x.to === 'loco' && x.res === 'power');
  const heatLimited = eng.some(i => E.maxThrottle(state, g, i, false) < 3);
  const engCell = bestCell(g, i => 2 * nAdj(g, i, 'radiator') + nAdj(g, i, 'gearbox') + safeBonus(state, i));
  const radCell = bestCell(g, i => 3 * nAdj(g, i, 'engine') + safeBonus(state, i));
  const gbCell = bestCell(g, i => 3 * nAdj(g, i, 'engine'));
  const low = eng.filter(i => g[i].lvl < 3).sort((x, y) => g[x].lvl - g[y].lvl)[0];
  const opts = [];
  const canUp = low != null && E.upgradeCost(state, g[low]) < Infinity;
  if (lastShort && canUp) opts.push({ upgrade: low });
  if (!lastShort && engCell >= 0) opts.push({ type: 'engine', cell: engCell });
  if (heatLimited && radCell >= 0 && nAdj(g, radCell, 'engine') >= 1 && count(g, 'radiator') < eng.length) opts.push({ type: 'radiator', cell: radCell });
  if (gbCell >= 0 && nAdj(g, gbCell, 'engine') >= 2 && !count(g, 'gearbox') && eng.length >= 3) opts.push({ type: 'gearbox', cell: gbCell });
  if (canUp) opts.push({ upgrade: low });
  if (engCell >= 0) opts.push({ type: 'engine', cell: engCell });
  const cost = x => x.upgrade != null ? E.upgradeCost(state, g[x.upgrade]) : E.buildCost(state, x.type);
  p.build = opts.find(x => cost(x) <= plates) || null;
  if (p.build && p.build.type === 'engine') p.dials[p.build.cell] = 2;
  p.next = opts.find(x => x !== p.build) || opts[0] || null;
  if (lastShort && low != null && !canUp && g[low].lvl < E.maxLevel('engine')) p.next = { upgrade: low }; // asks Research for the blueprint
  if (o.random) randomize(state, 'loco', p, o.rng);
  set(state, 'loco', p);
}

// ---------------- Shielding ----------------
const LANE_W = { reactor: 3, turbine: 3, capacitor: 1, cooler: 1, drill: 2, smelter: 2, press: 2, assembler: 2, engine: 3, radiator: 1, gearbox: 1, projector: 2, armory: 1, radar: 1, lab: 2, analyzer: 1, uplink: 2, module: 3 };
function laneValue(state, d, col) {
  const dep = state.depts[d];
  const g = E.gridAfterMoves(dep.grid, dep.plan.moves);
  const c = E.strikeTarget(g, col);
  if (c < 0) return { col: c, v: 0 };
  let v = 0;
  for (let r = 0; r < 4; r++) { const m = g[r * 4 + c]; if (m) v += (LANE_W[m.type] || 1) * (m.jam > 1 ? 0.3 : 1) * (dep.plan.covReq.includes(c) ? 2 : 1); }
  return { col: c, v };
}
function planShield(state, o) {
  const sh = state.depts.shield, p = cur(state, 'shield');
  const g = sh.grid;
  const lanes = E.strikesFor(state, state.round).map(l => ({ ...l, ...laneValue(state, l.dept, l.col) }))
    .filter(l => l.col >= 0).sort((a, b) => b.v - a.v);
  const cap = E.shieldCapacity(state, g, null);
  const covers = [], done = new Set();
  for (const pj of cap.projectors) {
    let n = pj.covers; const usedDepts = new Set();
    for (const l of lanes) {
      if (!n) break;
      if (done.has(l.dept + l.col) || !pj.cols.includes(l.col) || usedDepts.has(l.dept)) continue;
      covers.push({ dept: l.dept, col: l.col, src: pj.cell }); done.add(l.dept + l.col); usedDepts.add(l.dept); n--;
    }
  }
  let oc = cap.oc;
  for (const l of lanes) { if (!oc) break; if (done.has(l.dept + l.col)) continue; covers.push({ dept: l.dept, col: l.col, src: 'oc' }); done.add(l.dept + l.col); oc--; }
  // Armory covers for anything valuable left, keeping plates for a Projector when short of them
  const projN = count(g, 'projector');
  const strikesNext = state.rules.strikes[Math.min(state.round, state.rules.strikes.length - 1)] || 0;
  let plates = sh.hold.plates;
  const reserve = projN < Math.ceil(strikesNext / 2) ? E.buildCost(state, 'projector') : 0;
  let arm = cap.armory;
  for (const l of lanes) {
    if (!arm || done.has(l.dept + l.col)) continue;
    if (l.v >= 4 && plates - 2 >= reserve - (l.v >= 6 ? 3 : 0)) { covers.push({ dept: l.dept, col: l.col, src: 'armory' }); done.add(l.dept + l.col); plates -= 2; arm--; }
  }
  p.covers = covers;
  // Build: more Projectors in the most valuable column, Radar once, then upgrades.
  const colVal = c => DEPTS.reduce((s, d) => s + laneValue(state, d, c).v, 0);
  const projCell = bestCell(g, i => colVal(E.colOf(i)) - 3 * (coveredCols(state).has(E.colOf(i)) ? 1 : 0) + 1.5 * [i - 1, i + 1].filter(j => j >= 0 && j < 16 && E.rowOf(j) === E.rowOf(i) && g[j] && g[j].type === 'projector').length);
  const lowProj = cellsOf(g, 'projector').find(i => g[i].lvl < 2);
  const opts = [];
  if (projN < Math.ceil(strikesNext / 2) + 1 && projCell >= 0) opts.push({ type: 'projector', cell: projCell });
  if (!count(g, 'radar') && state.round >= 2) { const c = bestCell(g, i => -colVal(E.colOf(i))); if (c >= 0) opts.push({ type: 'radar', cell: c }); }
  if (lowProj != null) opts.push({ upgrade: lowProj });
  const lowArm = cellsOf(g, 'armory').find(i => g[i].lvl < 2);
  if (lowArm != null) opts.push({ upgrade: lowArm });
  const cost = x => x.upgrade != null ? E.upgradeCost(state, g[x.upgrade]) : E.buildCost(state, x.type);
  p.build = opts.find(x => cost(x) <= plates) || null;
  p.next = opts.find(x => x !== p.build) || null;
  if (o.random) randomize(state, 'shield', p, o.rng);
  set(state, 'shield', p);
}

// ---------------- Research ----------------
const TECH_W = { deepcells: 2, fastramp: 3, finepress: 4, directfeed: 4, heatsinks: 4, geartrains: 4, widebeam: 4, stormchart: 2, rapidrefit: 2, prefab: 5 };
function planResearch(state, o) {
  const rs = state.depts.research, p = cur(state, 'research');
  const g = rs.grid;
  let insight = rs.hold.insight;
  const roundsLeft = state.rules.rounds - state.round + 1;
  const S = state.depts;
  p.build = null; p.overclock = [];
  // blueprint: unlock the next level for the department that would use it most
  const UW = { reactor: 3, turbine: 1, capacitor: 1, drill: 2, smelter: 2, press: 1, assembler: 1, engine: 3, radiator: 1, projector: 2, armory: 1, lab: 2, analyzer: 1, uplink: 1 };
  p.unlock = null;
  let bu = null, bs = 6;
  const wants = d => { const n = S[d].plan.next; return n && n.upgrade != null && S[d].grid[n.upgrade] && S[d].grid[n.upgrade].lvl >= state.unlocked[d] && S[d].grid[n.upgrade].lvl < E.maxLevel(S[d].grid[n.upgrade].type); };
  for (const d of ['loco', 'power', 'fab', 'shield', 'research']) if (wants(d) && E.unlockCost(state, d) <= insight) { bu = d; break; }
  if (!bu) for (const d of DEPTS) {
    const c = E.unlockCost(state, d); if (c > insight) continue;
    const lvl = state.unlocked[d];
    const sc = S[d].grid.reduce((s2, m) => s2 + (m && m.lvl === lvl && E.maxLevel(m.type) > lvl ? (UW[m.type] || 1) : 0), 0) * (d === 'research' ? 0.8 : 1);
    if (sc > bs) { bs = sc; bu = d; }
  }
  if (bu) { p.unlock = bu; insight -= E.unlockCost(state, bu); }
  // tech: best affordable, placed next to an Uplink with room
  const uplinkCell = bestCell(g, i => E.adj(i).some(j => g[j] && g[j].type === 'uplink') ? 5 - nAdj(g, i, 'module') + safeBonus(state, i) : -99);
  const shelf = state.shelf.slice().sort((a, b) => TECH_W[b] - TECH_W[a]);
  const buy = shelf.find(t => E.techCost(t) <= insight);
  if (buy && uplinkCell >= 0 && E.adj(uplinkCell).some(j => g[j] && g[j].type === 'uplink') && roundsLeft >= 2) {
    p.build = { tech: buy, cell: uplinkCell }; insight -= E.techCost(buy);
  }
  // overclock the department that is short this round
  const pwAsk = ['fab', 'loco', 'shield', 'research'].reduce((s, d) => s + S[d].plan.asks.power, 0);
  const pwPledge = ['fab', 'loco', 'shield', 'research'].reduce((s, d) => s + ((S.power.plan.outbox[d] || {}).power || 0), 0);
  const plateAsk = ['power', 'loco', 'shield', 'research'].reduce((s, d) => s + S[d].plan.asks.plates, 0);
  const fork = state.forks[state.round - 1];
  const fast = TERRAIN[fork[S.loco.plan.route]].grade > 1;
  const hot = cellsOf(S.loco.grid, 'engine').some(i => E.maxThrottle(state, S.loco.grid, i, false) < 3);
  const strikes = E.strikesFor(state, state.round).length;
  const cand = [];
  if (pwAsk - pwPledge >= 4) cand.push('power');
  cand.push('loco');
  if (strikes >= 5) cand.push('shield');
  if (plateAsk >= 8) cand.push('fab');
  for (const c of cand) if (insight >= OVERCLOCK.cost && p.overclock.length < 3) { p.overclock.push(c); insight -= OVERCLOCK.cost; }
  // build when not buying a tech
  if (!p.build) {
    const labs = cellsOf(g, 'lab');
    const labCell = bestCell(g, i => 2 * nAdj(g, i, 'analyzer') + safeBonus(state, i) - (E.adj(i).some(j => g[j] && g[j].type === 'uplink') ? 1 : 0));
    const opts = [];
    if (labs.length < 2 && labCell >= 0) opts.push({ type: 'lab', cell: labCell });
    if (count(S.fab.grid, 'assembler') && !count(g, 'analyzer')) { const c = bestCell(g, i => 2 * nAdj(g, i, 'lab')); if (c >= 0) opts.push({ type: 'analyzer', cell: c }); }
    if (uplinkCell < 0 || cellsOf(g, 'module').length >= 2) { const c = bestCell(g, i => 4 - [...E.adj(i)].filter(j => g[j]).length); if (c >= 0) opts.push({ type: 'uplink', cell: c }); }
    const lowLab = labs.filter(i => g[i].lvl < 3).sort((a, b) => g[a].lvl - g[b].lvl)[0];
    if (lowLab != null) opts.push({ upgrade: lowLab });
    const cost = x => x.upgrade != null ? E.upgradeCost(state, g[x.upgrade]) : E.buildCost(state, x.type);
    p.build = opts.find(x => cost(x) <= rs.hold.plates) || null;
    p.next = opts.find(x => x !== p.build) || null;
  }
  if (o.random) randomize(state, 'research', p, o.rng);
  set(state, 'research', p);
}

// ---------------- random / idle ----------------
function randomize(state, d, p, rng) {
  const dep = state.depts[d], g = dep.grid;
  const types = E.buildable(d);
  const e = empties(g);
  const r = rand(rng);
  if (r < 0.4 && e.length) p.build = { type: types[randInt(rng, types.length)], cell: e[randInt(rng, e.length)] };
  else if (r < 0.6) { const ms = g.map((m, i) => m ? i : -1).filter(i => i >= 0); p.build = ms.length ? { upgrade: ms[randInt(rng, ms.length)] } : null; }
  else p.build = null;
  g.forEach((m, i) => {
    if (!m) return;
    if (m.type === 'engine') p.dials[i] = randInt(rng, 4);
    if (m.type === 'reactor') p.dials[i] = randInt(rng, 13);
    if (m.type === 'turbine') p.dials[i] = randInt(rng, 9);
  });
  if (d === 'power') { const tot = 4 + randInt(rng, 14); p.outbox = {}; for (const x of ['fab', 'loco', 'shield', 'research']) p.outbox[x] = { power: randInt(rng, tot) }; }
  if (d === 'fab') { p.outbox = {}; for (const x of ['power', 'loco', 'shield', 'research']) p.outbox[x] = { plates: randInt(rng, 4) }; p.recipe = { gears: randInt(rng, 3), cores: randInt(rng, 2) }; }
  if (d === 'loco') p.route = randInt(rng, 2);
  if (d === 'shield') {
    p.covers = [];
    const cap = E.shieldCapacity(state, g, null);
    for (const pj of cap.projectors) p.covers.push({ dept: DEPTS[randInt(rng, 5)], col: pj.cols[0], src: pj.cell });
    for (let k = 0; k < cap.armory; k++) if (rand(rng) < 0.5) p.covers.push({ dept: DEPTS[randInt(rng, 5)], col: randInt(rng, 4), src: 'armory' });
  }
  if (d === 'research') {
    p.overclock = rand(rng) < 0.5 ? [['power', 'fab', 'loco', 'shield'][randInt(rng, 4)]] : [];
    if (rand(rng) < 0.3 && state.shelf.length && e.length) p.build = { tech: state.shelf[randInt(rng, state.shelf.length)], cell: e[randInt(rng, e.length)] };
  }
}
// A plausible but imperfect human: the greedy plan with a few choices nudged.
function perturb(state, d, rng) {
  const p = cur(state, d), g = state.depts[d].grid;
  if (rand(rng) < 0.3) { const e = empties(g), ty = E.buildable(d); p.build = e.length && rand(rng) < 0.7 ? { type: ty[randInt(rng, ty.length)], cell: e[randInt(rng, e.length)] } : null; }
  for (const k of Object.keys(p.dials)) if (rand(rng) < 0.3) p.dials[k] = Math.max(0, p.dials[k] + (rand(rng) < 0.5 ? -1 : 1));
  for (const k of Object.keys(p.outbox)) for (const r of Object.keys(p.outbox[k])) if (rand(rng) < 0.3) p.outbox[k][r] = Math.max(0, p.outbox[k][r] + randInt(rng, 5) - 2);
  if (d === 'shield' && p.covers.length && rand(rng) < 0.3) p.covers.pop();
  if (d === 'loco' && rand(rng) < 0.15) p.route = 1 - p.route;
  if (d === 'research' && rand(rng) < 0.3) p.overclock = p.overclock.slice(0, Math.max(0, p.overclock.length - 1));
  set(state, d, p);
}
function planRandom(state, d, rng) { const p = cur(state, d); randomize(state, d, p, rng); set(state, d, p); }

const PLANNERS = { power: planPower, fab: planFab, loco: planLoco, shield: planShield, research: planResearch };

// Plan every department in `bots` (default: all). styles: { dept: 'greedy'|'random'|'idle'|'deaf'|'novice' }.
export function planBots(state, bots = DEPTS, styles = {}, rng = makeRng(state.seed + state.round * 7919)) {
  const is = d => bots.includes(d);
  const st = d => styles[d] || 'greedy';
  const run = (d, pass) => {
    if (!is(d)) return;
    const s = st(d);
    if (s === 'idle') return;
    if (s === 'random') { if (pass === 1) planRandom(state, d, rng); return; }
    const o = { deaf: s === 'deaf', noMoves: s === 'novice', rng };
    if (d === 'loco') planLoco(state, o, pass); else PLANNERS[d](state, o);
    if (s === 'noisy' && (pass === 1 || pass === 2)) perturb(state, d, rng);
  };
  run('loco', 1); run('shield', 1); run('research', 1);
  run('power', 2); run('fab', 2);
  run('loco', 3); run('research', 3); run('shield', 3);
  run('power', 4); run('fab', 4);
}
