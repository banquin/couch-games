// Rules tests. Run: node walking-city/test/engine.test.js
import assert from 'assert';
import { CONFIG } from '../js/config.js';
import { neighbors, resolveProduction } from '../js/engine/production.js';
import { createGame, applyAction, validatePlan } from '../js/engine/engine.js';
import { botPlan } from '../js/engine/bot.js';
import { makeRng } from '../js/engine/rng.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const empty = N => Array.from({ length: N }, () => Array(9).fill(null));
const b = card => ({ card, passedBy: null });

t('neighbours wrap around the ring, same row only', () => {
  assert.deepStrictEqual(neighbors(4, 0, 5).map(String).sort(), ['0,2', '0,4', '0,8', '1,3'].sort());
  assert.deepStrictEqual(neighbors(4, 0, 3).map(String).sort(), ['0,0', '0,4', '0,6', '3,5'].sort());
});

t('output feeds every neighbour in full, across borders', () => {
  const D = empty(3);
  D[0][5] = b('dynamo'); D[1][3] = b('piston'); D[1][0] = b('fuelwell'); D[0][4] = b('workshop'); D[0][1] = b('orepit');
  const p = resolveProduction(D);
  assert.strictEqual(p.strides, 1, 'piston across the border runs');
  assert.ok(p.active.includes(4), 'workshop gets the same power');
  assert.strictEqual(p.docks[0].part, 0, 'workshop in row 1 does not dock');
});

t('starved buildings report what is missing', () => {
  const D = empty(3); D[0][4] = b('piston'); D[0][3] = b('dynamo');
  const p = resolveProduction(D);
  assert.deepStrictEqual(p.starved[0].missing, { fuel: 1 });
});

t('emergency feed uses Supply for basics but never Part crates', () => {
  const D = empty(3); D[0][4] = b('piston'); D[0][3] = b('dynamo');
  assert.strictEqual(resolveProduction(D, { crates: [{ supply: 0, part: 2 }, { supply: 0, part: 0 }, { supply: 0, part: 0 }] }).strides, 0);
  assert.strictEqual(resolveProduction(D, { crates: [{ supply: 1, part: 0 }, { supply: 0, part: 0 }, { supply: 0, part: 0 }] }).strides, 1);
});

t('after round 1 only gifts or the kept card can be built', () => {
  const g = createGame({ players: [1, 2, 3].map(i => ({ id: 'b' + i, name: 'B' + i })), seed: 3 });
  g.round = 2;
  const p = g.players[0];
  p.hand = [{ uid: 'a', card: 'orepit', from: 'deck' }, { uid: 'b', card: 'piston', from: 'left', passedBy: 2 }, { uid: 'c', card: 'dynamo', from: 'deck' }];
  assert.match(validatePlan(g, 0, { play: { uid: 'a', mode: 'build', tile: 0 }, left: 'b', right: 'c' }), /only build/);
  assert.strictEqual(validatePlan(g, 0, { play: { uid: 'b', mode: 'build', tile: 0 }, left: 'a', right: 'c' }), null);
  assert.strictEqual(validatePlan(g, 0, { play: { uid: 'a', mode: 'scrap' }, left: 'b', right: 'c' }), null);
});

t('bot games finish at 3, 4 and 5 players with both storms', () => {
  for (const storm of ['lightning', 'sandstorm']) for (const N of [3, 4, 5]) {
    const g = createGame({ players: Array.from({ length: N }, (_, i) => ({ id: 'b' + i, name: 'B' + i })), seed: 42 + N, storm });
    const rng = makeRng(N);
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 50) {
      if (g.phase === 'plan') for (const p of g.players) { const r = applyAction(g, botPlan(g, p.id, { rng })); assert.ok(r.ok, r.error); }
      else applyAction(g, { type: 'continue' });
    }
    assert.strictEqual(g.phase, 'over');
    assert.ok(['won', 'caught', 'timeout'].includes(g.outcome));
    assert.ok(g.round <= CONFIG.maxRounds);
  }
});

console.log(`\n${n} tests passed`);
