// Controlled upgrade test: one player uses a shop style, everyone else plays "balanced".
//   node sim/shoptest.js [games] [players]
import { CONFIG } from '../js/config.js';
import { playGame } from './simulate.js';
const G = Number(process.argv[2]) || 300, N = Number(process.argv[3]) || 4;
const overrides = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const cfg = { ...CONFIG, ...overrides };
for (const style of ['never', 'hold', 'hand', 'boost', 'balanced']) {
  let wins = 0;
  for (let g = 0; g < G; g++) {
    const pers = Array.from({ length: N }, (_, i) => (i === 0 ? style : 'balanced'));
    const r = playGame(N, 5000 + g * 17, cfg, { personalities: pers });
    if (r.st[0].id === 'p0') wins++;
  }
  console.log(`${N}p  ${style.padEnd(8)} win rate ${(wins / G * N).toFixed(2)}x fair`);
}
