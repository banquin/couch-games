// Rules tests.  Run: node test/engine.test.js
import assert from 'assert/strict';
import { CONFIG } from '../js/config.js';
import { buildMap } from '../js/engine/map.js';
import { resolveMove } from '../js/engine/move.js';
import { createGame, applyAction, checkInvariants } from '../js/engine/engine.js';
import { botProgram, botShop } from '../js/engine/bot.js';

const map = buildMap(CONFIG, 4);
let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } }
function run(ships, moverId, slot, opts = {}) {
  const ctx = { cfg: CONFIG, map, shieldsLeft: opts.shields || {}, firstMove: !!opts.first };
  const mover = ships.find(s => s.id === moverId);
  const ev = resolveMove(ctx, ships, mover, slot);
  return { ev, at: [mover.x, mover.y], ctx };
}
const S = (id, x, y, captain = 'ghost') => ({ id, x, y, captain });

t('burn moves in a straight line', () => {
  assert.deepEqual(run([S('a', 0, 0, 'tug')], 'a', { type: 'burn2', dir: 'E' }).at, [2, 0]);
});
t('board edge stops you', () => {
  assert.deepEqual(run([S('a', 0, 0, 'tug')], 'a', { type: 'burn3', dir: 'N' }).at, [0, 0]);
});
t('planets stop you one space short', () => { // Kell at (1,2)
  assert.deepEqual(run([S('a', 1, 0, 'tug')], 'a', { type: 'burn3', dir: 'S' }).at, [1, 1]);
});
t('bump pushes the other ship 1 space', () => {
  const ships = [S('a', 0, 0, 'tug'), S('b', 2, 0, 'ghost')];
  ships[0].captain = 'hauler';
  const r = run(ships, 'a', { type: 'burn3', dir: 'E' });
  assert.deepEqual(r.at, CONFIG.bumpFollow ? [2, 0] : [1, 0]);
  assert.deepEqual([ships[1].x, ships[1].y], [3, 0]);
});
t('tug pushes 2, bulwark never moves', () => {
  const ships = [S('a', 0, 0, 'tug'), S('b', 1, 0, 'hauler')];
  run(ships, 'a', { type: 'burn1', dir: 'E' });
  assert.deepEqual([ships[1].x, ships[1].y], [3, 0]);
  const s2 = [S('a', 0, 0, 'tug'), S('b', 1, 0, 'bulwark')];
  run(s2, 'a', { type: 'burn1', dir: 'E' });
  assert.deepEqual([s2[1].x, s2[1].y], [1, 0]);
});
t('a blocked bump leaves the ship in place', () => {
  const ships = [S('a', 0, 1, 'hauler'), S('b', 0, 0, 'hauler')]; // pushing b north off the board
  run(ships, 'a', { type: 'burn1', dir: 'N' });
  assert.deepEqual([ships[1].x, ships[1].y], [0, 0]);
  assert.deepEqual([ships[0].x, ships[0].y], [0, 1]);
});
t('stopping on a ring space pulls you toward the core', () => { // Maw ring (3,2)-(5,4), core (4,3)
  const r = run([S('a', 3, 0, 'hauler')], 'a', { type: 'burn2', dir: 'S' }); // ends (3,2) -> pulled to (4,3)
  assert.deepEqual(r.at, [4, 3]);
});
t('brake ignores gravity', () => {
  assert.deepEqual(run([S('a', 3, 1, 'hauler')], 'a', { type: 'brake', dir: 'S' }).at, [3, 2]);
});
t('ghost ignores gravity on its first move only', () => {
  assert.deepEqual(run([S('a', 3, 0, 'ghost')], 'a', { type: 'burn2', dir: 'S' }, { first: true }).at, [3, 2]);
  assert.deepEqual(run([S('a', 3, 0, 'ghost')], 'a', { type: 'burn2', dir: 'S' }).at, [4, 3]);
});
t('slingshot: a burn starting in a well goes +1', () => {
  assert.deepEqual(run([S('a', 4, 3, 'hauler')], 'a', { type: 'burn1', dir: 'E' }).at, [6, 3]);
});
t('pull into an occupied core does not happen', () => {
  const ships = [S('a', 3, 0, 'hauler'), S('b', 4, 3, 'hauler')];
  assert.deepEqual(run(ships, 'a', { type: 'burn2', dir: 'S' }).at, [3, 2]);
});
t('shield blocks one pull and is spent', () => {
  const r = run([S('a', 3, 0, 'hauler')], 'a', { type: 'burn2', dir: 'S', shield: true }, { shields: { a: 1 } });
  assert.deepEqual(r.at, [3, 2]);
  assert.equal(r.ctx.shieldsLeft.a, 0);
});
t('drift on a ring space gets pulled', () => {
  assert.deepEqual(run([S('a', 5, 4, 'hauler')], 'a', { type: 'drift' }).at, [4, 3]);
});
t('3-player games close the Juno corner', () => {
  const m3 = buildMap(CONFIG, 3);
  assert.equal(m3.planets.J, undefined);
  assert.equal(m3.cells[10][9].kind, 'closed');
  assert.ok(buildMap(CONFIG, 4).planets.J);
});
t('rejects bad programs', () => {
  const g = createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], seed: 5 });
  assert.equal(applyAction(g, { type: 'submit', pid: 'a', slots: [] }).ok, false);
  const h = g.players[0].hand;
  assert.equal(applyAction(g, { type: 'submit', pid: 'a', slots: [{ cardId: h[0].id, dir: 'N' }, { cardId: h[0].id, dir: 'N' }, { cardId: h[1].id, dir: 'N' }] }).ok, false);
});
t('full bot games keep the board legal at 3, 4 and 5 players', () => {
  for (const n of [3, 4, 5]) for (let seed = 1; seed <= 15; seed++) {
    const g = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), seed });
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 200) {
      if (g.phase === 'program') for (const p of g.players) assert.ok(applyAction(g, botProgram(g, p.id)).ok);
      else if (g.phase === 'resolve') { checkInvariants(g); applyAction(g, { type: 'continue' }); }
      else if (g.phase === 'shop') for (const p of g.players) for (const a of botShop(g, p.id)) applyAction(g, a);
    }
    assert.equal(g.phase, 'over');
    assert.equal(g.round, CONFIG.rounds);
  }
});
console.log(`${passed} rules tests passed${process.exitCode ? ' (with failures above)' : ''}`);
