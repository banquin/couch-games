// Turns the ASCII star map in config.js into a grid the rules can use.
export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function buildMap(cfg, playerCount) {
  const rows = cfg.map.map(r => r.trim().split(/\s+/));
  const h = rows.length, w = rows[0].length;
  rows.forEach((r, y) => { if (r.length !== w) throw new Error(`Map row ${y + 1} has ${r.length} spaces, expected ${w}.`); });
  const cells = []; // cells[y][x] = { kind, planet?, pull?, well? }
  const planets = {}; const starts = {}; const cores = [];
  for (let y = 0; y < h; y++) {
    cells.push([]);
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      let c = { kind: 'empty' };
      if (ch === 'o') c = { kind: 'ring' };
      else if (ch === '@') { c = { kind: 'core' }; cores.push([x, y]); }
      else if (ch === '#') c = { kind: 'closed' };
      else if (ch === 'x') c = playerCount <= 3 ? { kind: 'closed' } : { kind: 'empty' };
      else if (/[1-9]/.test(ch)) starts[Number(ch)] = [x, y];
      else if (cfg.planets[ch]) {
        c = { kind: 'planet', planet: ch };
        planets[ch] = { key: ch, x, y, name: cfg.planets[ch].name, color: cfg.planets[ch].color };
      } else if (ch !== '.') throw new Error(`Map has an unknown symbol "${ch}" at row ${y + 1}.`);
      cells[y].push(c);
    }
  }
  // A planet surrounded by closed spaces (3-player region) is removed from play.
  for (const k of Object.keys(planets)) {
    const p = planets[k];
    const open = neighbors8(w, h, p.x, p.y).some(([x, y]) => cells[y][x].kind !== 'closed');
    if (!open) { cells[p.y][p.x] = { kind: 'closed' }; delete planets[k]; }
  }
  cores.forEach(([cx, cy], i) => {
    cells[cy][cx].well = i;
    for (const [x, y] of neighbors8(w, h, cx, cy)) {
      const c = cells[y][x];
      if (c.kind === 'ring') { c.pull = [Math.sign(cx - x), Math.sign(cy - y)]; c.well = i; }
    }
  });
  const startList = Object.keys(starts).map(Number).sort((a, b) => a - b).map(k => starts[k]);
  if (startList.length < playerCount) throw new Error(`Map needs ${playerCount} start spaces (1-${playerCount}).`);
  const m = { w, h, cells, planets, cores, starts: startList,
    wells: cores.map(([x, y], i) => ({ x, y, name: (cfg.wellNames || [])[i] || 'Well ' + (i + 1) })) };
  m.adj = {}; // planet key -> list of [x,y] spaces next to it (8-way) that ships can stand on
  for (const k of Object.keys(planets)) {
    m.adj[k] = neighbors8(w, h, planets[k].x, planets[k].y).filter(([x, y]) => passable(m, x, y));
  }
  m.dist = {}; // planet key -> flat array of shortest-path distance to its adjacent spaces (for bots/ui)
  for (const k of Object.keys(planets)) m.dist[k] = bfs(m, m.adj[k]);
  return m;
}

export function neighbors8(w, h, x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push([nx, ny]);
  }
  return out;
}
export function inBounds(m, x, y) { return x >= 0 && y >= 0 && x < m.w && y < m.h; }
export function passable(m, x, y) {
  if (!inBounds(m, x, y)) return false;
  const k = m.cells[y][x].kind; return k !== 'planet' && k !== 'closed';
}
export function isNextTo(m, planetKey, x, y) {
  const p = m.planets[planetKey]; if (!p) return false;
  return Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) === 1;
}
function bfs(m, sources) {
  const d = new Array(m.w * m.h).fill(99);
  const q = [];
  for (const [x, y] of sources) { d[y * m.w + x] = 0; q.push([x, y]); }
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx, ny = y + dy;
      if (passable(m, nx, ny) && d[ny * m.w + nx] > d[y * m.w + x] + 1) { d[ny * m.w + nx] = d[y * m.w + x] + 1; q.push([nx, ny]); }
    }
  }
  return d;
}
