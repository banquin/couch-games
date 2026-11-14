// Start-space fairness for a map variant: node sim/starts.js games players '<json overrides>'
import { CONFIG } from '../js/config.js';
import { runBatch } from './simulate.js';
const G = Number(process.argv[2]) || 300, N = Number(process.argv[3]) || 4;
const cfg = { ...CONFIG, ...(process.argv[4] ? JSON.parse(process.argv[4]) : {}) };
const a = runBatch(N, G, cfg);
console.log(N + 'p', Object.entries(a.seatWins).sort().map(([k, v]) => `#${+k + 1} ${(v.w / v.n * N).toFixed(2)}`).join('  '));
