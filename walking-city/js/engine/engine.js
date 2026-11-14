// The Walking City v0.3 rules engine. Pure: no DOM. It runs in Node (sim, tests) and in the TV page.
// A round: every department plans (build, moves, repairs, dials, outbox). Then resolveRound() runs the
// pipeline: plans take effect → strike → Power → Fab → Shield & Research → Locomotion → storm.
import { DEPTS, DEPT_INFO, MACHINES, UPGRADE_COST, HEAT_CAP, THROTTLE, ARMORY_PLATES, TECHS, TECH_COST, TECH_UNLOCK, SHELF_SIZE,
  OVERCLOCK, UNLOCKS, TERRAIN, FAST_TERRAIN, RICH_TERRAIN, CONFIG } from '../config.js';
import { makeRng, randInt, shuffle } from './rng.js';

export const COLS = 4, CELLS = 16, COL_NAMES = 'ABCD';
export const colOf = i => i % COLS;
export const rowOf = i => Math.floor(i / COLS);
export const cellName = i => COL_NAMES[colOf(i)] + (rowOf(i) + 1);
export function adj(i) {
  const r = rowOf(i), c = colOf(i), out = [];
  if (r > 0) out.push(i - COLS); if (r < 3) out.push(i + COLS);
  if (c > 0) out.push(i - 1); if (c < 3) out.push(i + 1);
  return out;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clone = o => JSON.parse(JSON.stringify(o));
export const DEPT_NAME = new Proxy({}, { get: (_, k) => DEPT_INFO[k] && DEPT_INFO[k].name });
import { THEME } from '../theme.js';
const W = THEME.words;
export const mname = t => MACHINES[t].name;
export const drawOf = m => { const d = MACHINES[m.type].draw; return d == null ? 0 : (Array.isArray(d) ? d[m.lvl - 1] : d); };
export const maxLevel = t => MACHINES[t].levels || 1;

// ---------- setup ----------
export function createGame({ seats = {}, seed = (Date.now() >>> 0), mode = 'first' } = {}) {
  const md = CONFIG.modes[mode] || CONFIG.modes.first;
  const rng = makeRng(seed);
  const rounds = CONFIG.rounds;
  const state = {
    v: 3, seed, rng, round: 1, phase: 'plan', mode, nextId: 1,
    rules: {
      rounds, haven: md.haven, stormStart: md.stormStart,
      speeds: CONFIG.stormSpeed.map(s => Math.round(s * md.stormScale)),
      strikes: CONFIG.strikes.map(s => Math.max(0, s + md.strikeAdj)),
    },
    city: 0, storm: md.stormStart, unlocked: { power: 1, fab: 1, loco: 1, shield: 1, research: 1 },
    depts: {}, forks: [], strikeOrder: [], shelfDeck: [], shelf: [], techs: [],
    last: null, history: [], outcome: null,
  };
  // The seeded future. Each part is revealed to one role ahead of time.
  for (let r = 0; r < rounds + 1; r++) {
    state.forks.push([FAST_TERRAIN[randInt(rng, FAST_TERRAIN.length)], RICH_TERRAIN[randInt(rng, RICH_TERRAIN.length)]]);
    const lanes = [];
    for (const d of DEPTS) for (let c = 0; c < COLS; c++) lanes.push({ dept: d, col: c });
    state.strikeOrder.push(shuffle(rng, lanes));
  }
  const t1 = shuffle(rng, Object.keys(TECHS).filter(t => TECHS[t].tier === 1));
  const t2 = shuffle(rng, Object.keys(TECHS).filter(t => TECHS[t].tier === 2));
  state.shelfDeck = t1.concat(t2);
  for (const d of DEPTS) {
    const dept = {
      id: d, seat: seats[d] || null, auto: false, ready: false,
      grid: Array(CELLS).fill(null),
      hold: { plates: CONFIG.startPlates, gears: 0, cores: 0, insight: d === 'research' ? CONFIG.startInsight : 0 },
      plan: null, stats: { builds: 0, moves: 0, shipped: 0, received: 0 },
    };
    for (const [type, cell, extra] of CONFIG.starts[d]) dept.grid[cell] = newMachine(state, type, extra);
    state.depts[d] = dept;
  }
  refillShelf(state);
  for (const d of DEPTS) state.depts[d].plan = normalizePlan(state, d, defaultPlan(state, d, null)).plan;
  return state;
}

export function newMachine(state, type, extra = {}) {
  const m = { id: state.nextId++, type, lvl: 1, jam: 0, idle: false };
  if (type === 'reactor' || type === 'turbine') { m.set = 0; m.hot = false; m.tripped = false; }
  if (type === 'capacitor') m.store = 0;
  if (type === 'engine') { m.heat = 0; m.throttle = 2; }
  if (type === 'projector') m.charged = true;
  if (type === 'module') m.online = true;
  return Object.assign(m, extra);
}

function refillShelf(state) {
  const unlocked = t => TECH_UNLOCK[TECHS[t].tier] <= state.round;
  while (state.shelf.length < SHELF_SIZE) {
    const i = state.shelfDeck.findIndex(unlocked);
    if (i < 0) break;
    state.shelf.push(state.shelfDeck.splice(i, 1)[0]);
  }
}

// ---------- techs, costs ----------
export function techActive(state, id) {
  return state.depts.research.grid.some(m => m && m.type === 'module' && m.tech === id && m.online && !m.jam);
}
const T = techActive;
export function buildCost(state, type) { return Math.max(1, MACHINES[type].cost - (T(state, 'prefab') ? 1 : 0)); }
export function levelCap(state, type) { return Math.min(maxLevel(type), (state.unlocked && state.unlocked[MACHINES[type].dept]) || 1); }
export function unlockCost(state, d) { const u = (state.unlocked && state.unlocked[d]) || 1; const c = UNLOCKS[d] && UNLOCKS[d][u - 1]; return c == null ? Infinity : c; }
export function upgradeCost(state, m) { return m.lvl >= levelCap(state, m.type) ? Infinity : Math.max(1, UPGRADE_COST[m.lvl] - (T(state, 'prefab') ? 1 : 0)); }
export function techCost(id) { return TECH_COST[TECHS[id].tier]; }
export function buildable(d) { return Object.keys(MACHINES).filter(t => MACHINES[t].dept === d && MACHINES[t].buildable !== false); }
export function freeMoves(state) { return T(state, 'rapidrefit') ? 3 : CONFIG.freeMoves; }

// ---------- plans ----------
// A plan is a draft until Ready. Moves are swaps applied in order; a machine idles only if its
// final cell differs from where it started, beyond the free moves.
export function defaultPlan(state, d, prev) {
  const dept = state.depts[d];
  const p = {
    build: null, next: null, moves: [], repairs: [], dials: {}, outbox: {}, order: [],
    recipe: { gears: 0, cores: 0 }, route: 0, sprint: false, covers: [], overclock: [], covReq: [], unlock: null,
  };
  dept.grid.forEach((m, i) => {
    if (!m) return;
    if (m.type === 'reactor' || m.type === 'turbine') p.dials[i] = m.set;
    if (m.type === 'engine') p.dials[i] = m.throttle;
  });
  if (prev) {
    p.outbox = clone(prev.outbox); p.order = prev.order.slice(); p.recipe = clone(prev.recipe); p.next = prev.next;
  } else if (d === 'power') {
    p.order = ['fab', 'loco', 'research', 'shield'];
    p.outbox = { fab: { power: 4 }, loco: { power: 4 }, research: { power: 3 }, shield: { power: 1 } };
  } else if (d === 'fab') {
    p.order = ['power', 'loco', 'shield', 'research', 'fab'];
    p.outbox = { power: { plates: 2 }, loco: { plates: 2 }, shield: { plates: 1 }, research: { plates: 1 } };
    p.recipe = { gears: 0, cores: 0 };
  }
  return p;
}

export function gridAfterMoves(grid, moves) {
  const g = grid.slice();
  for (const [a, b] of moves || []) { const t = g[a]; g[a] = g[b]; g[b] = t; }
  return g;
}
// ids of machines that end the plan somewhere else, and which of them idle
export function movedMachines(state, grid, moves) {
  const g = gridAfterMoves(grid, moves);
  const start = new Map();
  grid.forEach((m, i) => { if (m) start.set(m.id, i); });
  const moved = [];
  g.forEach((m, i) => { if (m && start.get(m.id) !== i) moved.push(m.id); });
  const free = freeMoves(state);
  return { moved, idle: new Set(moved.slice(free)), grid: g };
}

export const on = m => m && !m.jam && !m.idle && !m.tripped;
const ocLoco = state => false;

// Reactor: legal setpoints this round, as [lo, hi] plus "0 is always allowed".
export function reactorRange(state, grid, i) {
  const m = grid[i];
  const coolers = adj(i).filter(j => grid[j] && grid[j].type === 'cooler' && !grid[j].jam).length;
  const neighbours = adj(i).filter(j => grid[j] && grid[j].type === 'reactor').length;
  const max = Math.max(0, MACHINES.reactor.max[m.lvl - 1] - 2 * neighbours);
  const ramp = MACHINES.reactor.ramp[m.lvl - 1] + coolers + (T(state, 'fastramp') ? 2 : 0);
  const half = Math.ceil(MACHINES.reactor.max[m.lvl - 1] / 2);
  const cur = m.tripped ? 0 : m.set;
  const lo = cur >= half ? Math.max(half, cur - ramp) : Math.max(0, cur - ramp);
  return [Math.min(lo, max), clamp(cur + ramp, 0, max)];
}
export function clampReactor(state, grid, i, v) {
  const [lo, hi] = reactorRange(state, grid, i);
  if (v <= 0) return 0;
  return clamp(v, lo, hi);
}
export function turbineMax(grid, i) {
  const m = grid[i];
  const full = MACHINES.turbine.max[m.lvl - 1];
  return m.hot ? Math.floor(full / 2) : full;
}
export function heatCap(state) { return T(state, 'heatsinks') ? 6 : HEAT_CAP; }
export function radiatorCool(grid, i) {
  return adj(i).reduce((s, j) => s + (grid[j] && grid[j].type === 'radiator' && !grid[j].jam && !grid[j].idle ? MACHINES.radiator.cool[grid[j].lvl - 1] : 0), 0);
}
export function startHeat(state, grid, i, oc) {
  return Math.max(0, grid[i].heat - 1 - radiatorCool(grid, i) - (oc ? 2 : 0));
}
export function maxThrottle(state, grid, i, oc) {
  const h = startHeat(state, grid, i, oc), cap = heatCap(state);
  let t = 3; while (t > 0 && h + THROTTLE.heat[t] > cap) t--;
  return t;
}

// Power a department wants this round from its plan (its "draw").
export function planDraw(state, d, plan, g) {
  g = g || gridAfterMoves(state.depts[d].grid, plan.moves);
  let draw = 0;
  g.forEach((m, i) => {
    if (!m || m.jam) return;
    if (m.type === 'engine') draw += THROTTLE.draw[plan.dials[i] != null ? plan.dials[i] : m.throttle];
    else draw += drawOf(m);
  });
  if (plan.build && plan.build.type) draw += drawOf({ type: plan.build.type, lvl: 1 });
  if (plan.build && plan.build.tech) draw += 1;
  return draw;
}

// Asks are derived from the plan, never typed: power = draw; plates = next build's cost not yet covered;
// gears = engines at T3; cores = Analyzer capacity. Capped at what the department can use.
export function deriveAsks(state, d, plan, platesLeft) {
  const dept = state.depts[d];
  const g = gridAfterMoves(dept.grid, plan.moves);
  const asks = { power: 0, plates: 0, gears: 0, cores: 0 };
  if (d !== 'power') asks.power = Math.max(0, planDraw(state, d, plan, g) - CONFIG.auxPower);
  if (d !== 'fab' && plan.next) {
    let cost = 0;
    if (plan.next.upgrade != null && g[plan.next.upgrade]) cost = upgradeCost(state, g[plan.next.upgrade]);
    else if (plan.next.type) cost = buildCost(state, plan.next.type);
    if (cost < Infinity) asks.plates = Math.max(0, cost - platesLeft);
  }
  if (d === 'shield') {
    // Armory covers need plates this round too: count planned armory covers
  }
  if (d === 'loco') {
    let t3 = 0; g.forEach((m, i) => { if (m && m.type === 'engine' && !m.jam && plan.dials[i] === 3) t3++; });
    if (!T(state, 'geartrains')) asks.gears = Math.max(0, t3 - dept.hold.gears);
  }
  if (d === 'research') {
    const cap = g.reduce((s, m) => s + (m && m.type === 'analyzer' && !m.jam ? MACHINES.analyzer.out[m.lvl - 1] : 0), 0);
    asks.cores = Math.max(0, cap - dept.hold.cores);
  }
  return asks;
}

// Clean up a plan from a phone or bot. Drop anything illegal instead of rejecting the whole plan.
export function normalizePlan(state, d, raw) {
  const dept = state.depts[d];
  const p = Object.assign(defaultPlan(state, d, dept.plan), clone(raw || {}));
  const errors = [];
  let plates = dept.hold.plates, insight = dept.hold.insight;
  const moves = [];
  for (const mv of Array.isArray(p.moves) ? p.moves : []) {
    const [a, b] = mv || [];
    if (a === b || !(a >= 0 && a < CELLS && b >= 0 && b < CELLS)) continue;
    moves.push([a | 0, b | 0]);
  }
  p.moves = moves.slice(0, 16);
  const mv = movedMachines(state, dept.grid, p.moves);
  const g = mv.grid;
  // build: a machine, an upgrade, or (Research) a tech
  const b = p.build;
  if (b) {
    if (b.upgrade != null) {
      const m = g[b.upgrade];
      if (!m || m.lvl >= levelCap(state, m.type)) { errors.push(m && m.lvl < maxLevel(m.type) ? 'Research must unlock that level first' : 'Can\'t upgrade that'); p.build = null; }
      else if (upgradeCost(state, m) > plates) { errors.push('Not enough plates to upgrade'); p.build = null; }
      else { plates -= upgradeCost(state, m); p.build = { upgrade: b.upgrade | 0 }; }
    } else if (b.tech) {
      if (d !== 'research' || !state.shelf.includes(b.tech) || !(b.cell >= 0 && b.cell < CELLS) || g[b.cell]) { errors.push('Can\'t place that tech'); p.build = null; }
      else if (techCost(b.tech) > insight) { errors.push('Not enough insight'); p.build = null; }
      else { insight -= techCost(b.tech); p.build = { tech: b.tech, cell: b.cell | 0 }; }
    } else {
      const def = MACHINES[b.type];
      if (!def || def.dept !== d || def.buildable === false || !(b.cell >= 0 && b.cell < CELLS) || g[b.cell]) { errors.push('Can\'t build there'); p.build = null; }
      else if (buildCost(state, b.type) > plates) { errors.push('Not enough plates'); p.build = null; }
      else { plates -= buildCost(state, b.type); p.build = { type: b.type, cell: b.cell | 0 }; }
    }
  }
  // repairs
  const rep = [];
  for (const i of Array.isArray(p.repairs) ? p.repairs : []) {
    if (g[i] && g[i].jam && !rep.includes(i) && plates >= CONFIG.repairCost) { rep.push(i); plates -= CONFIG.repairCost; }
  }
  p.repairs = rep;
  // dials
  const dials = {};
  g.forEach((m, i) => {
    if (!m) return;
    let v = p.dials[i] != null ? p.dials[i] : p.dials[String(i)];
    if (m.type === 'reactor') dials[i] = clampReactor(state, g, i, v == null ? m.set : v | 0);
    if (m.type === 'turbine') dials[i] = clamp(v == null ? m.set : v | 0, 0, turbineMax(g, i));
    if (m.type === 'engine') dials[i] = clamp(v == null ? m.throttle : v | 0, 0, maxThrottle(state, g, i, ocLoco(state)));
  });
  if (p.build && p.build.type === 'engine') dials[p.build.cell] = clamp(p.dials[p.build.cell] != null ? p.dials[p.build.cell] | 0 : 2, 0, 3);
  if (p.build && p.build.type === 'turbine') dials[p.build.cell] = clamp(p.dials[p.build.cell] != null ? p.dials[p.build.cell] | 0 : 2, 0, MACHINES.turbine.max[0]);
  if (p.build && p.build.type === 'reactor') dials[p.build.cell] = clamp(p.dials[p.build.cell] != null ? p.dials[p.build.cell] | 0 : 2, 0, MACHINES.reactor.ramp[0]);
  p.dials = dials;
  // outbox (Power: power to each department; Fab: plates to each department, gears and cores to make)
  const order = [];
  for (const x of (Array.isArray(p.order) ? p.order : [])) if (DEPTS.includes(x) && !order.includes(x) && (x !== d || d === 'fab')) order.push(x);
  for (const x of DEPTS) if (!order.includes(x) && (x !== d || d === 'fab')) order.push(x);
  if (d === 'fab') { const i = order.indexOf('fab'); order.splice(i, 1); order.push('fab'); }
  const ob = {};
  if (d === 'power') for (const x of order) ob[x] = { power: clamp(((p.outbox[x] || {}).power) | 0, 0, 99) };
  if (d === 'fab') {
    for (const x of order) if (x !== 'fab') ob[x] = { plates: clamp(((p.outbox[x] || {}).plates) | 0, 0, 30) };
    p.recipe = { gears: clamp(p.recipe.gears | 0, 0, 12), cores: clamp(p.recipe.cores | 0, 0, 12) };
  } else p.recipe = { gears: 0, cores: 0 };
  p.order = (d === 'power' || d === 'fab') ? order.filter(x => x !== d) : [];
  p.outbox = ob;
  p.route = p.route === 1 ? 1 : 0;
  p.sprint = !!p.sprint && d === 'loco';
  // Shield covers
  if (d === 'shield') {
    const res = shieldCapacity(state, g, mv.idle);
    const covers = [], used = {};
    let armory = 0;
    for (const c of Array.isArray(p.covers) ? p.covers : []) {
      if (!c || !DEPTS.includes(c.dept) || !(c.col >= 0 && c.col < 4)) continue;
      if (covers.some(x => x.dept === c.dept && x.col === c.col)) continue;
      if (c.src === 'armory') {
        if (armory < res.armory && plates >= ARMORY_PLATES) { armory++; plates -= ARMORY_PLATES; covers.push({ dept: c.dept, col: c.col, src: 'armory' }); }
        continue;
      }
      if (c.src === 'oc') { if (res.oc > covers.filter(x => x.src === 'oc').length) covers.push({ dept: c.dept, col: c.col, src: 'oc' }); continue; }
      const pj = res.projectors.find(x => x.cell === c.src);
      if (!pj || (used[pj.cell] || 0) >= pj.covers || !pj.cols.includes(c.col)) continue;
      if (covers.some(x => x.src === pj.cell && x.dept === c.dept)) continue; // one department per cover
      used[pj.cell] = (used[pj.cell] || 0) + 1;
      covers.push({ dept: c.dept, col: c.col, src: pj.cell });
    }
    p.covers = covers;
  } else p.covers = [];
  // Research blueprint unlock
  if (d === 'research' && p.unlock && DEPTS.includes(p.unlock) && unlockCost(state, p.unlock) <= insight) insight -= unlockCost(state, p.unlock);
  else p.unlock = null;
  // Research overclocks
  if (d === 'research') {
    const cap = g.reduce((s, m) => s + (m && m.type === 'uplink' && !m.jam && !mv.idle.has(m.id) ? MACHINES.uplink.out[m.lvl - 1] : 0), 0);
    const oc = [];
    for (const x of Array.isArray(p.overclock) ? p.overclock : []) {
      if (OVERCLOCK[x] && !oc.includes(x) && oc.length < cap && insight >= OVERCLOCK.cost) { oc.push(x); insight -= OVERCLOCK.cost; }
    }
    p.overclock = oc;
  } else p.overclock = [];
  // next build (for the plate ask)
  if (p.next && !(p.next.type && MACHINES[p.next.type] && MACHINES[p.next.type].dept === d) && !(p.next.upgrade != null && g[p.next.upgrade])) p.next = null;
  p.covReq = (Array.isArray(p.covReq) ? p.covReq : []).filter((c, i, arr) => c >= 0 && c < 4 && arr.indexOf(c) === i);
  p.asks = deriveAsks(state, d, p, plates);
  return { plan: p, errors, left: { plates, insight } };
}

// Which covers Shield can give (projectors that are charged and not jammed or idle).
export function shieldCapacity(state, g, idleIds) {
  const ok = m => m && !m.jam && !(idleIds && idleIds.has(m.id)) && !m.idle;
  const wide = T(state, 'widebeam') ? 1 : 0;
  const projectors = [];
  g.forEach((m, i) => {
    if (!m || m.type !== 'projector' || !ok(m) || !m.charged) return;
    const cols = [colOf(i)];
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < CELLS && rowOf(j) === rowOf(i) && g[j] && g[j].type === 'projector' && !g[j].jam) cols.push(colOf(j));
    projectors.push({ cell: i, covers: MACHINES.projector.out[m.lvl - 1] + wide, cols });
  });
  const armory = g.reduce((s, m) => s + (ok(m) && m.type === 'armory' ? MACHINES.armory.out[m.lvl - 1] : 0), 0);
  const ocp = state.depts.research.plan && (state.depts.research.plan.overclock || []).includes('shield') ? 2 : 0;
  return { projectors, armory, oc: ocp };
}

// ---------- the storm ----------
export function terrainOf(state, round, route) { return state.forks[round - 1][route ? 1 : 0]; }
export function strikesFor(state, round) {
  const n = clamp(state.rules.strikes[round - 1] || 0, 0, 20);
  return state.strikeOrder[round - 1].slice(0, n);
}
export function stormSpeed(state, round) {
  const sp = state.rules.speeds;
  return round <= sp.length ? sp[round - 1] : sp[sp.length - 1] + 8 * (round - sp.length);
}
// A strike on an empty lane arcs to the nearest occupied column of that department (ties go left).
export function strikeTarget(grid, col) {
  const occ = c => [0, 1, 2, 3].some(r => grid[r * 4 + c]);
  if (occ(col)) return col;
  for (let k = 1; k < 4; k++) { if (col - k >= 0 && occ(col - k)) return col - k; if (col + k < 4 && occ(col + k)) return col + k; }
  return -1;
}

// ---------- actions ----------
// {type:'draft'|'ready', dept, plan} | {type:'unready', dept}
export function applyAction(state, a) {
  if (state.phase !== 'plan') return { error: 'Not planning now' };
  const dept = state.depts[a.dept];
  if (!dept) return { error: 'No such department' };
  if (a.type === 'draft' || a.type === 'ready') {
    const { plan, errors } = normalizePlan(state, a.dept, a.plan || dept.plan);
    dept.plan = plan;
    if (a.type === 'ready') dept.ready = true;
    return { errors };
  }
  if (a.type === 'unready') { dept.ready = false; return {}; }
  return { error: 'Unknown action' };
}
export const allReady = s => DEPTS.every(d => s.depts[d].ready);

// Power a department's machines, most important first (MACHINES[].pri), reading order within ties.
export function powerUp(grid, budget) {
  const list = [];
  grid.forEach((m, i) => { if (on(m) && drawOf(m) > 0) list.push({ i, m }); });
  list.sort((a, b) => (MACHINES[a.m.type].pri - MACHINES[b.m.type].pri) || a.i - b.i);
  const powered = new Set(), starved = [];
  grid.forEach((m, i) => { if (on(m) && drawOf(m) === 0) powered.add(i); });
  for (const { i, m } of list) { const need = drawOf(m); if (budget >= need) { budget -= need; powered.add(i); } else starved.push({ cell: i, type: m.type, need }); }
  return { powered, starved, left: budget };
}

// Fab's capacities this round for a given power budget.
export function fabCaps(state, grid, budget, ter = {}, oc = false) {
  const pu = powerUp(grid, budget);
  const pow = i => pu.powered.has(i);
  const mult = T(state, 'directfeed') ? 2 : 1;
  const nAdj = (i, type) => adj(i).filter(j => grid[j] && grid[j].type === type && pow(j)).length;
  let ore = 0, smelt = 0, press = 0, asm = 0;
  grid.forEach((m, i) => {
    if (!m || !pow(i)) return;
    if (m.type === 'drill') ore += MACHINES.drill.out[m.lvl - 1] + (ter.ore || 0);
    if (m.type === 'smelter') smelt += MACHINES.smelter.out[m.lvl - 1] + 2 * mult * nAdj(i, 'drill');
    if (m.type === 'press') press += MACHINES.press.out[m.lvl - 1] + mult * nAdj(i, 'smelter');
    if (m.type === 'assembler') asm += MACHINES.assembler.out[m.lvl - 1] + mult * nAdj(i, 'press');
  });
  if (oc) { ore += 4; if (smelt > 0) smelt += 2; }
  return { ore, smelt, press, asm, plates: Math.min(ore, smelt), pu };
}

// ---------- resolve ----------
export function resolveRound(state, opts = {}) {
  const r = state.round;
  const S = state.depts;
  const P = d => S[d].plan;
  for (const d of DEPTS) S[d].plan = normalizePlan(state, d, S[d].plan).plan; // re-validate against the current state
  const terrainId = terrainOf(state, r, P('loco').route);
  const ter = TERRAIN[terrainId];
  const caps = CONFIG.caps;
  const ev = { round: r, terrain: terrainId, builds: [], moves: [], repairs: [], techs: [], overclock: [], strikes: [], jammed: [],
    saves: [], power: {}, fab: {}, shield: {}, research: {}, loco: {}, waste: [], broken: [], trip: null };
  const before = { city: state.city, storm: state.storm };

  // 1. Plans take effect.
  for (const d of DEPTS) {
    const dept = S[d], p = dept.plan;
    const mv = movedMachines(state, dept.grid, p.moves);
    for (const id of mv.moved) {
      const m = mv.grid.find(x => x && x.id === id);
      ev.moves.push({ dept: d, type: m.type, to: mv.grid.indexOf(m), idle: mv.idle.has(id) });
      if (mv.idle.has(id)) m.idle = true;
      dept.stats.moves++;
    }
    dept.grid = mv.grid;
    const b = p.build;
    if (b && b.upgrade != null) {
      const m = dept.grid[b.upgrade];
      if (m && m.lvl < levelCap(state, m.type) && dept.hold.plates >= upgradeCost(state, m)) { dept.hold.plates -= upgradeCost(state, m); m.lvl++; ev.builds.push({ dept: d, cell: b.upgrade, type: m.type, lvl: m.lvl }); dept.stats.builds++; }
    } else if (b && b.tech) {
      if (state.shelf.includes(b.tech) && !dept.grid[b.cell] && dept.hold.insight >= techCost(b.tech)) {
        dept.hold.insight -= techCost(b.tech);
        dept.grid[b.cell] = newMachine(state, 'module', { tech: b.tech });
        state.shelf = state.shelf.filter(x => x !== b.tech); state.techs.push(b.tech);
        ev.techs.push({ tech: b.tech, cell: b.cell }); dept.stats.builds++;
      }
    } else if (b && b.type) {
      if (!dept.grid[b.cell] && dept.hold.plates >= buildCost(state, b.type)) {
        dept.hold.plates -= buildCost(state, b.type);
        const m = newMachine(state, b.type);
        if (m.type === 'engine') m.throttle = p.dials[b.cell] != null ? p.dials[b.cell] : 2;
        dept.grid[b.cell] = m;
        ev.builds.push({ dept: d, cell: b.cell, type: b.type, lvl: 1, fresh: true }); dept.stats.builds++;
      }
    }
    for (const i of p.repairs) { const m = dept.grid[i]; if (m && m.jam && dept.hold.plates >= CONFIG.repairCost) { dept.hold.plates -= CONFIG.repairCost; m.jam = 0; ev.repairs.push({ dept: d, cell: i, type: m.type }); } }
  }
  const oc = {};
  const unlock = P('research').unlock;
  if (unlock && unlockCost(state, unlock) <= S.research.hold.insight) { S.research.hold.insight -= unlockCost(state, unlock); ev.unlock = unlock; }
  {
    const rs = S.research;
    let cap = rs.grid.reduce((s, m) => s + (m && m.type === 'uplink' && !m.jam && !m.idle ? MACHINES.uplink.out[m.lvl - 1] : 0), 0);
    for (const x of P('research').overclock) if (cap > 0 && rs.hold.insight >= OVERCLOCK.cost) { cap--; rs.hold.insight -= OVERCLOCK.cost; oc[x] = true; ev.overclock.push(x); }
  }

  // 2. Strike. Covers block strikes; a strike on an empty lane arcs to the nearest occupied column.
  const lanes = opts.noStrikes ? [] : strikesFor(state, r);
  {
    const sh = S.shield;
    const capy = shieldCapacity(state, sh.grid, null);
    const used = {}; let armory = capy.armory, ocLeft = oc.shield ? 2 : 0;
    const covered = new Set();
    for (const c of P('shield').covers) {
      if (c.src === 'armory') { if (armory > 0 && sh.hold.plates >= ARMORY_PLATES) { armory--; sh.hold.plates -= ARMORY_PLATES; covered.add(c.dept + c.col); } continue; }
      if (c.src === 'oc') { if (ocLeft > 0) { ocLeft--; covered.add(c.dept + c.col); } continue; }
      const pj = capy.projectors.find(x => x.cell === c.src);
      if (!pj || (used[pj.cell] || 0) >= pj.covers || !pj.cols.includes(c.col)) continue;
      used[pj.cell] = (used[pj.cell] || 0) + 1; covered.add(c.dept + c.col);
    }
    for (const cell of Object.keys(used)) sh.grid[cell].charged = false;
    ev.shield.covers = [...covered];
    for (const l of lanes) {
      const g = S[l.dept].grid;
      const col = strikeTarget(g, l.col);
      const isCov = col >= 0 && covered.has(l.dept + col);
      const hit = [];
      if (col >= 0 && !isCov) for (let row = 0; row < 4; row++) {
        const i = row * 4 + col, m = g[i];
        if (m) { m.jam = Math.max(m.jam, CONFIG.jam); hit.push({ cell: i, type: m.type }); ev.jammed.push({ dept: l.dept, cell: i, type: m.type }); }
      }
      if (isCov) {
        const saved = [0, 1, 2, 3].map(row => g[row * 4 + col]).filter(m => m && !m.jam).map(m => m.type);
        if (saved.length) ev.saves.push({ dept: l.dept, col, saved });
      }
      ev.strikes.push({ dept: l.dept, col: l.col, at: col, covered: isCov, hit });
    }
  }

  // 3. Power generates and delivers in outbox order.
  const pw = S.power, pp = P('power');
  let gen = 0;
  const genBy = [];
  pw.grid.forEach((m, i) => {
    if (!m) return;
    if (m.type === 'reactor') {
      const set = clampReactor(state, pw.grid, i, pp.dials[i] != null ? pp.dials[i] : m.set);
      if (on(m)) { gen += set; m.set = set; genBy.push({ cell: i, type: m.type, out: set }); }
      else { if (m.tripped) m.set = 0; genBy.push({ cell: i, type: m.type, out: 0, why: m.jam ? 'jammed' : m.tripped ? 'tripped' : 'moved' }); }
    }
    if (m.type === 'turbine') {
      const max = turbineMax(pw.grid, i), full = MACHINES.turbine.max[m.lvl - 1];
      const set = clamp(pp.dials[i] != null ? pp.dials[i] : m.set, 0, max);
      const cooled = adj(i).some(j => pw.grid[j] && pw.grid[j].type === 'cooler' && on(pw.grid[j]));
      m.set = set;
      if (on(m)) { gen += set; genBy.push({ cell: i, type: m.type, out: set, hot: m.hot }); m.hot = !cooled && set > full / 2; }
      else { genBy.push({ cell: i, type: m.type, out: 0, why: m.jam ? 'jammed' : m.tripped ? 'tripped' : 'moved' }); m.hot = false; }
    }
  });
  if (ter.power) gen += ter.power;
  if (oc.power) gen += 5;
  const capList = pw.grid.filter(m => m && m.type === 'capacitor' && on(m));
  const capMax = m => MACHINES.capacitor.store[m.lvl - 1] + (T(state, 'deepcells') ? 3 : 0);
  let stored = capList.reduce((s, m) => s + m.store, 0);
  const storedStart = stored;
  const delivered = {}, pledged = {};
  let left = gen;
  for (const d of pp.order) {
    const want = (pp.outbox[d] && pp.outbox[d].power) || 0;
    pledged[d] = want;
    let give = Math.min(want, left); left -= give;
    if (give < want) { const t = Math.min(want - give, stored); stored -= t; give += t; }
    delivered[d] = give;
    if (give < want) ev.broken.push({ from: 'power', to: d, res: 'power', want, got: give });
  }
  { let use = storedStart - stored; for (const m of capList) { const t = Math.min(m.store, use); m.store -= t; use -= t; } }
  for (const d of ['fab', 'loco', 'shield', 'research']) delivered[d] = (delivered[d] || 0) + CONFIG.auxPower;
  ev.power = { gen, genBy, delivered, pledged, aux: CONFIG.auxPower, capUsed: storedStart - stored, vents: ter.power || 0, oc: !!oc.power };
  let returned = left;
  for (const d of ['fab', 'loco', 'shield', 'research']) S[d].stats.received += delivered[d] || 0;

  // 4. Fabrication: Drill > Smelter > Press > Assembler get power first.
  const fb = S.fab, fp = P('fab');
  {
    const fc = fabCaps(state, fb.grid, delivered.fab || 0, ter, oc.fab);
    const pu = fc.pu;
    const { ore, smelt, press, asm } = fc;
    const plates = Math.min(ore, smelt);
    const oreLost = ore - plates;
    if (oreLost > 0) ev.waste.push({ dept: 'fab', res: 'ore', n: oreLost });
    let pool = plates + fb.hold.plates;
    const gc = T(state, 'finepress') ? 1 : 2;
    const gearsMade = Math.min(fp.recipe.gears + fp.recipe.cores, press, Math.floor(pool / gc));
    pool -= gearsMade * gc;
    let gears = gearsMade;
    const coresMade = Math.min(fp.recipe.cores, asm, gears, pool);
    gears -= coresMade; pool -= coresMade;
    const shipped = {};
    for (const d of fp.order) {
      const want = (fp.outbox[d] && fp.outbox[d].plates) || 0; if (!want) continue;
      const give = Math.min(want, pool); pool -= give;
      shipped[d] = give;
      if (give < want) ev.broken.push({ from: 'fab', to: d, res: 'plates', want, got: give });
      if (give) addHold(S, d, 'plates', give, ev);
      fb.stats.shipped += give; S[d].stats.received += give;
    }
    if (gears) { addHold(S, 'loco', 'gears', gears, ev); fb.stats.shipped += gears; }
    if (coresMade) { addHold(S, 'research', 'cores', coresMade, ev); fb.stats.shipped += coresMade; }
    if (fp.recipe.gears > gears) ev.broken.push({ from: 'fab', to: 'loco', res: 'gears', want: fp.recipe.gears, got: gears });
    if (fp.recipe.cores > coresMade) ev.broken.push({ from: 'fab', to: 'research', res: 'cores', want: fp.recipe.cores, got: coresMade });
    fb.hold.plates = 0; addHold(S, 'fab', 'plates', pool, ev);
    ev.fab = { ore, smelt, press, asm, plates, oreLost, gearsMade, gears, coresMade, shipped, starved: pu.starved, powered: [...pu.powered], oc: !!oc.fab, oreField: ter.ore || 0, kept: fb.hold.plates };
    returned += pu.left;
  }
  if (ter.plates) for (const d of DEPTS) addHold(S, d, 'plates', ter.plates, ev);

  // 5a. Shield: powered Projectors recharge.
  {
    const sh = S.shield;
    const pu = powerUp(sh.grid, delivered.shield || 0);
    sh.grid.forEach((m, i) => { if (m && m.type === 'projector' && pu.powered.has(i)) m.charged = true; });
    sh.radarOn = sh.grid.some((m, i) => m && m.type === 'radar' && pu.powered.has(i));
    ev.shield.starved = pu.starved;
    ev.shield.charged = sh.grid.filter(m => m && m.type === 'projector' && m.charged).length;
    returned += pu.left;
  }
  // 5b. Research: Analyzer > Lab > Uplink > Module get power first.
  {
    const rs = S.research;
    const pu = powerUp(rs.grid, delivered.research || 0);
    const pow = i => pu.powered.has(i);
    let insight = 0, coresUsed = 0;
    rs.grid.forEach((m, i) => {
      if (!m || !pow(i)) return;
      if (m.type === 'lab') insight += MACHINES.lab.out[m.lvl - 1] + (adj(i).some(j => rs.grid[j] && rs.grid[j].type === 'analyzer' && pow(j)) ? 1 : 0);
      if (m.type === 'analyzer') { const n = Math.min(MACHINES.analyzer.out[m.lvl - 1], rs.hold.cores - coresUsed); coresUsed += n; insight += 4 * n; }
    });
    rs.hold.cores -= coresUsed;
    const offline = [];
    rs.grid.forEach((m, i) => {
      if (!m || m.type !== 'module') return;
      const was = m.online;
      m.online = pow(i) && adj(i).some(j => rs.grid[j] && rs.grid[j].type === 'uplink' && pow(j));
      if (was && !m.online) offline.push(m.tech);
    });
    const b4 = rs.hold.insight;
    rs.hold.insight = Math.min(caps.insight, rs.hold.insight + insight);
    if (b4 + insight > caps.insight) ev.waste.push({ dept: 'research', res: 'insight', n: b4 + insight - caps.insight });
    ev.research = { insight, coresUsed, offline, starved: pu.starved };
    returned += pu.left;
  }

  // 6. Locomotion. When power is short: Gearboxes switch off first, then the highest throttle steps down.
  const lo = S.loco, lp = P('loco');
  {
    const cap = heatCap(state);
    const engines = [];
    lo.grid.forEach((m, i) => {
      if (!m || m.type !== 'engine') return;
      const dial = lp.dials[i] != null ? lp.dials[i] : m.throttle;
      m.throttle = dial;
      const e = { cell: i, lvl: m.lvl, dial, t: 0, strides: 0, why: [], m };
      if (!on(m)) { e.why.push(m.jam ? 'jammed' : 'moved'); e.h0 = Math.max(0, m.heat - 1 - radiatorCool(lo.grid, i)); engines.push(e); return; }
      e.h0 = startHeat(state, lo.grid, i, false);
      let t = dial;
      while (t > 0 && e.h0 + THROTTLE.heat[t] > cap) { t--; if (!e.why.includes('heat')) e.why.push('heat'); }
      e.t = t; engines.push(e);
    });
    // gears for T3
    let gearsHave = lo.hold.gears;
    if (!T(state, 'geartrains')) for (const e of engines) if (e.t === 3) { if (gearsHave > 0) gearsHave--; else { e.t = 2; e.why.push('gear'); } }
    const gbs = [];
    lo.grid.forEach((m, i) => { if (m && m.type === 'gearbox' && on(m)) gbs.push(i); });
    let budget = delivered.loco || 0;
    const need = () => engines.reduce((s, e) => s + THROTTLE.draw[e.t], 0) + gbs.length;
    while (need() > budget) {
      if (gbs.length) { gbs.pop(); continue; }
      const top = engines.filter(e => e.t > 0).sort((a, b) => b.t - a.t || b.cell - a.cell)[0];
      if (!top) break;
      if (top.t === 3 && !T(state, 'geartrains')) gearsHave++;
      top.t--; if (!top.why.includes('power')) top.why.push('power');
    }
    budget -= need();
    lo.hold.gears = gearsHave;
    let strides = 0;
    for (const e of engines) {
      if (e.why[0] === 'jammed' || e.why[0] === 'moved') { e.m.heat = e.h0; }
      else { e.m.heat = e.h0 + THROTTLE.heat[e.t]; e.strides = MACHINES.engine.strides[e.lvl - 1][e.t]; }
      const n = adj(e.cell).filter(j => gbs.includes(j)).length;
      if (n && e.t >= 2) e.strides += n * (e.t === 3 ? 2 : 1);
      strides += e.strides;
      e.heat = e.m.heat; delete e.m;
    }
    returned += budget;
    const grade = ter.grade;
    const dist = Math.floor(strides * grade * (oc.loco ? 1.2 : 1));
    ev.loco = { engines, strides, grade, dist, gearboxes: gbs, oc: !!oc.loco };
  }

  // 7. Leftover power fills Capacitors. 3+ more trips the biggest generator for next round.
  {
    let ret = returned;
    for (const m of capList) { const t = Math.min(capMax(m) - m.store, ret); m.store += t; ret -= t; }
    ev.power.returned = returned; ev.power.surplus = ret;
    if (ret >= CONFIG.surgeAt) {
      let best = null, bi = -1;
      pw.grid.forEach((m, i) => { if (m && (m.type === 'turbine' || m.type === 'reactor') && on(m) && (!best || m.set > best.set)) { best = m; bi = i; } });
      if (best) { best.tripNext = true; ev.trip = { cell: bi, type: best.type, surplus: ret }; }
    }
    if (ret > 0) ev.waste.push({ dept: 'power', res: 'power', n: ret });
  }

  // 8. The city walks, the storm follows. Reaching the Haven is checked before being caught.
  const speed = stormSpeed(state, r);
  state.city += ev.loco.dist;
  state.storm += speed;
  ev.speed = speed;
  ev.blame = blameChain(state, ev);
  if (state.city >= state.rules.haven) state.outcome = { win: true, round: r, reason: 'haven' };
  else if (state.storm >= state.city) state.outcome = { win: false, round: r, reason: 'caught' };
  else if (r >= state.rules.rounds) state.outcome = { win: false, round: r, reason: 'timeout' };

  // 9. Upkeep: jams count down, trips take effect, everyone salvages a plate, blueprints arrive.
  if (ev.unlock) state.unlocked[ev.unlock]++;
  for (const d of DEPTS) {
    for (const m of S[d].grid) if (m) {
      m.idle = false;
      if (m.tripped) m.tripped = false;
      if (m.tripNext) { m.tripNext = false; m.tripped = true; if (m.type === 'reactor') m.set = 0; if (m.type === 'turbine') m.set = 0; }
      if (m.jam > 0) m.jam--;
    }
    addHold(S, d, 'plates', CONFIG.salvage, ev, true);
  }
  state.last = { round: r, ev, before, after: { city: state.city, storm: state.storm }, outcome: state.outcome };
  if (!opts.project) {
    state.history.push({ round: r, dist: ev.loco.dist, speed, city: state.city, storm: state.storm, terrain: terrainId });
    state.phase = state.outcome ? 'over' : 'watch';
  }
  return state.last;
}

function addHold(S, d, res, n, ev, quiet) {
  if (!n) return;
  const h = S[d].hold, cap = CONFIG.caps[res];
  const t = Math.min(Math.max(0, cap - h[res]), n);
  h[res] += t;
  if (n > t && !quiet) ev.waste.push({ dept: d, res, n: n - t, overflow: true });
}

// ---------- blame: one short chain for the biggest loss, ending at a machine or the storm ----------
export function blameChain(state, ev) {
  const chains = [];
  for (const e of ev.loco.engines) {
    const lost = MACHINES.engine.strides[e.lvl - 1][e.dial] - MACHINES.engine.strides[e.lvl - 1][e.t];
    if (lost <= 0) continue;
    const steps = [`${mname('engine')} ${cellName(e.cell)} ran T${e.t}, not T${e.dial}`];
    const why = e.why[0];
    if (why === 'jammed') {
      const s = ev.strikes.find(x => x.dept === 'loco' && x.at === colOf(e.cell) && !x.covered);
      steps.push(s ? `${W.lightning} hit ${DEPT_NAME.loco} column ${COL_NAMES[colOf(e.cell)]}` : `still jammed by ${W.lightning}`);
    } else if (why === 'moved') steps.push('it was moved, so it idled');
    else if (why === 'heat') steps.push('too hot to run harder');
    else if (why === 'gear') steps.push(...gearCause(state, ev));
    else if (why === 'power') steps.push(...powerCause(state, ev, 'loco'));
    chains.push({ lost, steps: steps.slice(0, 3), cause: why });
  }
  if (!chains.length) return null;
  chains.sort((a, b) => b.lost - a.lost);
  const total = chains.reduce((s, c) => s + c.lost, 0);
  return { lost: Math.floor(total * ev.loco.grade), steps: chains[0].steps, cause: chains[0].cause, more: chains.length - 1 };
}
function powerCause(state, ev, d) {
  const aux = d === 'power' ? 0 : (ev.power.aux || 0);
  const got = Math.max(0, (ev.power.delivered[d] || 0) - aux), pledge = ev.power.pledged[d] || 0, ask = state.depts[d].plan.asks.power;
  if (got >= pledge && pledge < ask) return [`${DEPT_NAME.power} pledged ${pledge} ${W.power} of ${ask} asked`];
  const off = ev.power.genBy.find(g => g.why);
  if (off) return [`${W.power} came up ${pledge - got} short`, `${mname(off.type)} ${cellName(off.cell)} ${off.why === 'jammed' ? 'was hit by ' + W.lightning : off.why}`];
  return [`${W.power} came up ${pledge - got} short`];
}
function gearCause(state, ev) {
  const asked = state.depts.loco.plan.asks.gears, made = state.depts.fab.plan.recipe.gears;
  if (made < asked) return [`no gear: ${DEPT_NAME.fab} planned ${made} of ${asked}`];
  if (ev.fab.starved.length) { const s = ev.fab.starved[0]; return ['no gear', `${mname(s.type)} ${cellName(s.cell)} had no ${W.power}`]; }
  return ['no gear', `${DEPT_NAME.fab} made ${ev.fab.gears} of ${made}`];
}

// ---------- next round ----------
export function nextRound(state) {
  if (state.phase !== 'watch') return;
  state.round++;
  state.phase = 'plan';
  refillShelf(state);
  for (const d of DEPTS) {
    const dept = state.depts[d];
    dept.plan = normalizePlan(state, d, defaultPlan(state, d, dept.plan)).plan;
    dept.ready = false;
  }
}

// What happens if every current plan holds. Public projections never include strikes.
export function project(state, { strikes = false } = {}) {
  const s = clone(state);
  return resolveRound(s, { project: true, noStrikes: !strikes });
}
