// Rules tests (v0.3). Run: node walking-city/test/engine.test.js
import assert from 'assert';
import { CONFIG, DEPTS, MACHINES } from '../js/config.js';
import * as E from '../js/engine/engine.js';
import { planBots } from '../js/engine/bots.js';
import { publicView, privateView } from '../js/engine/views.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const game = (seed = 7, mode = 'standard') => E.createGame({ seed, mode });

t('a new game has five departments with their starting machines', () => {
  const g = game();
  assert.deepStrictEqual(Object.keys(g.depts), DEPTS);
  for (const d of DEPTS) assert.strictEqual(g.depts[d].grid.filter(Boolean).length, CONFIG.starts[d].length);
  assert.strictEqual(g.phase, 'plan');
});

t('moves swap cells; only moves beyond the free ones idle', () => {
  const g = game();
  const grid = g.depts.fab.grid;
  const mv = E.movedMachines(g, grid, [[7, 0], [8, 1]]);
  assert.strictEqual(mv.moved.length, 2);
  assert.strictEqual(mv.idle.size, 2 - E.freeMoves(g));
  assert.strictEqual(mv.grid[0].type, 'drill');
});

t('normalizePlan drops a build the department cannot afford', () => {
  const g = game();
  g.depts.loco.hold.plates = 1;
  const { plan, errors } = E.normalizePlan(g, 'loco', { build: { type: 'engine', cell: 0 } });
  assert.strictEqual(plan.build, null);
  assert.ok(errors.length);
});

t('asks are derived from the plan (power = draw − aux)', () => {
  const g = game();
  const { plan } = E.normalizePlan(g, 'loco', { dials: { 8: 3, 10: 3 } });
  assert.strictEqual(plan.asks.power, 6 - CONFIG.auxPower);
});

t('engine throttle is capped by heat', () => {
  const g = game();
  const e = g.depts.loco.grid[8];
  e.heat = 4;
  assert.ok(E.maxThrottle(g, g.depts.loco.grid, 8, false) < 3);
});

t('strikes on an empty column arc to the nearest occupied one', () => {
  const grid = Array(E.CELLS).fill(null);
  grid[2] = { type: 'drill' };
  assert.strictEqual(E.strikeTarget(grid, 0), 2);
  assert.strictEqual(E.strikeTarget(Array(E.CELLS).fill(null), 1), -1);
});

t('projection never changes the real state', () => {
  const g = game();
  planBots(g);
  const before = JSON.stringify(g);
  E.project(g);
  assert.strictEqual(JSON.stringify(g), before);
});

t('views hide the secrets: strikes only for Shield, next fork only for Research', () => {
  const g = game();
  const pub = publicView(g);
  assert.ok(!pub.strikeLanes);
  assert.ok(privateView(g, 'shield').me.strikes);
  assert.ok(!privateView(g, 'loco').me.strikes);
  assert.ok('nextFork' in privateView(g, 'research').me);
  assert.ok(!('nextFork' in privateView(g, 'power').me));
});

t('an all-bot game runs to an outcome, and same seed gives the same game', () => {
  const run = seed => {
    const g = game(seed);
    for (let k = 0; k < 20 && g.phase !== 'over'; k++) {
      planBots(g);
      for (const d of DEPTS) g.depts[d].ready = true;
      E.resolveRound(g);
      assert.ok(g.city >= 0 && Number.isFinite(g.storm));
      if (g.phase === 'watch') E.nextRound(g);
    }
    assert.strictEqual(g.phase, 'over');
    return [g.city, g.storm, g.outcome.win];
  };
  assert.deepStrictEqual(run(11), run(11));
});

t('every machine has a name and a text from the theme', () => {
  for (const [k, m] of Object.entries(MACHINES)) assert.ok(m.name && m.text, k);
});

console.log(`\n${n} tests passed`);
