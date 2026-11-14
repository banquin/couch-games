// Balance simulator for The Walking City v0.3.
// node walking-city/sim/simulate.js [games=200] [mode=first|standard|gale] [report=basic|roles|all]
// Env OV='{"stormSpeed":[...]}' overrides CONFIG keys for quick tuning.
import { createGame, resolveRound, nextRound, applyAction, clone } from '../js/engine/engine.js';
import { planBots } from '../js/engine/bots.js';
import { DEPTS, CONFIG } from '../js/config.js';

const N = +(process.argv[2] || 200);
const MODE = process.argv[3] || 'standard';
const REPORT = process.argv[4] || 'basic';
if (process.env.OV) Object.assign(CONFIG, JSON.parse(process.env.OV));

export function playGame(seed, mode, styles = {}) {
  const s = createGame({ seed, mode });
  const log = { builds: {}, noBuild: {}, moves: {}, jams: 0, covered: 0, strikes: 0, trips: 0, techs: 0, oc: 0, waste: { ore: 0, power: 0, plates: 0 }, broken: 0, rich: 0, dist: [], typeBuilds: {} };
  for (const d of DEPTS) { log.builds[d] = 0; log.noBuild[d] = 0; log.moves[d] = 0; log.typeBuilds[d] = {}; }
  while (s.phase !== 'over') {
    planBots(s, DEPTS, styles);
    for (const d of DEPTS) applyAction(s, { type: 'ready', dept: d, plan: s.depts[d].plan });
    const L = resolveRound(s);
    const ev = L.ev;
    for (const b of ev.builds) { log.builds[b.dept]++; const k = b.fresh ? b.type : b.type + '+'; log.typeBuilds[b.dept][k] = (log.typeBuilds[b.dept][k] || 0) + 1; }
    for (const t of ev.techs) { log.builds.research++; log.techs++; log.typeBuilds.research.tech = (log.typeBuilds.research.tech || 0) + 1; }
    for (const d of DEPTS) if (!ev.builds.some(b => b.dept === d) && !(d === 'research' && ev.techs.length)) log.noBuild[d]++;
    for (const m of ev.moves) log.moves[m.dept]++;
    log.jams += ev.jammed.length; log.strikes += ev.strikes.length; log.covered += ev.strikes.filter(x => x.covered).length;
    if (ev.trip) log.trips++;
    log.oc += ev.overclock.length; if (ev.unlock) log.unlocks = (log.unlocks || 0) + 1;
    for (const w of ev.waste) { if (w.res === 'ore') log.waste.ore += w.n; else if (w.res === 'power') log.waste.power += w.n; else if (w.res === 'plates') log.waste.plates += w.n; }
    log.broken += ev.broken.length;
    if (['orefield', 'vents', 'scrapyard'].includes(ev.terrain)) log.rich++;
    log.dist.push(ev.loco.dist);
    if (s.phase === 'watch') nextRound(s);
  }
  return { s, log, win: s.outcome.win, city: s.city, round: s.outcome.round, reason: s.outcome.reason, margin: s.city - s.storm };
}

function batch(styles, n = N, mode = MODE, seed0 = 1000) {
  const res = [];
  for (let k = 0; k < n; k++) res.push(playGame(seed0 + k * 7, mode, styles));
  return res;
}
const pct = x => (100 * x).toFixed(0) + '%';
const avg = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function summary(res) {
  return { win: avg(res.map(r => r.win ? 1 : 0)), city: avg(res.map(r => r.city)), round: avg(res.map(r => r.round)) };
}

const t0 = Date.now();
const base = batch({});
const b = summary(base);
console.log(`\n== ${N} games, mode ${MODE}: win ${pct(b.win)}  avg distance ${b.city.toFixed(0)}  avg end round ${b.round.toFixed(1)}`);
const reasons = {}; for (const r of base) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log('   outcomes', JSON.stringify(reasons));
const distBy = []; for (let i = 0; i < 8; i++) distBy.push(avg(base.filter(r => r.log.dist[i] != null).map(r => r.log.dist[i])).toFixed(1));
console.log('   distance per round', distBy.join(' '));
console.log('   storm per round   ', createGame({ mode: MODE }).rules.speeds.join(' '));
const L = k => avg(base.map(r => r.log[k]));
console.log(`   per game: strikes ${L('strikes').toFixed(1)}, covered ${L('covered').toFixed(1)}, machines jammed ${L('jams').toFixed(1)}, trips ${L('trips').toFixed(2)}, techs ${L('techs').toFixed(1)}, unlocks ${avg(base.map(r => r.log.unlocks || 0)).toFixed(1)}, overclocks ${L('oc').toFixed(1)}, broken pledges ${L('broken').toFixed(1)}, rich-route rounds ${L('rich').toFixed(1)}`);
console.log(`   waste per game: ore ${avg(base.map(r => r.log.waste.ore)).toFixed(1)}, power ${avg(base.map(r => r.log.waste.power)).toFixed(1)}, plates ${avg(base.map(r => r.log.waste.plates)).toFixed(1)}`);
for (const d of DEPTS) {
  const tb = {}; for (const r of base) for (const [k, v] of Object.entries(r.log.typeBuilds[d])) tb[k] = (tb[k] || 0) + v;
  const tot = Object.values(tb).reduce((s, x) => s + x, 0) || 1;
  console.log(`   ${d.padEnd(9)} builds/game ${avg(base.map(r => r.log.builds[d])).toFixed(1)}  rounds without a build ${avg(base.map(r => r.log.noBuild[d] / r.round * 100)).toFixed(0)}%  moves ${avg(base.map(r => r.log.moves[d])).toFixed(1)}  mix ${Object.entries(tb).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + Math.round(100 * v / tot) + '%').join(', ')}`);
}
if (REPORT !== 'basic') {
  console.log('\n== Each role played badly (distance drop vs all-greedy, win rate)');
  for (const style of ['noisy', 'random', 'idle']) {
    const row = [];
    for (const d of DEPTS) { const s2 = summary(batch({ [d]: style }, Math.ceil(N / 2))); row.push(`${d} ${pct(1 - s2.city / b.city)} drop, win ${pct(s2.win)}`); }
    console.log(`   ${style.padEnd(6)} ` + row.join(' | '));
  }
  const deaf = summary(batch({ power: 'deaf', fab: 'deaf' }, Math.ceil(N / 2)));
  console.log(`   Power and Fab ignore asks: win ${pct(deaf.win)} (vs ${pct(b.win)}), distance ${deaf.city.toFixed(0)}`);
  const nov = summary(batch({ fab: 'novice' }, Math.ceil(N / 2)));
  console.log(`   Fab never refactors: win ${pct(nov.win)}, distance ${nov.city.toFixed(0)}`);
}
if (REPORT === 'all') for (const m of ['first', 'standard', 'gale']) { const s2 = summary(batch({}, N, m)); console.log(`   mode ${m}: win ${pct(s2.win)}, distance ${s2.city.toFixed(0)}`); }
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
