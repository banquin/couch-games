// Simple-but-not-stupid bot players. Used by the balance simulator, and by the
// TV's "autopilot" button when a player has to step away mid-game.
import { CARDS } from '../config.js';
import { getMap, holdSize, shieldCharges, upgradeCost, isCarried } from './engine.js';
import { isNextTo } from './map.js';
import { resolveMove } from './move.js';
import { rand } from './rng.js';

const DIR_KEYS = ['N', 'E', 'S', 'W'];

export const PERSONALITIES = {
  hold:     ['hold', 'hand', 'boost'],
  hand:     ['hand', 'hold', 'boost'],
  boost:    ['boost', 'hand', 'hold'],
  balanced: 'cheapest',
  never:    [],
};

function planetGap(map, from, to) {
  // shortest distance from a space next to `from` to a space next to `to`
  let best = 99;
  for (const [x, y] of map.adj[from]) best = Math.min(best, map.dist[to][y * map.w + x]);
  return best;
}

export function chooseMarks(state, p) {
  const map = getMap(state);
  const free = holdSize(state, p) - p.hold.length;
  if (free <= 0) return [];
  const idx = p.y * map.w + p.x;
  const scored = state.contracts
    .filter(c => !p.hold.some(h => h.cid === c.id) && (state.cfg.sharedCargo || !isCarried(state, c.id)))
    .map(c => {
      const d1 = map.dist[c.from][idx];
      const d2 = planetGap(map, c.from, c.to);
      let s = c.points / (d1 + d2 + 2);
      // A rival with room who is closer to the pickup will probably grab it first.
      const myTurn = state.order.indexOf(p.id);
      for (const o of state.players) {
        if (o === p || o.hold.length >= holdSize(state, o)) continue;
        const od = map.dist[c.from][o.y * map.w + o.x];
        if (od < d1 || (od === d1 && state.order.indexOf(o.id) < myTurn)) { s *= 0.3; break; }
      }
      return { c, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, free).map(x => x.c.id);
}

function evaluate(state, map, sim, p) {
  // sim: { x, y, hold, marks, pts, cr, loads }
  const idx = sim.y * map.w + sim.x;
  let objective = 0;
  const ds = [];
  for (const h of sim.hold) if (!h.salvage) ds.push(map.dist[h.to][idx] * (6 / (h.points + 2)));
  const space = holdSize(state, p) - sim.hold.length;
  if (space > 0) for (const c of sim.marks) ds.push(map.dist[c.from][idx] * 1.2);
  if (sim.hold.some(h => h.salvage)) {
    ds.push(Math.min(...Object.keys(map.planets).map(k => map.dist[k][idx])) * 2);
  }
  ds.sort((a, b) => a - b);
  if (ds.length) objective = ds[0] + 0.25 * ds.slice(1).reduce((a, b) => a + b, 0);
  return sim.pts * 12 + sim.cr * 2 + sim.loads * 5 - objective * 1.5;
}

function settleSolo(state, map, sim, p) {
  for (const h of [...sim.hold]) {
    if (!h.salvage && isNextTo(map, h.to, sim.x, sim.y)) {
      sim.pts += h.points; sim.cr += h.points; sim.hold = sim.hold.filter(x => x !== h);
    }
  }
  if (sim.hold.some(h => h.salvage) && Object.keys(map.planets).some(k => isNextTo(map, k, sim.x, sim.y))) {
    sim.cr += sim.hold.filter(h => h.salvage).length; sim.hold = sim.hold.filter(h => !h.salvage);
  }
  const here = state.contracts.filter(c => !sim.taken.has(c.id) && (state.cfg.sharedCargo || !isCarried(state, c.id)) && isNextTo(map, c.from, sim.x, sim.y)).sort((a, b) => b.points - a.points);
  for (const c of here) {
    if (sim.hold.length >= holdSize(state, p)) break;
    sim.hold = [...sim.hold, { to: c.to, points: c.points, salvage: false }];
    sim.taken = new Set(sim.taken).add(c.id);
    sim.marks = sim.marks.filter(m => m !== c); sim.loads += c.points / 3;
  }
}

// Returns a 'submit' action for this player.
export function botProgram(state, pid, opts = {}) {
  const map = getMap(state);
  const p = state.players.find(x => x.id === pid);
  const marks = chooseMarks(state, p);
  const markObjs = marks.map(id => state.contracts.find(c => c.id === id));
  const n = state.cfg.movesPerRound;
  const charges = shieldCharges(p);
  const shieldOpts = charges > 0 ? [false, true] : [false];
  let best = null, bestScore = -Infinity;
  const all = [];
  const rng = opts.rng;

  for (const useShield of shieldOpts) {
    const rec = (depth, used, sim, ship, shieldsLeft, slots) => {
      if (depth === n) {
        let score = evaluate(state, map, sim, p);
        if (rng && opts.noise) score += (rand(rng) - 0.5) * opts.noise;
        all.push(slots);
        if (score > bestScore) { bestScore = score; best = slots; }
        return;
      }
      const triedTypes = new Set();
      for (const card of p.hand) {
        if (used.has(card.id) || triedTypes.has(card.type)) continue;
        triedTypes.add(card.type);
        const dirs = CARDS[card.type].dir ? DIR_KEYS : [null];
        for (const dir of dirs) {
          const me = { id: p.id, x: ship.x, y: ship.y, captain: p.captain };
          const ctx = { cfg: state.cfg, map, shieldsLeft: { [p.id]: shieldsLeft }, firstMove: depth === 0 };
          const slot = { type: card.type, dir, shield: useShield };
          resolveMove(ctx, [me], me, slot);
          const s2 = { ...sim, x: me.x, y: me.y };
          settleSolo(state, map, s2, p);
          const u2 = new Set(used); u2.add(card.id);
          rec(depth + 1, u2, s2, me, ctx.shieldsLeft[p.id], [...slots, { cardId: card.id, dir, shield: useShield }]);
        }
      }
    };
    rec(0, new Set(), { x: p.x, y: p.y, hold: p.hold.map(h => ({ ...h })), marks: markObjs, taken: new Set(p.hold.map(h => h.cid)), pts: 0, cr: 0, loads: 0 },
      { x: p.x, y: p.y }, charges, []);
  }
  if (rng && opts.randomRate && rand(rng) < opts.randomRate) best = all[Math.floor(rand(rng) * all.length)];
  return { type: 'submit', pid, slots: best };
}

export function botShop(state, pid, personality = 'balanced') {
  const p = state.players.find(x => x.id === pid);
  const acts = [];
  let credits = p.credits;
  const lv = { ...p.upgrades };
  const costOf = k => { if (!state.cfg.upgrades[k]) return null; const c = state.cfg.upgrades[k].cost; if (lv[k] >= c.length) return null; const d = (state.cfg.captains[p.captain] || {}).discount; return Math.max(0, c[lv[k]] - ((d && d[k]) || 0)); };
  const pri = PERSONALITIES[personality];
  for (let guard = 0; guard < 10; guard++) {
    let pick = null;
    if (pri === 'cheapest') {
      const ks = Object.keys(state.cfg.upgrades).filter(k => costOf(k) != null && costOf(k) <= credits).sort((a, b) => costOf(a) - costOf(b));
      pick = ks[0];
    } else {
      // Buy the first upgrade in priority order that is affordable; save for it if not.
      const want = pri.find(k => lv[k] != null && state.cfg.upgrades[k] && costOf(k) != null);
      if (want && costOf(want) <= credits) pick = want;
    }
    if (!pick) break;
    credits -= costOf(pick); lv[pick]++;
    acts.push({ type: 'buy', pid, upgrade: pick });
  }
  acts.push({ type: 'shopDone', pid });
  return acts;
}
