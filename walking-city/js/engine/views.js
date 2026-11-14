// What each screen is allowed to see. The TV gets publicView (never strike lanes before they land,
// never the next fork or the tech shelf). Each phone gets privateView for its own department.
import * as E from './engine.js';
import { DEPTS, DEPT_INFO, MACHINES, TECHS, TERRAIN, OVERCLOCK, CONFIG, THROTTLE, UNLOCKS } from '../config.js';

const pubMachine = m => m && {
  id: m.id, type: m.type, lvl: m.lvl, jam: m.jam, idle: m.idle, tripped: !!m.tripped,
  set: m.set, hot: m.hot, heat: m.heat, throttle: m.throttle, charged: m.charged, online: m.online, tech: m.tech, store: m.store,
};

export function publicView(state, opts = {}) {
  const r = state.round;
  const lp = state.depts.loco.plan;
  const depts = {};
  for (const d of DEPTS) {
    const x = state.depts[d];
    depts[d] = {
      id: d, name: DEPT_INFO[d].name, color: DEPT_INFO[d].color,
      seat: x.seat ? { name: x.seat.name } : null, auto: x.auto, ready: x.ready,
      grid: x.grid.map(pubMachine), hold: { ...x.hold },
      asks: { ...x.plan.asks }, outbox: E.clone(x.plan.outbox), order: x.plan.order.slice(),
      recipe: { ...x.plan.recipe }, next: x.plan.next, covReq: x.plan.covReq.slice(),
      unlocked: state.unlocked[d], stats: { ...x.stats },
      building: x.plan.build ? { ...x.plan.build } : null, moves: x.plan.moves.length,
    };
  }
  const v = {
    phase: state.phase, round: r, rounds: state.rules.rounds, mode: state.mode, modeName: CONFIG.modes[state.mode].name,
    city: state.city, storm: state.storm, haven: state.rules.haven, stormStart: state.rules.stormStart,
    speedNow: E.stormSpeed(state, r), speeds: state.rules.speeds.slice(),
    strikesNow: E.strikesFor(state, r).length,
    fork: state.forks[r - 1] ? state.forks[r - 1].slice() : null, route: lp.route, sprint: lp.sprint,
    depts, techs: state.techs.slice(), techsOnline: state.techs.filter(t => E.techActive(state, t)),
    overclock: state.depts.research.plan.overclock.slice(), unlock: state.depts.research.plan.unlock,
    last: state.last, history: state.history.slice(), outcome: state.outcome,
  };
  if (E.techActive(state, 'stormchart')) v.strikeLanes = E.strikesFor(state, r);
  if (state.phase === 'plan' && opts.projection !== false) v.projection = summarize(E.project(state));
  return v;
}

// A short, public summary of a projected round.
function summarize(L) {
  const ev = L.ev;
  return {
    dist: ev.loco.dist, strides: ev.loco.strides, grade: ev.loco.grade,
    gen: ev.power.gen, delivered: ev.power.delivered, surplus: ev.power.surplus, trip: !!ev.trip,
    plates: ev.fab.plates, ore: ev.fab.ore, gears: ev.fab.gears, cores: ev.fab.coresMade, shipped: ev.fab.shipped,
    insight: ev.research.insight, engines: ev.loco.engines.map(e => ({ cell: e.cell, t: e.t, dial: e.dial, why: e.why, strides: e.strides })),
    starved: { fab: ev.fab.starved, shield: ev.shield.starved, research: ev.research.starved },
    broken: ev.broken,
  };
}

export function privateView(state, d, opts = {}) {
  const v = publicView(state, opts);
  const dept = state.depts[d];
  const { plan, left } = E.normalizePlan(state, d, dept.plan);
  const mv = E.movedMachines(state, dept.grid, plan.moves);
  const g = mv.grid;
  const cells = g.map((m, i) => {
    if (!m) return null;
    const c = { idle: mv.idle.has(m.id), moved: mv.moved.includes(m.id) };
    if (m.type === 'reactor') c.range = E.reactorRange(state, g, i);
    if (m.type === 'turbine') c.range = [0, E.turbineMax(g, i)];
    if (m.type === 'engine') { c.maxT = E.maxThrottle(state, g, i, false); c.startHeat = E.startHeat(state, g, i, false); }
    c.upgradeCost = E.upgradeCost(state, m); if (c.upgradeCost === Infinity) c.upgradeCost = null;
    c.lockedUpgrade = m.lvl < E.maxLevel(m.type) && m.lvl >= E.levelCap(state, m.type);
    return c;
  });
  const me = {
    dept: d, plan, left, grid: g.map(pubMachine), cells, hold: { ...dept.hold }, ready: dept.ready,
    buildable: E.buildable(d).map(t => ({ type: t, cost: E.buildCost(state, t) })),
    heatCap: E.heatCap(state), freeMoves: E.freeMoves(state),
    // what others asked of me
    asksOfMe: {},
  };
  if (d === 'power') for (const x of ['fab', 'loco', 'shield', 'research']) me.asksOfMe[x] = { power: state.depts[x].plan.asks.power, sprint: x === 'loco' && state.depts.loco.plan.sprint };
  if (d === 'fab') {
    for (const x of ['power', 'loco', 'shield', 'research']) me.asksOfMe[x] = { plates: state.depts[x].plan.asks.plates, next: state.depts[x].plan.next };
    me.asksOfMe.loco.gears = state.depts.loco.plan.asks.gears;
    me.asksOfMe.research.cores = state.depts.research.plan.asks.cores;
    me.fabCaps = (() => { const fc = E.fabCaps(state, g, ((state.depts.power.plan.outbox.fab || {}).power || 0) + CONFIG.auxPower, TERRAIN[E.terrainOf(state, state.round, state.depts.loco.plan.route)], (state.depts.research.plan.overclock || []).includes('fab')); return { ore: fc.ore, smelt: fc.smelt, press: fc.press, asm: fc.asm, plates: fc.plates }; })();
  }
  me.pledgedToMe = {
    power: ((state.depts.power.plan.outbox[d] || {}).power || 0) + (d === 'power' ? 0 : CONFIG.auxPower),
    plates: (state.depts.fab.plan.outbox[d] || {}).plates || 0,
    gears: d === 'loco' ? state.depts.fab.plan.recipe.gears : 0,
    cores: d === 'research' ? state.depts.fab.plan.recipe.cores : 0,
  };
  me.aux = d === 'power' ? 0 : CONFIG.auxPower;
  // secrets
  if (d === 'shield') {
    const lanes = E.strikesFor(state, state.round).map(l => ({ ...l, at: E.strikeTarget(E.gridAfterMoves(state.depts[l.dept].grid, state.depts[l.dept].plan.moves), l.col) }));
    me.strikes = lanes;
    if (dept.radarOn || dept.grid.some(m => m && m.type === 'radar' && !m.jam)) me.strikesNext = state.round < state.rules.rounds ? E.strikesFor(state, state.round + 1) : [];
    me.capacity = (() => { const c = E.shieldCapacity(state, g, mv.idle); return c; })();
    me.lanes = {};
    for (const x of DEPTS) {
      const gg = E.gridAfterMoves(state.depts[x].grid, state.depts[x].plan.moves);
      me.lanes[x] = [0, 1, 2, 3].map(c => [0, 1, 2, 3].map(r => gg[r * 4 + c] ? gg[r * 4 + c].type : null));
    }
    me.covReqs = Object.fromEntries(DEPTS.map(x => [x, state.depts[x].plan.covReq.slice()]));
  }
  if (d === 'research') {
    me.shelf = state.shelf.map(t => ({ id: t, cost: E.techCost(t), tier: TECHS[t].tier }));
    me.nextFork = state.forks[state.round] && state.round < state.rules.rounds ? state.forks[state.round].slice() : null;
    me.unlocks = Object.fromEntries(DEPTS.map(x => [x, { level: state.unlocked[x], cost: E.unlockCost(state, x) === Infinity ? null : E.unlockCost(state, x), wants: !!(state.depts[x].plan.next && state.depts[x].plan.next.upgrade != null) }]));
    me.ocCap = g.reduce((s, m) => s + (m && m.type === 'uplink' && !m.jam && !mv.idle.has(m.id) ? MACHINES.uplink.out[m.lvl - 1] : 0), 0);
  }
  if (d === 'loco') {
    me.forkInfo = v.fork.map(t => ({ id: t, grade: TERRAIN[t].grade }));
  }
  v.me = me;
  return v;
}
