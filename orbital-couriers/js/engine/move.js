// The ONLY movement code. Used by the rules engine, the phone's ghost-path
// preview, and the simulation bots, so they can never disagree.
import { CARDS } from '../config.js';
import { DIRS, passable } from './map.js';

// ships: array of { id, x, y, captain } (mutated in place)
// slot:  { type, dir, shield }   ctx: { cfg, map, shieldsLeft: {id: n}, firstMove: bool }
// Returns a list of events describing what happened.
export function resolveMove(ctx, ships, mover, slot) {
  const { cfg, map } = ctx;
  const card = CARDS[slot.type];
  const ev = [];
  const start = [mover.x, mover.y];
  const startCell = map.cells[mover.y][mover.x];
  let dist = card.dist;
  const isBurn = slot.type.startsWith('burn');
  const sling = isBurn && (startCell.kind === 'ring' || startCell.kind === 'core') ? cfg.slingshotBonus : 0;
  dist += sling;
  const path = [start];
  if (dist > 0) {
    const [dx, dy] = DIRS[slot.dir];
    for (let i = 0; i < dist; i++) {
      const nx = mover.x + dx, ny = mover.y + dy;
      if (!passable(map, nx, ny)) { ev.push({ t: 'blocked', id: mover.id, at: [nx, ny], lost: dist - i }); break; }
      const other = ships.find(s => s !== mover && s.x === nx && s.y === ny);
      if (other) {
        const pushed = bump(ctx, ships, other, mover, dx, dy);
        ev.push({ t: 'bump', id: mover.id, victim: other.id, from: [nx, ny], to: [other.x, other.y], moved: pushed });
        // Optional rule: the rammer slides into the space it just cleared.
        if (pushed && cfg.bumpFollow) { mover.x = nx; mover.y = ny; path.push([nx, ny]); }
        break;
      }
      mover.x = nx; mover.y = ny; path.push([nx, ny]);
    }
  }
  if (sling && path.length - 1 > card.dist) ev.push({ t: 'slingshot', id: mover.id });
  ev.unshift({ t: 'move', id: mover.id, type: slot.type, dir: slot.dir || null, path });

  // Gravity: ending a move on a ring space pulls you 1 space toward the core.
  const cell = map.cells[mover.y][mover.x];
  const ghostFree = mover.captain === 'ghost' && ctx.firstMove;
  if (cell.kind === 'ring' && !card.noGravity && !ghostFree) {
    const tx = mover.x + cell.pull[0], ty = mover.y + cell.pull[1];
    const occupied = ships.some(s => s !== mover && s.x === tx && s.y === ty);
    if (occupied) ev.push({ t: 'pullBlocked', id: mover.id });
    else if (slot.shield && (ctx.shieldsLeft[mover.id] || 0) > 0) {
      ctx.shieldsLeft[mover.id]--;
      ev.push({ t: 'shield', id: mover.id, left: ctx.shieldsLeft[mover.id] });
    } else {
      const from = [mover.x, mover.y];
      mover.x = tx; mover.y = ty;
      ev.push({ t: 'pull', id: mover.id, from, to: [tx, ty], well: cell.well });
    }
  } else if (cell.kind === 'ring' && (card.noGravity || ghostFree)) {
    ev.push({ t: 'noPull', id: mover.id, why: card.noGravity ? 'brake' : 'ghost' });
  }
  return ev;
}

// Push a ship up to 1 space (2 for Tug) in the mover's direction, as far as it is free.
function bump(ctx, ships, victim, mover, dx, dy) {
  if (victim.captain === 'bulwark') return 0;
  const n = mover.captain === 'tug' ? 2 : 1;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const nx = victim.x + dx, ny = victim.y + dy;
    if (!passable(ctx.map, nx, ny) || ships.some(s => s !== victim && s.x === nx && s.y === ny)) break;
    victim.x = nx; victim.y = ny; moved++;
  }
  return moved;
}

// Where would this ship end up after a list of slots, ignoring all other ships?
// Returns [{x,y,events}] per slot. Used by the phone ghost path and the bots.
export function ghostPath(cfg, map, ship, slots, shields) {
  const me = { id: ship.id, x: ship.x, y: ship.y, captain: ship.captain };
  const ctx = { cfg, map, shieldsLeft: { [ship.id]: shields || 0 }, firstMove: true };
  const out = [];
  slots.forEach((slot, i) => {
    ctx.firstMove = i === 0;
    if (!slot || !slot.type) { out.push(null); return; }
    const events = resolveMove(ctx, [me], me, slot);
    out.push({ x: me.x, y: me.y, events });
  });
  return out;
}
