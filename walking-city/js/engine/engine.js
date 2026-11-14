// =====================================================================
//  THE WALKING CITY — RULES ENGINE
//  Pure game logic: no screens, no networking, no timers.
//  The TV calls applyAction(state, action) and shows the result.
//  The simulator calls the same functions to play bot games.
// =====================================================================
import { CONFIG, CARDS } from '../config.js';
import { makeRng, shuffle } from './rng.js';
import { resolveProduction, disabledTiles, dockValue } from './production.js';

// players: [{ id, name }] (3-5). storm: 'lightning' | 'sandstorm'
export function createGame({ players, seed = Date.now(), cfg = CONFIG, storm = 'lightning', mode = 'first' }) {
  cfg = JSON.parse(JSON.stringify(cfg));
  const m = (cfg.modes || {})[mode];
  if (m) {
    cfg.stormStart = m.stormStart;
  }
  // Each storm type has its own pace (Lightning's twist hurts more, so it walks a little slower).
  const scale = (m ? m.stormScale : 1) * ((cfg.storms[storm] || {}).speedScale || 1);
  for (const k of Object.keys(cfg.stormSpeed)) cfg.stormSpeed[k] = cfg.stormSpeed[k].map(x => Math.max(1, Math.round(x * scale)));
  const N = players.length;
  if (N < cfg.minPlayers || N > cfg.maxPlayers) throw new Error(`The Walking City needs ${cfg.minPlayers}-${cfg.maxPlayers} players.`);
  const rng = makeRng(seed);
  let uid = 1;
  const tiers = {};
  for (const t of Object.keys(cfg.deck)) {
    tiers[t] = [];
    for (const [card, n] of Object.entries(cfg.deck[t])) for (let i = 0; i < n; i++) tiers[t].push({ uid: 'k' + uid++, card, passedBy: null });
  }
  const state = {
    cfg, seed, rng, N, round: 0, phase: 'plan', stormType: storm, mode: m ? mode : 'standard',
    players: players.map((p, i) => ({
      id: p.id, name: p.name, seat: i, color: cfg.playerColors[i % cfg.playerColors.length],
      hand: [], reserve: null, incoming: [], crates: { supply: 0, part: 0 }, pendingGen: 0,
      plan: null, ready: false, auto: false,
      stats: { builds: 0, scraps: 0, actions: 0, commits: 0, generosity: 0, passedBuilt: 0, deadTurns: 0 },
    })),
    districts: Array.from({ length: N }, () => Array(9).fill(null)),
    deck: { draw: [], discard: [], locked: tiers },
    core: { stage: 0, progress: Array(N).fill(0) },
    bonus: 0,                         // permanent strides per round from finished Main Drive stages
    city: 0, storm: cfg.stormStart, haven: cfg.havenPerPlayer * N,
    outcome: null,                    // 'won' | 'caught' | 'timeout'
    last: null,                       // the most recent round's results (drives the TV replay)
    history: [],
  };
  for (const st of cfg.starters || []) for (let d = 0; d < N; d++) state.districts[d][st.tile] = { uid: 'start' + d + '-' + st.tile, card: st.card, passedBy: null, built: 0 };
  startRound(state);
  return state;
}

function draw(state) {
  const dk = state.deck;
  if (!dk.draw.length) { dk.draw = shuffle(state.rng, dk.discard); dk.discard = []; }
  return dk.draw.pop() || null;
}

export function startRound(state) {
  state.round++;
  const cfg = state.cfg;
  for (const [t, r] of Object.entries(cfg.tierUnlockRounds)) {
    if (r === state.round && state.deck.locked[t]) {
      state.deck.draw = shuffle(state.rng, [...state.deck.draw, ...state.deck.locked[t], ...state.deck.discard]);
      state.deck.discard = [];
      delete state.deck.locked[t];
    }
  }
  for (const p of state.players) {
    if (p.pendingGen) { addCrate(state, p, cfg.generosityKind || 'supply', p.pendingGen); p.stats.generosity += p.pendingGen; p.pendingGen = 0; }
    p.hand = [...p.incoming.map(c => ({ ...c, from: c.from })), ...(p.reserve ? [{ ...p.reserve, from: 'reserve' }] : [])];
    p.incoming = []; p.reserve = null;
    while (p.hand.length < cfg.handSize) { const c = draw(state); if (!c) break; p.hand.push({ ...c, passedBy: null, from: 'deck' }); }
    p.plan = null; p.ready = false;
  }
  state.phase = 'plan';
}

function addCrate(state, p, kind, n = 1) {
  const cap = state.cfg.crateCap;
  for (let i = 0; i < n; i++) {
    if (p.crates.supply + p.crates.part < cap) p.crates[kind]++;
    else if (kind === 'part' && p.crates.supply > 0) { p.crates.supply--; p.crates.part++; }   // a Part bumps a Supply
    // otherwise the hold is full and the crate is lost (the phone warns when you're full)
  }
}

export const leftOf = (state, seat) => (seat - 1 + state.N) % state.N;
export const rightOf = (state, seat) => (seat + 1) % state.N;
export function currentStage(state) { return state.cfg.stages[state.core.stage] || null; }

// ---------------------------------------------------------------------
// Plans. plan = { play:{uid, mode:'build'|'scrap'|'action', tile, tile2}, left:uid, right:uid, reserve:uid|null, commit:'supply'|'part'|null }
export function validatePlan(state, seat, plan) {
  const p = state.players[seat];
  if (!plan || typeof plan !== 'object') return 'No plan.';
  const ids = new Set(p.hand.map(c => c.uid));
  const used = [];
  const card = uid => p.hand.find(c => c.uid === uid);
  if (p.hand.length) {
    if (!plan.play || !ids.has(plan.play.uid)) return 'Pick a card to play.';
    used.push(plan.play.uid);
    const def = CARDS[card(plan.play.uid).card];
    const m = plan.play.mode;
    if (m === 'build') {
      if (def.kind === 'action') return `${def.name} is an action. Play it, don't build it.`;
      if (!(plan.play.tile >= 0 && plan.play.tile < 9)) return 'Pick a tile to build on.';
      if (!canBuildFrom(state, card(plan.play.uid))) return 'You can only build cards your neighbours passed you, or the card you kept.';
    } else if (m === 'action') {
      if (def.kind !== 'action') return 'That card is a building.';
      if (card(plan.play.uid).card === 'overhaul') {
        const a = plan.play.tile, b = plan.play.tile2;
        if (!(a >= 0 && a < 9 && b >= 0 && b < 9 && a !== b)) return 'Pick two tiles to swap.';
        if (!state.districts[seat][a] && !state.districts[seat][b]) return 'Swap at least one building.';
      } else if (!(plan.play.tile >= 0 && plan.play.tile < 9) || !state.districts[seat][plan.play.tile]) return 'Pick one of your buildings to surge.';
    } else if (m !== 'scrap') return 'Build, scrap or play the card.';
  }
  const needPass = Math.min(2, p.hand.length - 1);
  for (const side of ['left', 'right'].slice(0, needPass)) {
    if (!plan[side] || !ids.has(plan[side])) return `Choose a card to pass ${side}.`;
    used.push(plan[side]);
  }
  if (plan.reserve) { if (!ids.has(plan.reserve)) return 'Bad reserve card.'; used.push(plan.reserve); }
  if (new Set(used).size !== used.length) return 'Each card can only go one place.';
  if (plan.commit) {
    const stage = currentStage(state);
    if (!stage) return 'The Main Drive is already finished.';
    if (!(p.crates[plan.commit] > 0)) return `You have no ${plan.commit} crate.`;
    if (stage.res === 'part' && plan.commit !== 'part') return 'This stage needs a Part crate.';
    if (commitTarget(state, seat) < 0) return 'Every district has already filled this stage.';
  }
  return null;
}

// Gift-only building: after round 1 you build only cards passed to you or the one you kept.
export function canBuildFrom(state, c) {
  if (!state.cfg.giftOnly || state.round <= 1) return true;
  return c.from === 'left' || c.from === 'right' || c.from === 'reserve';
}

// Which district a commit lands in: yours, or the next unfilled one clockwise.
export function commitTarget(state, seat) {
  const stage = currentStage(state);
  if (!stage) return -1;
  for (let i = 0; i < state.N; i++) {
    const d = (seat + i) % state.N;
    if (state.core.progress[d] < stage.need) return d;
  }
  return -1;
}

// ---------------------------------------------------------------------
export function applyAction(state, a) {
  const p = state.players.find(x => x.id === a.pid);
  switch (a.type) {
    case 'submit': {
      if (state.phase !== 'plan') return { ok: false, error: 'Not planning right now.' };
      if (!p) return { ok: false, error: 'Unknown player.' };
      const err = validatePlan(state, p.seat, a.plan);
      if (err) return { ok: false, error: err };
      p.plan = a.plan; p.ready = true;
      if (state.players.every(x => x.ready)) resolveRound(state);
      return { ok: true };
    }
    case 'unready': {
      if (state.phase !== 'plan' || !p) return { ok: false, error: 'Too late to change.' };
      p.ready = false; p.plan = null;
      return { ok: true };
    }
    case 'continue': {
      if (state.phase !== 'watch') return { ok: false, error: 'Nothing to continue.' };
      if (state.outcome) state.phase = 'over';
      else startRound(state);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Unknown action.' };
}

// ---------------------------------------------------------------------
export function resolveRound(state) {
  const cfg = state.cfg, N = state.N, round = state.round;
  const ev = [];   // structured events; recap text is made from these in the UI
  const surge = new Set();
  const builtThisRound = [];
  const before = { city: state.city, storm: state.storm, stage: state.core.stage };

  // 1) Plays, passes, reserves, commits.
  for (const p of state.players) {
    const plan = p.plan || {};
    const take = uid => { const i = p.hand.findIndex(c => c.uid === uid); return i < 0 ? null : p.hand.splice(i, 1)[0]; };
    if (plan.play) {
      const c = take(plan.play.uid);
      if (c) {
        const def = CARDS[c.card];
        if (plan.play.mode === 'build') {
          const old = state.districts[p.seat][plan.play.tile];
          if (old && !String(old.uid).startsWith('start')) state.deck.discard.push({ uid: old.uid, card: old.card, passedBy: null });
          state.districts[p.seat][plan.play.tile] = { uid: c.uid, card: c.card, passedBy: c.passedBy, built: round };
          p.stats.builds++;
          builtThisRound.push(p.seat * 9 + plan.play.tile);
          ev.push({ t: 'build', seat: p.seat, tile: plan.play.tile, card: c.card, replaced: old ? old.card : null, from: c.passedBy });
          if (c.passedBy != null && c.passedBy !== p.seat) {
            state.players[c.passedBy].pendingGen += cfg.generosityYield;
            state.players[c.passedBy].stats.passedBuilt++;
            ev.push({ t: 'generous', seat: c.passedBy, to: p.seat, card: c.card });
          }
        } else if (plan.play.mode === 'action') {
          p.stats.actions++;
          if (c.card === 'overhaul') {
            const D = state.districts[p.seat], a = plan.play.tile, b = plan.play.tile2;
            [D[a], D[b]] = [D[b], D[a]];
            ev.push({ t: 'overhaul', seat: p.seat, a, b });
          } else if (c.card === 'surge') {
            surge.add(p.seat * 9 + plan.play.tile);
            ev.push({ t: 'surge', seat: p.seat, tile: plan.play.tile });
          }
          state.deck.discard.push({ uid: c.uid, card: c.card, passedBy: null });
        } else {
          const kind = cfg.scrapYield[def.tier] || 'supply';
          addCrate(state, p, kind);
          p.stats.scraps++;
          ev.push({ t: 'scrap', seat: p.seat, card: c.card, crate: kind });
          state.deck.discard.push({ uid: c.uid, card: c.card, passedBy: null });
        }
      }
    }
    const L = take(plan.left), R = take(plan.right);
    if (L) state.players[leftOf(state, p.seat)].incoming.push({ uid: L.uid, card: L.card, passedBy: p.seat, from: 'right' });
    if (R) state.players[rightOf(state, p.seat)].incoming.push({ uid: R.uid, card: R.card, passedBy: p.seat, from: 'left' });
    if (L || R) ev.push({ t: 'pass', seat: p.seat, left: L && L.card, right: R && R.card });
    const res = plan.reserve ? take(plan.reserve) : null;
    if (res) p.reserve = { uid: res.uid, card: res.card, passedBy: res.passedBy };
    for (const c of p.hand) state.deck.discard.push({ uid: c.uid, card: c.card, passedBy: null });
    p.hand = [];
  }
  // Commits: the crate leaves your hold now; it lands after docking (so it never fills a slot your own dock already filled).
  const stage = currentStage(state);
  const pending = [];
  for (const p of state.players) {
    const kind = p.plan && p.plan.commit;
    if (!kind || !stage || !(p.crates[kind] > 0)) continue;
    if (stage.res === 'part' && kind !== 'part') continue;
    p.crates[kind]--;
    pending.push({ p, kind });
  }

  // 2) Storm twist. 3) Production with emergency feed from crates.
  const disabled = disabledTiles(state.districts, state.stormType, round, cfg);
  // Part crates only feed a starving engine once that player's Main Drive slot is filled (Parts are precious).
  const partOk = state.players.map(p => !stage || state.core.progress[p.seat] >= stage.need);
  const prod = resolveProduction(state.districts, { disabled, surge, crates: state.players.map(p => p.crates), partOk });
  state.players.forEach((p, i) => { p.crates = prod.crates[i]; });
  for (const f of prod.fed) ev.push({ t: 'fed', seat: f.d, tile: f.k % 9, used: f.used });

  // 4) Docks feed the Main Drive.
  let stageDone = null;
  if (stage) {
    for (let d = 0; d < N; d++) {
      const add = dockValue(prod.docks[d], stage.res);
      const room = stage.need - state.core.progress[d];
      if (add > 0 && room > 0) { state.core.progress[d] += Math.min(add, room); ev.push({ t: 'dock', seat: d, n: Math.min(add, room) }); }
    }
    for (const { p, kind } of pending) {
      const d = commitTarget(state, p.seat);
      if (d < 0) { addCrate(state, p, kind); continue; }   // nowhere to put it: refund
      p.stats.commits++;
      state.core.progress[d]++;
      ev.push({ t: 'commit', seat: p.seat, to: d, crate: kind });
    }
    if (state.core.progress.every(x => x >= stage.need)) {
      stageDone = state.core.stage;
      state.core.stage++;
      state.core.progress = Array(N).fill(0);
    }
  }

  // 5) The city walks. 6) Win check. 7) Storm. 8) Round cap.
  const bonusUsed = state.bonus;
  const walked = prod.strides + bonusUsed;
  state.city += walked;
  if (stageDone != null) {
    const add = stage.bonus[N] || stage.bonus[4];
    state.bonus += add;
    ev.push({ t: 'stage', stage: stageDone + 1, add });
  }
  const speed = cfg.stormSpeed[N][Math.min(round, cfg.stormSpeed[N].length) - 1];
  if (state.city >= state.haven) state.outcome = 'won';
  else {
    state.storm += speed;
    if (state.storm >= state.city) state.outcome = 'caught';
    else if (round >= cfg.maxRounds) state.outcome = 'timeout';
  }

  for (const s of prod.starved) ev.push({ t: 'starved', seat: (s.k / 9) | 0, tile: s.k % 9, card: state.districts[(s.k / 9) | 0][s.k % 9].card, missing: s.missing });

  state.last = {
    round, events: ev, prod: { wave: prod.wave, waves: prod.waves, flows: prod.flows, active: prod.active, off: prod.off,
      starved: prod.starved, fed: prod.fed.map(f => f.k), strides: prod.strides, stridesBy: prod.stridesBy },
    surge: [...surge], built: builtThisRound, before, walked, engineStrides: prod.strides, bonusUsed, speed,
    city: state.city, storm: state.storm, stageDone, outcome: state.outcome,
  };
  state.history.push({ round, city: state.city, storm: state.storm, walked, engine: prod.strides, bonus: bonusUsed, stage: state.core.stage,
    starved: prod.starved.length, active: prod.active.length });
  state.phase = 'watch';
}

export function isOver(state) { return state.phase === 'over' || (state.phase === 'watch' && !!state.outcome); }
