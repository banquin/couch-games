// Compare rule variants quickly:  node sim/tune.js
import { CONFIG } from '../js/config.js';
import { runBatch } from './simulate.js';
const G = Number(process.argv[2]) || 150;
const R8 = { rounds: 8 };
const up = (h, c, sh) => ({ hold: { ...CONFIG.upgrades.hold, cost: h }, hand: { ...CONFIG.upgrades.hand, cost: c }, shield: { ...CONFIG.upgrades.shield, cost: sh } });
const variants = {
  base: {},
  shared: { sharedCargo: true },
  hold1: { startingHold: 1, upgrades: up([3, 6], [4, 7], [3, 6]) },
  open3: { contractsOpen: 3 },
};
const pick = process.argv.slice(3);
for (const [name, v] of Object.entries(variants)) {
  if (pick.length && !pick.includes(name)) continue;
  const cfg = { ...CONFIG, ...v };
  const row = [];
  for (const n of [3, 4, 5]) {
    const a = runBatch(n, G, cfg);
    const med = arr => [...arr].sort((x, y) => x - y)[Math.floor(arr.length / 2)];
    const pw = Object.fromEntries(Object.entries(a.pers).map(([k, x]) => [k, +(x.w / x.n * n).toFixed(2)]));
    const cw = Object.fromEntries(Object.entries(a.cap).map(([k, x]) => [k, +(x.w / x.n * n).toFixed(2)]));
    row.push(`${n}p del/p ${(a.deliveriesPerPlayer / G).toFixed(2)} zero ${(100 * a.zeroDelivery / G / n).toFixed(1)}% lead ${(100 * a.leaderWins / a.leaderGames).toFixed(0)}% last ${(100 * a.lastWins / a.lastGames).toFixed(0)}% tie ${(100 * a.ties / G).toFixed(0)}% margin ${med(a.margin)} salv ${(100 * a.salvage / a.loads).toFixed(0)}% bumps ${(a.bumpsPerRound / G).toFixed(2)}\n     shop ${JSON.stringify(pw)}\n     capt ${JSON.stringify(cw)}`);
  }
  console.log(`--- ${name}\n  ` + row.join('\n  '));
}
