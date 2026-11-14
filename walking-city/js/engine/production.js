// =====================================================================
//  City geometry and production. Pure functions, shared by the TV,
//  the phones (for live previews) and the bots.
//
//  The city is a ring of N districts. Each district is a 3x3 grid,
//  tile t = r*3 + c. Row 0 touches the core, row 2 is the outer edge.
//  Column 2 of district d touches column 0 of district d+1 (same row).
//
//  Flow rule: an active building gives its FULL output to every
//  adjacent building. Nothing is split or stored. A building is active
//  when its adjacent active buildings supply all of its needs.
// =====================================================================
import { CARDS, RES, BASICS } from '../config.js';

export const rowOf = t => Math.floor(t / 3);
export const colOf = t => t % 3;

const nbCache = new Map();
// neighbors(N, d, t) -> [[d2, t2], ...]
export function neighbors(N, d, t) {
  const key = N * 100 + d * 10 + t;
  if (nbCache.has(key)) return nbCache.get(key);
  const r = rowOf(t), c = colOf(t), out = [];
  if (r > 0) out.push([d, t - 3]);
  if (r < 2) out.push([d, t + 3]);
  if (c > 0) out.push([d, t - 1]); else out.push([(d - 1 + N) % N, r * 3 + 2]);
  if (c < 2) out.push([d, t + 1]); else out.push([(d + 1) % N, r * 3]);
  nbCache.set(key, out);
  return out;
}

export function makesOf(cardId) { return CARDS[cardId].makes; }

// Which tiles the storm switches off this round. Returns Set of d*9+t.
export function disabledTiles(districts, stormType, round, cfg) {
  const off = new Set();
  if (round < cfg.twistStartRound) return off;
  const N = districts.length;
  if (stormType === 'lightning') {
    if (!lightningRound(round, cfg)) return off;
    for (let d = 0; d < N; d++) for (let t = 0; t < 9; t++) {
      const b = districts[d][t];
      if (b && CARDS[b.card].makes.power && rowOf(t) > 0) off.add(d * 9 + t);
    }
  } else if (stormType === 'sandstorm') {
    const col = sandColumn(round, cfg);
    for (let d = 0; d < N; d++) if (districts[d][6 + col]) off.add(d * 9 + 6 + col);
  }
  return off;
}
export function lightningRound(round, cfg) { return round >= cfg.twistStartRound && round % 2 === 1; }
// Starts on the middle column so the first gust doesn't bury every district's starting Fuel Well (left column).
export function sandColumn(round, cfg) { return round < cfg.twistStartRound ? -1 : (round - cfg.twistStartRound + 1) % 3; }


// Resolve one round of production.
// opts: { disabled:Set, surge:Set (d*9+t doubles output), crates:[{supply,part}] (for emergency feed; mutated copy returned) }
export function resolveProduction(districts, opts = {}) {
  const N = districts.length;
  const disabled = opts.disabled || new Set();
  const surge = opts.surge || new Set();
  const total = N * 9;
  const wave = new Int8Array(total).fill(-1);
  const out = new Array(total).fill(null);
  const built = [];
  for (let d = 0; d < N; d++) for (let t = 0; t < 9; t++) {
    const b = districts[d][t];
    if (b && !disabled.has(d * 9 + t)) built.push(d * 9 + t);
  }
  const outputOf = k => {
    const b = districts[(k / 9) | 0][k % 9];
    const m = CARDS[b.card].makes, mult = surge.has(k) ? 2 : 1;
    const o = {};
    for (const r in m) o[r] = m[r] * mult;
    return o;
  };
  const supplied = k => {
    const d = (k / 9) | 0, t = k % 9, s = { ore: 0, fuel: 0, power: 0, part: 0 };
    for (const [d2, t2] of neighbors(N, d, t)) {
      const o = out[d2 * 9 + t2];
      if (o) for (const r of RES) if (o[r]) s[r] += o[r];
    }
    return s;
  };
  const meets = (k, s) => {
    const need = CARDS[districts[(k / 9) | 0][k % 9].card].needs;
    for (const r in need) if ((s[r] || 0) < need[r]) return false;
    return true;
  };
  let w = 0;
  for (;;) {
    const newly = [];
    for (const k of built) if (wave[k] < 0 && meets(k, supplied(k))) newly.push(k);
    if (!newly.length) break;
    for (const k of newly) { wave[k] = w; out[k] = outputOf(k); }
    w++;
  }
  // Starved buildings and what they are missing.
  const starved = [];
  for (const k of built) if (wave[k] < 0) {
    const s = supplied(k), need = CARDS[districts[(k / 9) | 0][k % 9].card].needs, missing = {};
    for (const r in need) if ((s[r] || 0) < need[r]) missing[r] = need[r] - (s[r] || 0);
    starved.push({ k, missing });
  }
  // Emergency feed: starved engines take missing inputs from their owner's crates.
  const fed = [];
  let crates = opts.crates ? opts.crates.map(c => ({ ...c })) : null;
  if (crates) {
    const engines = starved.filter(s => CARDS[cardAt(districts, s.k)].kind === 'engine')
      .sort((a, b) => strideOf(districts, b.k) - strideOf(districts, a.k) || a.k - b.k);
    for (const s of engines) {
      const d = (s.k / 9) | 0, c = { ...crates[d] };
      let ok = true;
      for (const r in s.missing) {
        let n = s.missing[r];
        if (r === 'part') { if (c.part >= n && (!opts.partOk || opts.partOk[d])) c.part -= n; else ok = false; }
        else { if (c.supply >= n) c.supply -= n; else ok = false; } // Part crates are saved for Part needs and the Main Drive
      }
      if (ok) {
        fed.push({ k: s.k, d, used: { supply: crates[d].supply - c.supply, part: crates[d].part - c.part } });
        crates[d] = c; wave[s.k] = w; out[s.k] = outputOf(s.k);
      }
    }
  }
  const fedSet = new Set(fed.map(f => f.k));
  let strides = 0;
  const stridesBy = new Array(N).fill(0);
  for (const k of built) if (wave[k] >= 0 && out[k].stride) { strides += out[k].stride; stridesBy[(k / 9) | 0] += out[k].stride; }
  // Docking: what each district's inner row hands to the core.
  const docks = [];
  for (let d = 0; d < N; d++) {
    const dk = { ore: 0, fuel: 0, power: 0, part: 0 };
    for (let t = 0; t < 3; t++) { const o = out[d * 9 + t]; if (o) for (const r of RES) if (o[r]) dk[r] += o[r]; }
    docks.push(dk);
  }
  // Flow edges for the TV animation: producer -> consumer, for consumers that ran.
  const flows = [];
  for (const k of built) if (wave[k] >= 0 && !fedSet.has(k)) {
    const need = CARDS[cardAt(districts, k)].needs;
    if (!Object.keys(need).length) continue;
    const d = (k / 9) | 0, t = k % 9;
    for (const [d2, t2] of neighbors(N, d, t)) {
      const o = out[d2 * 9 + t2];
      if (!o) continue;
      for (const r in need) if (o[r]) flows.push({ from: d2 * 9 + t2, to: k, res: r });
    }
  }
  return {
    wave: Array.from(wave), waves: w, starved: starved.filter(s => !fedSet.has(s.k)), fed, crates,
    strides, stridesBy, docks, flows, active: built.filter(k => wave[k] >= 0), off: [...disabled],
  };
}
const cardAt = (districts, k) => districts[(k / 9) | 0][k % 9].card;
const strideOf = (districts, k) => CARDS[cardAt(districts, k)].makes.stride || 0;

// How much a dock counts toward a stage's need.
export function dockValue(dock, res) {
  return res === 'part' ? dock.part : BASICS.reduce((a, r) => a + dock[r], 0) + dock.part;
}
