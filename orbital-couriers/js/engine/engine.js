// =====================================================================
//  ORBITAL COURIERS — RULES ENGINE
//  Pure game logic: no screens, no networking. The TV calls
//  applyAction(state, action) and shows the result. The simulator
//  calls the same functions to play thousands of bot games.
// =====================================================================
import { CONFIG, CARDS } from '../config.js';
import { buildMap, isNextTo } from './map.js';
import { resolveMove } from './move.js';
import { makeRng, rand, randInt, shuffle } from './rng.js';

const mapCache = new Map();
export function getMap(state) {
  const key = state.mapKey;
  if (!mapCache.has(key)) mapCache.set(key, buildMap(state.cfg, state.players.length));
  return mapCache.get(key);
}

// players: [{ id, name }]  (3-5)
export function createGame({ players, seed = Date.now(), cfg = CONFIG, captains = null }) {
  if (players.length < 3 || players.length > 5) throw new Error('Orbital Couriers needs 3-5 players.');
  const rng = makeRng(seed);
  const state = {
    cfg: JSON.parse(JSON.stringify(cfg)), rng, round: 0, phase: 'program',
    mapKey: JSON.stringify(cfg.map) + '|' + players.length + '|' + JSON.stringify(cfg.planets),
    players: [], order: [], contracts: [], onDeck: null, nextCid: 1,
    beats: [], recap: [], history: [], winner: null, gameId: String(seed),
  };
  const map = getMap(state);
  const capPool = shuffle(rng, Object.keys(cfg.captains));
  const seats = shuffle(rng, players.map((_, i) => i));
  players.forEach((p, i) => {
    const captain = (captains && captains[i]) || capPool[i % capPool.length];
    const [x, y] = map.starts[seats[i]];
    const deck = [];
    let n = 0;
    for (const [type, count] of Object.entries(cfg.deck)) for (let c = 0; c < count; c++) deck.push({ id: 'c' + (n++), type });
    state.players.push({
      id: p.id, name: p.name, color: cfg.playerColors[i % cfg.playerColors.length], seat: i,
      captain, x, y, points: 0, credits: cfg.startingCredits,
      upgrades: { hold: 0, hand: 0, boost: 0, shield: 0 },
      hold: [], deck: shuffle(rng, deck), discard: [], hand: [],
      program: null, ready: false, shopDone: false, auto: false,
      stats: { deliveries: 0, loads: 0, bumpsGiven: 0, bumpsTaken: 0, pulls: 0, slingshots: 0, blocked: 0, salvage: 0, spent: { hold: 0, hand: 0, boost: 0, shield: 0 }, startSpace: seats[i] },
    });
  });
  state.onDeck = makeContract(state);
  while (available(state) < players.length + cfg.contractsOpen) refillOne(state, null);
  startRound(state);
  return state;
}

export function holdSize(state, p) {
  return state.cfg.startingHold + p.upgrades.hold + ((state.cfg.captains[p.captain] || {}).holdBonus || 0);
}
export function handSize(state, p) { return state.cfg.handSize + p.upgrades.hand; }
export function shieldCharges(p) { return p.upgrades.shield || 0; }
// Contracts nobody is carrying yet (the ones you can still pick up).
export function available(state) {
  return state.contracts.filter(c => state.cfg.sharedCargo || !isCarried(state, c.id)).length;
}

// Standings: leader first. Ties: more deliveries, then more credits left.
export function standings(state) {
  return [...state.players].sort((a, b) => (b.points - a.points) || (b.stats.deliveries - a.stats.deliveries)
    || (b.credits - a.credits));
}

function startRound(state) {
  state.round++;
  state.phase = 'program';
  // Turn order: last place moves first (ties: fewer credits first, then random).
  const r = state.rng;
  const jitter = Object.fromEntries(state.players.map(p => [p.id, rand(r)]));
  state.order = [...state.players].sort((a, b) => (a.points - b.points) || (a.credits - b.credits) || (jitter[a.id] - jitter[b.id])).map(p => p.id);
  for (const p of state.players) {
    p.program = null; p.ready = false; p.shopDone = false;
    draw(state, p, handSize(state, p));
  }
  state.recap = [];
}

function draw(state, p, n) {
  while (p.hand.length < n) {
    if (!p.deck.length) {
      if (!p.discard.length) break;
      p.deck = shuffle(state.rng, p.discard); p.discard = [];
    }
    p.hand.push(p.deck.pop());
  }
}

// ---------------- contracts ----------------
function makeContract(state, nearPlayer) {
  const map = getMap(state);
  const keys = Object.keys(map.planets);
  const r = state.rng;
  const openPairs = new Set(state.contracts.map(c => c.from + c.to));
  let from;
  if (nearPlayer) {
    // Catch-up: origin at the planet closest to the trailing player.
    const idx = nearPlayer.y * map.w + nearPlayer.x;
    from = keys.slice().sort((a, b) => map.dist[a][idx] - map.dist[b][idx])[0];
  } else {
    // Spread out: prefer planets that are the origin of the fewest open contracts.
    const count = k => state.contracts.filter(c => c.from === k).length + (state.onDeck && state.onDeck.from === k ? 1 : 0);
    const min = Math.min(...keys.map(count));
    const pool = keys.filter(k => count(k) === min);
    from = pool[randInt(r, pool.length)];
  }
  let options = keys.filter(k => k !== from && !openPairs.has(from + k));
  if (!options.length) options = keys.filter(k => k !== from);
  const to = options[randInt(r, options.length)];
  const a = map.planets[from], b = map.planets[to];
  const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const points = Math.max(state.cfg.minPoints, Math.ceil(d / state.cfg.pointsDivisor));
  const cargo = state.cfg.cargoTypes[randInt(r, state.cfg.cargoTypes.length)];
  return { id: 'k' + (state.nextCid++), cargo, from, to, points };
}

function refillOne(state, nearPlayer) {
  // Normally the on-deck contract (the one Broker can see) comes out and a new one goes on deck.
  // A catch-up contract is made fresh near the trailing player and leaves the on-deck one alone.
  if (nearPlayer) { const c = makeContract(state, nearPlayer); state.contracts.push(c); return c; }
  const c = state.onDeck;
  state.contracts.push(c);
  state.onDeck = makeContract(state);
  return c;
}

// ---------------- actions ----------------
// Every action: { type, pid, ... }. Returns { ok, error }.
export function applyAction(state, a) {
  try {
    const p = state.players.find(x => x.id === a.pid);
    if (a.type !== 'continue') need(p, 'Unknown player.');
    switch (a.type) {
      case 'submit': return submit(state, p, a);
      case 'unready': need(state.phase === 'program', 'Not programming now.'); p.ready = false; p.program = null; return ok();
      case 'dump': return dump(state, p, a.cid);
      case 'buy': return buy(state, p, a.upgrade);
      case 'shopDone': need(state.phase === 'shop', 'Shop is closed.'); p.shopDone = true; maybeEndShop(state); return ok();
      case 'unshop': need(state.phase === 'shop', 'Shop is closed.'); p.shopDone = false; return ok();
      case 'continue': return cont(state);
      default: return { ok: false, error: 'Unknown action ' + a.type };
    }
  } catch (e) {
    if (e.rule) return { ok: false, error: e.message };
    throw e;
  }
}
function ok() { return { ok: true }; }
function need(cond, msg) { if (!cond) { const e = new Error(msg); e.rule = true; throw e; } }

function submit(state, p, a) {
  need(p, 'Unknown player.');
  need(state.phase === 'program', 'Not programming now.');
  const slots = a.slots || [];
  need(slots.length === state.cfg.movesPerRound, `Program exactly ${state.cfg.movesPerRound} moves.`);
  const used = new Set();
  let shields = 0;
  const program = slots.map(s => {
    need(s && typeof s === 'object', 'Bad move.');
    const card = p.hand.find(c => c.id === s.cardId);
    need(card, 'That card is not in your hand.');
    need(!used.has(card.id), 'Each card can be used once.');
    used.add(card.id);
    const def = CARDS[card.type];
    if (def.dir) need(['N', 'E', 'S', 'W'].includes(s.dir), `Pick a direction for ${def.label}.`);
    if (s.shield) shields++;
    return { cardId: card.id, type: card.type, dir: def.dir ? s.dir : null, shield: !!s.shield };
  });
  need(shields === 0 || shieldCharges(p) > 0, 'You have no gravity shield.');
  p.program = program;
  p.ready = true;
  if (state.players.every(x => x.ready)) resolveRound(state);
  return ok();
}

function dump(state, p, cid) {
  need(state.phase === 'program' || state.phase === 'shop', 'You can only dump cargo between flights.');
  const i = p.hold.findIndex(h => h.cid === cid);
  need(i >= 0, 'You are not carrying that.');
  p.hold.splice(i, 1);
  return ok();
}

export function upgradeCost(state, p, key) {
  if (!Object.prototype.hasOwnProperty.call(state.cfg.upgrades, key)) return null;
  const u = state.cfg.upgrades[key];
  const lvl = p.upgrades[key];
  if (lvl >= u.cost.length) return null;
  const capt = state.cfg.captains[p.captain] || {};
  const discount = capt.discount && capt.discount[key] ? capt.discount[key] : 0;
  return Math.max(0, u.cost[lvl] - discount);
}

function buy(state, p, key) {
  need(state.phase === 'shop', 'The shop is closed.');
  const cost = upgradeCost(state, p, key);
  need(cost != null, 'That upgrade is maxed out.');
  need(p.credits >= cost, 'Not enough credits.');
  p.credits -= cost; p.upgrades[key]++; p.stats.spent[key] += cost;
  if (key === 'boost') {
    // Afterburner: one of your Burn 1 cards becomes a Burn 3 (or you gain a Burn 3 if you have none).
    const weak = [...p.deck, ...p.discard].find(c => c.type === 'burn1');
    if (weak) weak.type = 'burn3';
    else p.deck.splice(randInt(state.rng, p.deck.length + 1), 0, { id: 'c' + (100 + p.upgrades.boost), type: 'burn3' });
  }
  state.recap.push({ t: 'buy', id: p.id, upgrade: key, level: p.upgrades[key] });
  return ok();
}

function cont(state) {
  need(state.phase === 'resolve', 'Nothing to continue.');
  if (state.round >= state.cfg.rounds) { endGame(state); return ok(); }
  state.phase = 'shop';
  // Contracts nobody picked up get more valuable (up to a cap).
  for (const c of state.contracts) {
    if (!state.cfg.sharedCargo && isCarried(state, c.id)) continue;
    if ((c.bonus || 0) < (state.cfg.ageCap || 0)) { c.bonus = (c.bonus || 0) + 1; c.points += 1; }
  }
  // New contracts fill the board. The first one is a catch-up contract near last place.
  const target = state.players.length + state.cfg.contractsOpen;
  const jit = Object.fromEntries(state.players.map(p => [p.id, rand(state.rng)]));
  const last = [...state.players].sort((a, b) => (a.points - b.points) || (a.credits - b.credits) || (jit[a.id] - jit[b.id]))[0];
  let first = true;
  state.refilled = [];
  while (available(state) < target) {
    state.refilled.push(refillOne(state, first ? last : null).id);
    first = false;
  }
  return ok();
}

function maybeEndShop(state) {
  if (state.players.every(p => p.shopDone)) startRound(state);
}

function endGame(state) {
  state.phase = 'over';
  // Leftover credits convert to points at the end.
  const per = state.cfg.creditsPerEndPoint;
  if (per) for (const p of state.players) {
    const bonus = Math.floor(p.credits / per);
    p.endBonus = bonus; p.points += bonus; p.credits -= bonus * per;
  }
  const s = standings(state);
  state.winner = s[0].id;
  state.final = s.map(p => ({ id: p.id, points: p.points, credits: p.credits }));
}

// ---------------- resolution ----------------
function resolveRound(state) {
  const map = getMap(state);
  // Snapshot of the board before the flight, so screens can replay it without spoiling the result.
  state.pre = {
    contracts: JSON.parse(JSON.stringify(state.contracts)),
    players: Object.fromEntries(state.players.map(p => [p.id, { x: p.x, y: p.y, points: p.points, credits: p.credits, hold: JSON.parse(JSON.stringify(p.hold)) }])),
  };
  const ships = state.players; // players double as ships (id, x, y, captain)
  const byId = Object.fromEntries(ships.map(p => [p.id, p]));
  const ctx = { cfg: state.cfg, map, shieldsLeft: Object.fromEntries(ships.map(p => [p.id, shieldCharges(p)])), firstMove: false };
  const beats = [];
  for (let step = 0; step < state.cfg.movesPerRound; step++) {
    ctx.firstMove = step === 0;
    for (const pid of state.order) {
      const p = byId[pid];
      const slot = p.program[step];
      const events = resolveMove(ctx, ships, p, slot);
      for (const e of events) countStat(byId, e);
      events.push(...settle(state, map));
      beats.push({ step, id: pid, type: slot.type, dir: slot.dir, events,
        pos: Object.fromEntries(ships.map(s => [s.id, [s.x, s.y]])),
        score: Object.fromEntries(ships.map(s => [s.id, [s.points, s.credits]])) });
    }
  }
  for (const p of state.players) {
    p.discard.push(...p.hand); p.hand = []; p.program = null; p.ready = false;
  }
  state.beats = beats;
  state.phase = 'resolve';
  state.history.push({ round: state.round, beats: beats.length,
    deliveries: beats.reduce((n, b) => n + b.events.filter(e => e.t === 'deliver').length, 0) });
}

function countStat(byId, e) {
  const s = byId[e.id] && byId[e.id].stats;
  if (!s) return;
  if (e.t === 'bump') { s.bumpsGiven++; byId[e.victim].stats.bumpsTaken++; }
  if (e.t === 'pull') s.pulls++;
  if (e.t === 'slingshot') s.slingshots++;
  if (e.t === 'blocked') s.blocked++;
}

// After every move: deliveries, then salvage sales, then loading — for every ship, in turn order.
function settle(state, map) {
  const ev = [];
  for (const pid of state.order) {
    const p = state.players.find(x => x.id === pid);
    // Deliver
    for (const h of [...p.hold]) {
      if (h.salvage || !isNextTo(map, h.to, p.x, p.y)) continue;
      const ci = state.contracts.findIndex(c => c.id === h.cid);
      if (ci < 0) { h.salvage = true; continue; }
      const c = state.contracts[ci];
      state.contracts.splice(ci, 1);
      p.hold.splice(p.hold.indexOf(h), 1);
      const credits = c.points * state.cfg.creditsPerPoint + (p.captain === 'broker' ? 1 : 0);
      p.points += c.points; p.credits += credits; p.stats.deliveries++;
      ev.push({ t: 'deliver', id: p.id, cid: c.id, cargo: c.cargo, from: c.from, to: c.to, points: c.points, credits });
      for (const o of state.players) {
        if (o === p) continue;
        for (const oh of o.hold) if (oh.cid === c.id && !oh.salvage) { oh.salvage = true; ev.push({ t: 'salvaged', id: o.id, cid: c.id, cargo: c.cargo, by: p.id }); }
      }
    }
    // Salvage: sell rival-delivered cargo at any planet
    const nearAny = Object.keys(map.planets).some(k => isNextTo(map, k, p.x, p.y));
    if (nearAny) {
      const junk = p.hold.filter(h => h.salvage);
      if (junk.length) {
        p.hold = p.hold.filter(h => !h.salvage);
        const cr = junk.length * state.cfg.salvageCredits;
        p.credits += cr; p.stats.salvage += junk.length;
        ev.push({ t: 'sell', id: p.id, n: junk.length, credits: cr });
      }
    }
    // Load: any open contract whose origin you're next to, highest points first, while you have room.
    const here = state.contracts
      .filter(c => isNextTo(map, c.from, p.x, p.y) && !p.hold.some(h => h.cid === c.id)
        && (state.cfg.sharedCargo || !isCarried(state, c.id)))
      .sort((a, b) => b.points - a.points);
    for (const c of here) {
      if (p.hold.length >= holdSize(state, p)) break;
      p.hold.push({ cid: c.id, cargo: c.cargo, from: c.from, to: c.to, points: c.points, salvage: false });
      p.stats.loads++;
      ev.push({ t: 'load', id: p.id, cid: c.id, cargo: c.cargo, from: c.from, to: c.to });
    }
  }
  return ev;
}

export function isCarried(state, cid) {
  return state.players.some(p => p.hold.some(h => h.cid === cid && !h.salvage));
}

export function checkInvariants(state) {
  const map = getMap(state);
  const seen = new Set();
  for (const p of state.players) {
    const k = p.x + ',' + p.y;
    if (seen.has(k)) throw new Error('Two ships share ' + k);
    seen.add(k);
    const c = map.cells[p.y][p.x].kind;
    if (c === 'planet' || c === 'closed') throw new Error(p.id + ' is inside ' + c);
    if (p.hold.length > holdSize(state, p)) throw new Error(p.id + ' over hold');
  }
}
