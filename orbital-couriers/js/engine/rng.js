// Small seeded random number generator so games (and simulations) are repeatable.
export function makeRng(seed) { return { s: (seed >>> 0) || 1 }; }
export function rand(r) {
  r.s = (r.s + 0x6D2B79F5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function randInt(r, n) { return Math.floor(rand(r) * n); }
export function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = randInt(r, i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
