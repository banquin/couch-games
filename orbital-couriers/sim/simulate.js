// Balance simulator: plays many bot games and prints a report.
//   node sim/simulate.js            (default 300 games per player count)
//   node sim/simulate.js 1000
// It reads the same js/config.js the real game uses.
import { CONFIG } from '../js/config.js';
import { createGame, applyAction, checkInvariants, standings } from '../js/engine/engine.js';
import { botProgram, botShop, PERSONALITIES } from '../js/engine/bot.js';
import { makeRng, rand } from '../js/engine/rng.js';

export function playGame(n, seed, cfg = CONFIG, opts = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Bot' + i }));
  const s = createGame({ players, seed, cfg });
  const rng = makeRng(seed * 7 + 1);
  const pers = Object.keys(PERSONALITIES);
  const personality = {};
  players.forEach((p, i) => { personality[p.id] = opts.personalities ? opts.personalities[i] : pers[Math.floor(rand(rng) * pers.length)]; });
  const rounds = [];
  let resolveBeats = 0;
  let leaderAfter3 = null, lastAfter3 = null;
  const deadTurns = { count: 0, total: 0 };
  while (s.phase !== 'over') {
    if (s.phase === 'program') {
      const before = Object.fromEntries(s.players.map(p => [p.id, { pts: p.points, loads: p.stats.loads, x: p.x, y: p.y }]));
      for (const p of s.players) {
        const a = botProgram(s, p.id, { rng, noise: opts.noise ?? 6, randomRate: opts.randomRate ?? 0.05 });
        const r = applyAction(s, a);
        if (!r.ok) throw new Error('bot submit failed: ' + r.error);
      }
      // resolve happened
      checkInvariants(s);
      resolveBeats += s.beats.length;
      let deliveriesThisRound = 0;
      for (const p of s.players) {
        const b = before[p.id];
        const delivered = p.points > b.pts, loaded = p.stats.loads > b.loads;
        deadTurns.total++;
        if (!delivered && !loaded) deadTurns.count++;
        if (delivered) deliveriesThisRound++;
      }
      rounds.push({ deliveries: s.beats.reduce((k, bt) => k + bt.events.filter(e => e.t === 'deliver').length, 0),
        bumps: s.beats.reduce((k, bt) => k + bt.events.filter(e => e.t === 'bump').length, 0),
        events: s.beats.reduce((k, bt) => k + bt.events.length, 0) });
      if (s.round === 3) {
        const st = standings(s);
        leaderAfter3 = st[0].points > st[1].points ? st[0].id : null;
        lastAfter3 = st[st.length - 1].points < st[st.length - 2].points ? st[st.length - 1].id : null;
      }
      applyAction(s, { type: 'continue' });
    } else if (s.phase === 'shop') {
      for (const p of s.players) for (const a of botShop(s, p.id, personality[p.id])) applyAction(s, a);
    }
  }
  const st = standings(s);
  return { s, st, personality, rounds, resolveBeats, leaderAfter3, lastAfter3, deadTurns,
    tie: st[0].points === st[1].points };
}

export function runBatch(n, games, cfg = CONFIG, opts = {}) {
  const agg = {
    games, deliveriesPerPlayer: 0, zeroDelivery: 0, leaderWins: 0, leaderGames: 0, lastWins: 0, lastGames: 0,
    margin: [], ties: 0, dead: 0, deadTotal: 0, noDeliveryRounds: 0, laterRounds: 0, bumpsPerRound: 0,
    pulls: 0, slings: 0, moves: 0, blocked: 0, loads: 0, salvage: 0, points: [],
    pers: {}, cap: {}, seatWins: {}, upgradeSpend: { hold: 0, hand: 0, boost: 0 }, beats: 0, winnerPts: [],
  };
  for (let g = 0; g < games; g++) {
    const r = playGame(n, 1000 + g * 31 + n, cfg, opts);
    const { s, st } = r;
    for (const p of s.players) {
      agg.deliveriesPerPlayer += p.stats.deliveries / n;
      if (p.stats.deliveries === 0) agg.zeroDelivery++;
      agg.pulls += p.stats.pulls; agg.slings += p.stats.slingshots; agg.blocked += p.stats.blocked;
      agg.loads += p.stats.loads; agg.salvage += p.stats.salvage;
      for (const k of Object.keys(agg.upgradeSpend)) agg.upgradeSpend[k] += p.stats.spent[k];
      agg.points.push(p.points);
      const pe = r.personality[p.id];
      agg.pers[pe] = agg.pers[pe] || { n: 0, w: 0 }; agg.pers[pe].n++;
      agg.cap[p.captain] = agg.cap[p.captain] || { n: 0, w: 0 }; agg.cap[p.captain].n++;
      const ss = p.stats.startSpace; agg.seatWins[ss] = agg.seatWins[ss] || { n: 0, w: 0 }; agg.seatWins[ss].n++;
    }
    agg.moves += s.players.length * s.cfg.rounds * s.cfg.movesPerRound;
    const w = st[0];
    agg.winnerPts.push(w.points);
    agg.pers[r.personality[w.id]].w++;
    agg.cap[w.captain].w++;
    agg.seatWins[w.stats.startSpace].w++;
    agg.margin.push(st[0].points - st[1].points);
    if (r.tie) agg.ties++;
    if (r.leaderAfter3) { agg.leaderGames++; if (r.leaderAfter3 === w.id) agg.leaderWins++; }
    if (r.lastAfter3) { agg.lastGames++; if (r.lastAfter3 === w.id) agg.lastWins++; }
    agg.dead += r.deadTurns.count; agg.deadTotal += r.deadTurns.total;
    r.rounds.forEach((rd, i) => { agg.bumpsPerRound += rd.bumps / r.rounds.length; if (i >= 2) { agg.laterRounds++; if (!rd.deliveries) agg.noDeliveryRounds++; } });
    agg.beats += r.resolveBeats;
  }
  return agg;
}

function pct(a, b) { return b ? (100 * a / b).toFixed(1) + '%' : '-'; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

export function report(n, a, cfg = CONFIG) {
  const G = a.games;
  const lines = [];
  const fair = 1 / n;
  const secsPerRound = 100 + (a.beats / G / cfg.rounds) * (cfg.resolveStepMs / 1000 + 0.35) + 30;
  lines.push(`\n=== ${n} players, ${G} games ===`);
  lines.push(`Deliveries per player per game: ${(a.deliveriesPerPlayer / G).toFixed(2)}   (target 2.5-4.5)`);
  lines.push(`Players with zero deliveries:   ${pct(a.zeroDelivery, G * n)}   (target <3%)`);
  lines.push(`Rounds with no pickup or delivery: ${pct(a.dead, a.deadTotal)}   (lower is better; ~40-50% is normal travel)`);
  lines.push(`Rounds 3+ with no delivery:     ${pct(a.noDeliveryRounds, a.laterRounds)}   (target <25%)`);
  lines.push(`Leader after R3 wins:           ${pct(a.leaderWins, a.leaderGames)}   (target 45-65%, >75% = runaway)`);
  lines.push(`Last after R3 wins:             ${pct(a.lastWins, a.lastGames)}   (target >=5%)`);
  lines.push(`Median winning margin (pts):    ${median(a.margin)}   ties for 1st: ${pct(a.ties, G)}`);
  lines.push(`Median winner score:            ${median(a.winnerPts)}   median score: ${median(a.points)}`);
  lines.push(`Bumps per round:                ${(a.bumpsPerRound / G).toFixed(2)}   (target 0.5-2)`);
  lines.push(`Moves with a pull / slingshot:  ${pct(a.pulls, a.moves)} / ${pct(a.slings, a.moves)}   blocked: ${pct(a.blocked, a.moves)}`);
  lines.push(`Loads that became salvage:      ${pct(a.salvage, a.loads)}   (target 5-20%)`);
  lines.push(`Win rate vs fair share (1.00 = fair):`);
  lines.push('  shop style: ' + Object.entries(a.pers).map(([k, v]) => `${k} ${(v.w / v.n / fair).toFixed(2)}`).join('  '));
  lines.push('  captain:    ' + Object.entries(a.cap).map(([k, v]) => `${k} ${(v.w / v.n / fair).toFixed(2)}`).join('  '));
  const spend = a.upgradeSpend; const tot = spend.hold + spend.hand + spend.boost;
  lines.push(`Credits spent: hold ${pct(spend.hold, tot)}, hand ${pct(spend.hand, tot)}, afterburner ${pct(spend.boost, tot)}`);
  lines.push('Win rate by start space: ' + Object.entries(a.seatWins).sort().map(([k, v]) => `#${+k + 1} ${(v.w / v.n / fair).toFixed(2)}`).join('  '));
  lines.push(`Estimated time: ~${(secsPerRound / 60).toFixed(1)} min/round, ~${(secsPerRound * cfg.rounds / 60).toFixed(0)} min/game (assumes ~100s to program)`);
  return lines.join('\n');
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const games = Number(process.argv[2]) || 300;
  for (const n of [3, 4, 5]) console.log(report(n, runBatch(n, games)));
}
