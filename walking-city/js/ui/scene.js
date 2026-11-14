// The TV's renderer switch. Uses the 3D train (./train3d.js, Three.js) when it loads and WebGL works,
// otherwise the 2D board (./board.js). host.js only talks to this file, so either renderer can be swapped.
// ?render=2d forces the 2D board.
import { DEPTS } from '../config.js';
import { CONFIG } from '../config.js';
import { deptPanel, drawTrack, laneFlash, cellFx } from './board.js';

const ORDER = ['loco', 'power', 'fab', 'shield', 'research']; // front of the train to the back

function webgl() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

export async function makeScene() {
  const want3d = new URLSearchParams(location.search).get('render') !== '2d';
  if (want3d && webgl()) {
    try {
      const mod = await import('./train3d.js');
      document.body.classList.add('three'); // show the stage first so the renderer can measure it
      const stage = document.getElementById('stage');
      const train = await mod.createTrain(stage, { cols: CONFIG.grid.cols, rows: CONFIG.grid.rows, order: ORDER });
      if (train.ready) await Promise.race([train.ready, new Promise((_, no) => setTimeout(() => no(new Error('assets timed out')), 20000))]);
      return scene3d(train);
    } catch (e) {
      console.warn('3D train unavailable, using the 2D board:', e && e.message);
      document.body.classList.remove('three');
      const st = document.getElementById('stage'); if (st) st.innerHTML = '';
    }
  }
  return scene2d();
}

function scene2d() {
  return {
    kind: '2d',
    draw(v, { shownEv, track }) {
      for (const d of DEPTS) document.getElementById('p-' + d).innerHTML = deptPanel(v, d, { ev: shownEv });
      drawTrack(document.getElementById('track'), v, track);
    },
    race() {},
    focus() {},
    lane: laneFlash,
    pop: cellFx,
    transfer() {},
  };
}

function scene3d(train) {
  const labels = document.getElementById('carLabels');
  let last = null;
  // keep HTML labels pinned to the cars while the camera moves
  const pin = () => {
    for (const d of ORDER) {
      const el = labels.querySelector(`[data-car="${d}"]`);
      if (!el || !train.carScreenRect) continue;
      const r = train.carScreenRect(d);
      if (!r) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(r.x + r.w / 2)}px, ${Math.round(r.y)}px)`;
    }
    requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);
  return {
    kind: '3d',
    draw(v, { track }) {
      last = v;
      train.update(v);
      if (track) train.setRace(track); else train.setRace({ city: v.city, storm: v.storm });
    },
    race(track) { train.setRace(track); },
    focus(d) { train.focus && train.focus(d); },
    lane(d, col, kind) { train.lane && train.lane(d, col, kind); },
    pop(d, cell, text, kind) { train.pop && train.pop(d, cell, String(text).replace(/<[^>]+>/g, ''), kind); },
    transfer(a, b, res, n) { train.transfer && train.transfer(a, b, res, n); },
  };
}
export { ORDER };
