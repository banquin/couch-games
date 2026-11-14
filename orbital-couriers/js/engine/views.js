// What leaves the engine. The TV gets publicView; each phone gets only its own privateView.
// Hidden information (hands, programs, marks) never appears in another player's view.
import { getMap, holdSize, handSize, shieldCharges, upgradeCost, standings } from './engine.js';

export function publicView(state) {
  return {
    cfg: state.cfg, n: state.players.length,
    round: state.round, rounds: state.cfg.rounds, phase: state.phase, order: state.order,
    players: state.players.map(p => ({
      id: p.id, name: p.name, color: p.color, captain: p.captain, x: p.x, y: p.y,
      points: p.points, credits: p.credits, upgrades: p.upgrades, holdSize: holdSize(state, p),
      hold: p.hold.map(h => ({ cid: h.cid, cargo: h.cargo, to: h.to, salvage: h.salvage })),
      ready: p.ready, shopDone: p.shopDone, auto: p.auto, deliveries: p.stats.deliveries, endBonus: p.endBonus || 0,
    })),
    contracts: state.contracts, refilled: state.refilled || [],
    beats: state.phase === 'resolve' ? state.beats : [],
    pre: state.phase === 'resolve' ? state.pre : null, gameId: state.gameId,
    recap: state.recap, winner: state.winner, final: state.final || null,
    standings: standings(state).map(p => p.id),
  };
}

export function privateView(state, pid) {
  const p = state.players.find(x => x.id === pid);
  if (!p) return null;
  const pub = publicView(state);
  return {
    ...pub,
    me: {
      id: p.id, hand: p.hand, program: p.program, ready: p.ready,
      handSize: handSize(state, p), shields: shieldCharges(p),
      costs: Object.fromEntries(Object.keys(state.cfg.upgrades).map(k => [k, upgradeCost(state, p, k)])),
      onDeck: p.captain === 'broker' ? state.onDeck : null,
    },
  };
}
