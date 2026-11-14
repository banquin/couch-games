// What the TV and each phone are allowed to see.
// Public: the whole city, the core, the storm, ready lights. Never hands or plans.
// Private: public + your own hand, crates, plan.
import { disabledTiles, lightningRound, sandColumn } from './production.js';
import { currentStage, commitTarget, leftOf, rightOf } from './engine.js';

export function publicView(state) {
  const cfg = state.cfg;
  const N = state.N;
  const speedNow = cfg.stormSpeed[N][Math.min(state.round, cfg.stormSpeed[N].length) - 1];
  const speedNext = cfg.stormSpeed[N][Math.min(state.round + 1, cfg.stormSpeed[N].length) - 1];
  return {
    phase: state.phase, round: state.round, maxRounds: cfg.maxRounds, N,
    players: state.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, color: p.color, ready: p.ready, auto: p.auto,
      crates: { ...p.crates }, stats: { ...p.stats } })),
    districts: state.districts.map(D => D.map(b => b && { card: b.card, passedBy: b.passedBy, built: b.built })),
    core: { stage: state.core.stage, progress: [...state.core.progress], stages: cfg.stages, current: currentStage(state) },
    bonus: state.bonus, city: state.city, storm: state.storm, haven: state.haven,
    giftOnly: !!cfg.giftOnly, generosityKind: cfg.generosityKind || 'supply', stormType: state.stormType, stormInfo: cfg.storms[state.stormType],
    speedNow, speedNext,
    // tiles the storm switches off THIS round (planning) — shown on TV and phones
    offNow: [...disabledTiles(state.districts, state.stormType, state.round, cfg)],
    twist: twistInfo(state),
    last: state.last, history: state.history, outcome: state.outcome,
    cfg: { twistStartRound: cfg.twistStartRound, tierUnlockRounds: cfg.tierUnlockRounds, handSize: cfg.handSize, crateCap: cfg.crateCap,
      stormStart: cfg.stormStart, maxRounds: cfg.maxRounds, stormSpeed: cfg.stormSpeed[N], scrapYield: cfg.scrapYield },
  };
}

export function twistInfo(state) {
  const cfg = state.cfg, r = state.round;
  if (state.stormType === 'lightning') {
    const now = lightningRound(r, cfg), next = lightningRound(r + 1, cfg);
    return { now, next, text: now ? 'Lightning this round! Power outside the top row is off.' : next ? 'Lightning next round: Power outside the top row (touching the core) shuts off, including your starting Dynamo.' : r < cfg.twistStartRound ? `Lightning starts in round ${cfg.twistStartRound + (cfg.twistStartRound % 2 ? 0 : 1)}.` : 'No lightning this round.' };
  }
  const col = sandColumn(r, cfg), nextCol = sandColumn(r + 1, cfg);
  const names = ['left', 'middle', 'right'];
  return { now: col >= 0, col, nextCol, text: col >= 0 ? `Sand buries the outer ${names[col]} tile in every district this round.` : `Sand arrives in round ${cfg.twistStartRound} (outer ${names[nextCol]} tile).` };
}

export function privateView(state, pid) {
  const v = publicView(state);
  const p = state.players.find(x => x.id === pid);
  if (!p) return v;
  const others = state.players.filter(x => x.id !== pid);
  v.me = {
    id: p.id, seat: p.seat, name: p.name, color: p.color,
    hand: p.hand.map(c => ({ uid: c.uid, card: c.card, from: c.from, passedBy: c.passedBy })),
    reserve: p.reserve && { card: p.reserve.card },
    crates: { ...p.crates }, plan: p.plan, ready: p.ready,
    left: leftOf(state, p.seat), right: rightOf(state, p.seat),
    commitTarget: commitTarget(state, p.seat),
    nudge: !p.ready && others.length > 0 && others.every(x => x.ready),
  };
  return v;
}
