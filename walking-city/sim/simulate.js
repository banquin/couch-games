// Bot games at 3, 4 and 5 players, with the numbers that matter for tuning.
// Run:  node walking-city/sim/simulate.js [games=200] [style=greedy] [storm=lightning|sandstorm|both]
import { CONFIG, CARDS } from '../js/config.js';
import { createGame, applyAction } from '../js/engine/engine.js';
import { botPlan } from '../js/engine/bot.js';
import { makeRng } from '../js/engine/rng.js';

const GAMES = Number(process.argv[2]) || 200;
const STYLE = process.argv[3] || 'greedy';
const STORM = process.argv[4] || 'both';
// Try config changes without editing config.js:  OV='{"havenPerPlayer":14}' node sim/simulate.js
const OV = JSON.parse(process.env.OV || '{}');
const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else a[k] = b[k]; } };
merge(CONFIG, OV);

const MODE = process.env.MODE || 'standard';
export function playGame(N, seed, { style = STYLE, storm = 'lightning', cfg = CONFIG, mode = MODE } = {}) {
  const g = createGame({ players: Array.from({ length: N }, (_, i) => ({ id: 'b' + i, name: 'Bot' + i })), seed, storm, cfg, mode });
  const rng = makeRng(seed * 7 + 1);
  const m = { dead: 0, plays: 0, passes: 0, passBuilt: 0, scraps: 0, commits: 0, fed: 0, starved: 0, starvedCross: 0, margins: [], stageRound: [], builtByCard: {}, scrapByCard: {}, emptyEnd: 0, replaced: 0, twistOff: 0 };
  while (g.phase !== 'over') {
    if (g.phase === 'plan') {
      for (const p of g.players) {
        const a = botPlan(g, p.id, { style, rng, noise: 2 });
        if (a.dead) m.dead++;
        m.plays++;
        const r = applyAction(g, { type: 'submit', pid: p.id, plan: a.plan });
        if (!r.ok) throw new Error('bot plan rejected: ' + r.error);
      }
    } else if (g.phase === 'watch') {
      const L = g.last;
      for (const e of L.events) {
        if (e.t === 'pass') m.passes += (e.left ? 1 : 0) + (e.right ? 1 : 0);
        if (e.t === 'generous') m.passBuilt++;
        if (e.t === 'scrap') { m.scraps++; m.scrapByCard[e.card] = (m.scrapByCard[e.card] || 0) + 1; }
        if (e.t === 'build') { m.builtByCard[e.card] = (m.builtByCard[e.card] || 0) + 1; if (e.replaced) m.replaced++; }
        if (e.t === 'commit') m.commits++;
        if (e.t === 'fed') m.fed++;
        if (e.t === 'starved') m.starved++;
        if (e.t === 'stage') m.stageRound[e.stage - 1] = L.round;
      }
      m.twistOff += L.prod.off.length;
      m.margins.push(g.city - g.storm);
      applyAction(g, { type: 'continue' });
    }
  }
  m.emptyEnd = g.districts.flat().filter(x => !x).length / N;
  return { g, m };
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function run(N, storm) {
  const res = { won: 0, caught: 0, timeout: 0, dist: [], frac: [], rounds: [], dead: 0, plays: 0, passes: 0, passBuilt: 0, scraps: 0, starved: 0, fed: 0, stage: [0, 0, 0, 0], stageRound: [[], [], [], []], marginsByRound: [], builtByCard: {}, scrapByCard: {}, empty: [], replaced: 0, twistOff: 0, engineShare: [], strideRound: [] };
  for (let i = 0; i < GAMES; i++) {
    const { g, m } = playGame(N, 1000 + i * 31 + N, { storm });
    res[g.outcome]++;
    res.dist.push(Math.min(g.city, g.haven)); res.frac.push(Math.min(1, g.city / g.haven)); res.rounds.push(g.round);
    for (const k of ['dead', 'plays', 'passes', 'passBuilt', 'scraps', 'starved', 'fed', 'replaced', 'twistOff']) res[k] += m[k];
    m.stageRound.forEach((r, s) => { if (r) { res.stage[s]++; res.stageRound[s].push(r); } });
    m.margins.forEach((x, r) => (res.marginsByRound[r] = res.marginsByRound[r] || []).push(x));
    for (const [c, n] of Object.entries(m.builtByCard)) res.builtByCard[c] = (res.builtByCard[c] || 0) + n;
    for (const [c, n] of Object.entries(m.scrapByCard)) res.scrapByCard[c] = (res.scrapByCard[c] || 0) + n;
    res.empty.push(m.emptyEnd);
    const eng = g.history.reduce((a, h) => a + h.engine, 0), tot = g.history.reduce((a, h) => a + h.walked, 0);
    res.engineShare.push(tot ? eng / tot : 0);
    g.history.forEach((h, r) => (res.strideRound[r] = res.strideRound[r] || []).push(h.walked));
  }
  return res;
}

function report(N, storm, r) {
  const G = GAMES;
  console.log(`\n=== ${N} players · ${storm} · ${STYLE} · ${MODE} · ${G} games · Haven ${CONFIG.havenPerPlayer * N} ===`);
  console.log(`win ${pct(r.won, G)} | caught ${pct(r.caught, G)} | timeout ${pct(r.timeout, G)} | rounds avg ${avg(r.rounds).toFixed(1)}`);
  console.log(`distance p10/p50/p90 ${q(r.dist, .1)}/${q(r.dist, .5)}/${q(r.dist, .9)} | of Haven avg ${(100 * avg(r.frac)).toFixed(0)}%`);
  console.log(`dead turns ${pct(r.dead, r.plays)} | builds that were gifts ${pct(r.passBuilt, r.plays - r.scraps)} | scraps ${pct(r.scraps, r.plays)} | replaced builds ${(r.replaced / G).toFixed(1)}/game | empty tiles at end ${avg(r.empty).toFixed(1)}/district`);
  console.log(`starved building-rounds ${(r.starved / G).toFixed(1)}/game | emergency feeds ${(r.fed / G).toFixed(1)}/game | twist-off tile-rounds ${(r.twistOff / G).toFixed(1)}/game | engine share of strides ${(100 * avg(r.engineShare)).toFixed(0)}%`);
  console.log(`Main Drive stages reached: ${r.stage.map((n, i) => `S${i + 1} ${pct(n, G)} (r${avg(r.stageRound[i]).toFixed(1)})`).join('  ')}`);
  console.log('margin (city-storm) by round, mean/p10: ' + r.marginsByRound.map((a, i) => `r${i + 1} ${avg(a).toFixed(1)}/${q(a, .1)}`).join('  '));
  console.log('strides walked by round (mean): ' + r.strideRound.map((a, i) => `r${i + 1} ${avg(a).toFixed(1)}`).join('  '));
  const cards = Object.keys(CARDS).map(c => `${c} ${(((r.builtByCard[c] || 0)) / G).toFixed(1)}b/${(((r.scrapByCard[c] || 0)) / G).toFixed(1)}s`);
  console.log('per game built/scrapped: ' + cards.join('  '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const storms = STORM === 'both' ? ['lightning', 'sandstorm'] : [STORM];
  for (const storm of storms) for (const N of [3, 4, 5]) report(N, storm, run(N, storm));
}
