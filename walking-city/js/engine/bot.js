// Practice bots (and autopilot for a player who stepped away).
// Greedy: try every card on every tile, run this round's production,
// and pick the best. Passes go where they help a neighbor most.
// Uses only public information plus the bot's own hand and crates.
import { CARDS } from '../config.js';
import { resolveProduction, disabledTiles, dockValue, neighbors } from './production.js';
import { currentStage, leftOf, rightOf, commitTarget, canBuildFrom } from './engine.js';
import { rand } from './rng.js';

// Score a city layout from one seat's point of view.
export function scoreLayout(state, districts, seat, extra = {}) {
  const disabled = disabledTiles(districts, state.stormType, state.round, state.cfg);
  const prod = resolveProduction(districts, { disabled, surge: extra.surge });
  let s = 10 * prod.strides;
  const stage = currentStage(state);
  if (stage) {
    // A finished stage pays its bonus every remaining round; share that value across the units it needs.
    const left = Math.max(1, state.cfg.maxRounds - state.round);
    const unit = 10 * (stage.bonus[state.N] || 1) * left / (stage.need * state.N);
    for (let d = 0; d < state.N; d++) {
      const room = Math.max(0, stage.need - state.core.progress[d]);
      s += (d === seat ? 1 : 0.6) * unit * Math.min(room, dockValue(prod.docks[d], stage.res));
    }
  }
  const activeSet = new Set(prod.active);
  s += 1.5 * prod.active.length;
  // Potential: a half-fed building is worth part of what it would make once fed.
  const unitDock = stage ? 10 * (stage.bonus[state.N] || 1) * Math.max(1, state.cfg.maxRounds - state.round) / (stage.need * state.N) : 0;
  for (const st of prod.starved) {
    const d = (st.k / 9) | 0, t = st.k % 9;
    const def = CARDS[districts[d][t].card];
    const needN = Object.values(def.needs).reduce((a, b) => a + b, 0);
    const missN = Object.values(st.missing).reduce((a, b) => a + b, 0);
    let worth = def.kind === 'engine' ? 10 * def.makes.stride : 4 * Object.values(def.makes).reduce((a, b) => a + b, 0);
    if (t < 3 && stage && def.makes.part && stage.res === 'part' && state.core.progress[d] < stage.need) worth += unitDock;
    s += (d === seat ? 0.35 : 0.2) * worth * (1 - missN / needN);
  }
  // Next round's Lightning threat on this seat's Power tiles.
  if (state.stormType === 'lightning' && state.round + 1 >= state.cfg.twistStartRound) {
    // Lightning will strike: count half of the strides we would lose then.
    const nr = state.round % 2 === 0 ? state.round + 1 : state.round + 2;
    if (nr <= state.cfg.maxRounds) {
      const p2 = resolveProduction(districts, { disabled: disabledTiles(districts, 'lightning', nr, state.cfg) });
      s -= 5 * Math.max(0, prod.strides - p2.strides);
    }
  }
  return { score: s, prod };
}

function withTile(districts, d, t, card) {
  const copy = districts.slice();
  copy[d] = districts[d].slice();
  copy[d][t] = card ? { card, passedBy: null } : null;
  return copy;
}

// Best way for `seat` to use `card` right now: {score, play}
export function bestUse(state, seat, card, base) {
  const D = state.districts;
  base = base ?? scoreLayout(state, D, seat).score;
  const def = CARDS[card];
  let best = { gain: -Infinity, play: null };
  if (def.kind === 'action') {
    if (card === 'overhaul') {
      for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) {
        if (!D[seat][a] && !D[seat][b]) continue;
        const copy = D.slice(); copy[seat] = D[seat].slice(); [copy[seat][a], copy[seat][b]] = [copy[seat][b], copy[seat][a]];
        const g = scoreLayout(state, copy, seat).score - base;
        if (g > best.gain) best = { gain: g, play: { mode: 'action', tile: a, tile2: b } };
      }
    } else if (card === 'surge') {
      for (let t = 0; t < 9; t++) if (D[seat][t]) {
        const g = scoreLayout(state, D, seat, { surge: new Set([seat * 9 + t]) }).score - base;
        if (g > best.gain) best = { gain: g, play: { mode: 'action', tile: t } };
      }
    }
  } else {
    for (let t = 0; t < 9; t++) {
      if (D[seat][t] && D[seat][t].card === card) continue;
      let g = scoreLayout(state, withTile(D, seat, t, card), seat).score - base;
      // Prefer empty tiles slightly; replacing has a hidden cost (lost flexibility).
      if (D[seat][t]) g -= 1;
      // Edge-column producers also feed neighbors: tiny nudge so bots learn the border game.
      if (g > best.gain) best = { gain: g, play: { mode: 'build', tile: t } };
    }
  }
  return best;
}

// Choose a whole plan. style: 'greedy' (default), 'selfish' (passes its worst cards), 'random'
export function botPlan(state, pid, { style = 'greedy', rng = null, noise = 0 } = {}) {
  const p = state.players.find(x => x.id === pid);
  const seat = p.seat;
  const hand = p.hand;
  if (!hand.length) return { type: 'submit', pid, plan: {} };
  const jitter = () => (rng && noise ? (rand(rng) - 0.5) * noise : 0);
  if (style === 'random' && rng) {
    const order = hand.slice().sort(() => rand(rng) - 0.5);
    const c = order[0], def = CARDS[c.card];
    const play = def.kind === 'action' ? { uid: c.uid, mode: 'scrap' } : { uid: c.uid, mode: 'build', tile: Math.floor(rand(rng) * 9) };
    return { type: 'submit', pid, plan: { play, left: order[1] && order[1].uid, right: order[2] && order[2].uid, reserve: order[3] ? order[3].uid : null, commit: null } };
  }
  const base = scoreLayout(state, state.districts, seat).score;
  const scrapValue = () => {
    const stage = currentStage(state);
    const crates = p.crates.supply + p.crates.part;
    let v = 2;
    if (stage && commitTarget(state, seat) >= 0 && crates === 0) v = 4;
    if (crates >= state.cfg.crateCap) v = 0;
    return v;
  };
  // 1) best play
  const uses = hand.map(c => ({ c, ...bestUse(state, seat, c.card, base) }));
  let pick = null;
  for (const u of uses) {
    if (CARDS[u.c.card].kind !== 'action' && !canBuildFrom(state, u.c)) continue;
    const g = u.gain + jitter();
    if (!pick || g > pick.g) pick = { g, uid: u.c.uid, play: u.play };
  }
  const sv = scrapValue();
  const dead = !pick || !pick.play || pick.g <= 0.5;   // nothing worth building at all
  if (!pick || !pick.play || pick.g <= sv) {
    // Scrap the card that is least useful for anyone.
    const worst = uses.slice().sort((a, b) => a.gain - b.gain)[0];
    pick = { uid: worst.c.uid, play: { mode: 'scrap' } };
  }
  const play = { uid: pick.uid, ...pick.play };
  // 2) passes
  const rest = hand.filter(c => c.uid !== play.uid);
  const L = leftOf(state, seat), R = rightOf(state, seat);
  const own = new Map(rest.map(c => [c.uid, bestUse(state, seat, c.card, base).gain]));
  let left = null, right = null;
  if (rest.length >= 2) {
    if (style === 'selfish') {
      const s = rest.slice().sort((a, b) => own.get(a.uid) - own.get(b.uid));
      left = s[0].uid; right = s[1].uid;
    } else {
      const bL = scoreLayout(state, state.districts, L).score, bR = scoreLayout(state, state.districts, R).score;
      const vL = new Map(rest.map(c => [c.uid, bestUse(state, L, c.card, bL).gain]));
      const vR = new Map(rest.map(c => [c.uid, bestUse(state, R, c.card, bR).gain]));
      let best = -Infinity;
      for (const a of rest) for (const b of rest) {
        if (a.uid === b.uid) continue;
        // keep the card I want most for myself out of the passes
        const v = style === 'hostile' ? -(vL.get(a.uid) + vR.get(b.uid)) : vL.get(a.uid) + vR.get(b.uid) - 0.15 * (own.get(a.uid) + own.get(b.uid)) + jitter();
        if (v > best) { best = v; left = a.uid; right = b.uid; }
      }
    }
  } else if (rest.length === 1) left = rest[0].uid;
  // 3) reserve: the best leftover for me next round, favouring higher tiers
  const left2 = rest.filter(c => c.uid !== left && c.uid !== right);
  let reserve = null;
  if (left2.length) {
    const r = left2.slice().sort((a, b) => (own.get(b.uid) + CARDS[b.card].tier) - (own.get(a.uid) + CARDS[a.card].tier))[0];
    reserve = r.uid;
  }
  // 4) commit a crate if it helps the Main Drive
  let commit = null;
  const stage = currentStage(state);
  if (stage && commitTarget(state, seat) >= 0) {
    if (stage.res === 'part') { if (p.crates.part > 0) commit = 'part'; }
    else if (p.crates.supply > 0) commit = 'supply';
    else if (p.crates.part > 0) commit = 'part';
    // Will this district's dock fill it anyway? Then keep the crate.
    const tgt = commitTarget(state, seat);
    if (commit) {
      const prod = resolveProduction(state.districts, { disabled: disabledTiles(state.districts, state.stormType, state.round, state.cfg) });
      if (dockValue(prod.docks[tgt], stage.res) >= stage.need - state.core.progress[tgt]) commit = null;
    }
  }
  return { type: 'submit', pid, plan: { play, left, right, reserve, commit }, dead };
}
