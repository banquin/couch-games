// Live 3D train for the TV (Snowpiercer look). Three.js scene; all HUD stays as HTML over the canvas.
// Pure view: reads publicView (js/engine/views.js), never game rules. Assets: walking-city/assets/train/*.glb
// (exported from Blender by walking-city-art/train2/blender/export_assets.py; 1 unit = 1 grid cell, Y up).
//
//   const train = createTrain(container, { cols: 6, rows: 3, order: [...] });
//   await train.ready;                 // assets loaded (update() before that is queued)
//   train.update(v)                    // v = publicView
//   train.setRace({ city, storm })     // whiteout distance (glides)
//   train.focus(dept | null)           // camera glides to a car, or the whole train
//   train.lane(dept, col, 'hit'|'cov'|'miss')   // frost strike on one column
//   train.pop(dept, cell|null, text, 'gold'|'good'|'bad'|'')
//   train.carScreenRect(dept) -> {x, y, w, h} in CSS px relative to the container
//   train.transfer(from, to, res, n)   // crates carried along the train
//   train.dispose()
// Throws from createTrain if WebGL is unavailable, so the caller can keep the 2D board.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const L = 7.6, WD = 3.9, HT = 2.6, FL = 1.2, SP = 8.6, TILE_H = 0.06;
const DEFAULT_COLORS = { loco: '#ff5a4e', power: '#ffb02e', fab: '#4aa8ff', shield: '#5cf2a8', research: '#c58bff' };
const RES_COLOR = { power: '#ffb02e', steam: '#ffb02e', plates: '#b8c0cc', gears: '#d8a040', cores: '#b07aff', ore: '#7a5a40', insight: '#6ab8ff', charts: '#6ab8ff' };
const POP_COLOR = { gold: '#f0c040', good: '#7af0a8', bad: '#ff6a4a', '': '#e8eef6' };
const EMISSIVE_SCALE = 0.45; // Blender emission strengths -> three.js look

export function createTrain(container, opts = {}) {
  const cols = opts.cols || 6, rows = opts.rows || 3;
  const order = opts.order || ['loco', 'power', 'fab', 'shield', 'research'];
  const assetBase = opts.assetBase || new URL('../../assets/train/', import.meta.url).href;
  const quality = opts.quality || new URLSearchParams(location.search).get('quality') || (/(smart-?tv|tizen|webos|aft|crkey)/i.test(navigator.userAgent) ? 'low' : 'high');
  const n = order.length;
  const CAR_X = Object.fromEntries(order.map((d, i) => [d, ((n - 1) / 2 - i) * SP]));
  const frontX = CAR_X[order[0]] + L / 2, rearX = CAR_X[order[n - 1]] - L / 2;
  const cellXZ = i => [(i % cols) - (cols - 1) / 2, Math.floor(i / cols) - (rows - 1) / 2];

  // ---------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('WebGL unavailable');
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 'high' ? 1.5 : 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const cv = renderer.domElement; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.prepend(cv);
  const overlay = document.createElement('div'); overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  container.appendChild(overlay);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1626);
  scene.fog = new THREE.FogExp2(0x22304a, 0.0095);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 600);

  // ---------- lights
  scene.add(new THREE.HemisphereLight(0x6a86b8, 0x101824, 0.5));
  const moon = new THREE.DirectionalLight(0xa8c4ff, 0.85);
  moon.position.set(-18, 40, 26); moon.target.position.set(0, 0, 0);
  moon.castShadow = true; moon.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  Object.assign(moon.shadow.camera, { left: -32, right: 32, top: 18, bottom: -18, near: 1, far: 120 });
  moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);

  // ---------- environment (built here so it can scroll and loop)
  const R = rng(11);
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
  const snowM = M(0x76849e, { roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 400, 120, 80), snowM);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  { const p = ground.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); const far = Math.min(1, Math.max(0, Math.abs(y) - 5) / 14);
      p.setZ(i, (Math.sin(x * 0.09 + y * 0.15) * 1.1 + Math.sin(x * 0.031 - y * 0.07) * 2.4) * far - 0.3); } ground.geometry.computeVertexNormals(); }
  scene.add(ground);
  const bank = new THREE.Mesh(new THREE.BoxGeometry(600, 0.6, 5.6), M(0x6a7690)); bank.receiveShadow = true; scene.add(bank);
  const steel = M(0x1a1d22, { metalness: 0.85, roughness: 0.42 });
  for (const z of [-1.2, 1.2]) { const r = new THREE.Mesh(new THREE.BoxGeometry(600, 0.16, 0.16), steel); r.position.set(0, 0.42, z); scene.add(r); }
  // scrolling layers: [mesh, speedFactor, wrapWidth]
  const scrollers = [];
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.08, 3.4), M(0x0c0c0e), 140);
  for (let i = 0; i < 140; i++) sleepers.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-70 + i, 0.32, 0));
  sleepers.receiveShadow = true; scene.add(sleepers); scrollers.push([sleepers, 1, 1]);
  const poles = new THREE.Group(); const wood = M(0x3a1e10);
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group(); g.position.set(-72 + i * 9, 0, -6.5);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5, 8), wood); p.position.y = 2.2; p.rotation.z = 0.08; p.castShadow = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), wood); b.position.set(0.2, 4.4, 0);
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.25), snowM); s.position.set(0.2, 4.52, 0);
    g.add(p, b, s); poles.add(g);
  }
  scene.add(poles); scrollers.push([poles, 1, 144]);
  const rocks = new THREE.Group(); const iceRock = M(0x5a6a88, { roughness: 0.35 });
  for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + R() * 1.4, 1), iceRock); m.scale.set(1.4, 0.7, 1); m.position.set(-80 + R() * 160, 0, (R() < 0.5 ? 5.5 + R() * 9 : -8 - R() * 14)); m.castShadow = true; rocks.add(m); }
  scene.add(rocks); scrollers.push([rocks, 1, 160]);
  const city = new THREE.Group(); const towerM = M(0x10141c, { metalness: 0.4, roughness: 0.6 });
  for (let i = 0; i < 34; i++) { const h = 4 + R() * 12, w = 2 + R() * 2.5, x = -120 + i * 7 + R() * 3, z = -50 - R() * 18;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerM); t.position.set(x, h / 2 - 1, z); city.add(t);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.4, w + 0.2), snowM); cap.position.set(x, h - 0.9, z); city.add(cap); }
  scene.add(city); scrollers.push([city, 0.25, 240]);
  const mountains = new THREE.Group(); const rockM = M(0x1c2230);
  for (let i = 0; i < 14; i++) { const h = 16 + R() * 18, r = 10 + R() * 9, x = -150 + i * 22, z = -95 - R() * 25;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), rockM); m.position.set(x, h / 2 - 1, z); mountains.add(m);
    const c = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, h * 0.42, 7), snowM); c.position.set(x + 0.5, h * 0.79 - 1, z + 1.5); mountains.add(c); }
  scene.add(mountains); scrollers.push([mountains, 0.06, 308]);

  // blowing snow: thin streaks rushing past
  const NS = quality === 'high' ? 1100 : 500;
  const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.55, depthWrite: false, fog: false }), NS);
  const snow = []; for (let i = 0; i < NS; i++) snow.push({ x: (R() - 0.5) * 120, y: 0.3 + R() * 14, z: (R() - 0.5) * 34 + 3, len: 0.5 + R() * 1.1, v: 26 + R() * 18 });
  scene.add(streaks);

  // the whiteout chasing the train: soft billboards, ice shards, and a cold light
  const fogTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(235,242,255,1)'); gr.addColorStop(0.5, 'rgba(210,225,250,.55)'); gr.addColorStop(1, 'rgba(200,215,245,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const whiteout = new THREE.Group(); const puffs = [];
  for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, transparent: true, opacity: 0.55 + R() * 0.3, depthWrite: false, fog: false }));
    const sz = 14 + R() * 18; s.scale.set(sz, sz * 0.8, 1); s.position.set(-R() * 16, -1 + R() * 14, (R() - 0.5) * 50); whiteout.add(s); puffs.push({ s, ph: R() * 6, y: s.position.y }); }
  const iceM = new THREE.MeshStandardMaterial({ color: 0xa8d0ff, emissive: 0x4a7ab8, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.1 });
  for (let i = 0; i < 26; i++) { const h = 1 + R() * 4; const m = new THREE.Mesh(new THREE.ConeGeometry(0.3 + R() * 0.5, h, 5), iceM); m.position.set(6 - R() * 10, h / 2, (R() - 0.5) * 18); m.rotation.z = (R() - 0.5) * 0.6; whiteout.add(m); }
  const coldLight = new THREE.PointLight(0x9ac8ff, 60, 40, 2); coldLight.position.set(4, 6, 2); whiteout.add(coldLight);
  scene.add(whiteout);
  let wallX = rearX - 14, wallTarget = wallX;

  // ---------- train state
  const loader = new GLTFLoader();
  const T = {};            // templates: machines/<type>, car, crew, gangway, loco
  const cars = {};         // dept -> { group, color, tiles[], lanes[], cells[], light }
  const matCache = new Map();
  let lastV = null, focusDept = null, disposed = false;
  const fx = [];           // running effects: {t, dur, step(k), end()}

  const tint = (dept, mat, variant = '') => {
    const base = (mat.name || '').split('.')[0];
    const key = dept + '|' + mat.uuid + '|' + variant;
    if (matCache.has(key)) return matCache.get(key);
    const m = mat.clone(); const col = new THREE.Color(cars[dept] ? cars[dept].color : '#888');
    if (base === 'dept') m.color.copy(col);
    else if (base === 'dept_light') m.color.copy(col).lerp(new THREE.Color(1, 1, 1), 0.45);
    else if (base === 'dept_wall') m.color.copy(col).multiplyScalar(0.28).addScalar(0.035);
    if (m.emissiveIntensity > 0) m.emissiveIntensity *= EMISSIVE_SCALE;
    if (variant === 'ghost') { m.transparent = true; m.opacity = 0.35; m.depthWrite = false; m.emissive = new THREE.Color(0x6ad8ff); m.emissiveIntensity = 0.6; }
    if (variant === 'idle') { m.transparent = true; m.opacity = 0.45; m.color.multiplyScalar(0.6); }
    if (variant === 'dim') { m.color.multiplyScalar(0.45); if (m.emissiveIntensity) m.emissiveIntensity *= 0.15; }
    matCache.set(key, m); return m;
  };
  const instance = (tpl, dept, variant) => {
    const o = tpl.clone(true);
    o.traverse(c => { if (c.isMesh) { c.material = Array.isArray(c.material) ? c.material.map(m => tint(dept, m, variant)) : tint(dept, c.material, variant); c.castShadow = variant !== 'ghost'; c.receiveShadow = true; } });
    return o;
  };

  const tileA = M(0x8a8680, { metalness: 0.55, roughness: 0.5 }), tileB = M(0x6e6a66, { metalness: 0.55, roughness: 0.5 });
  const pipM = new THREE.MeshStandardMaterial({ color: 0xffd890, emissive: 0xffc860, emissiveIntensity: 2.2 });
  const heatOn = new THREE.MeshStandardMaterial({ color: 0xff5a2a, emissive: 0xff4a1a, emissiveIntensity: 2.4 }), heatOff = M(0x2a2a2e);
  const hotRing = new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff3a08, emissiveIntensity: 4 });
  const frostM = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0x5a8ac8, emissiveIntensity: 0.6, transparent: true, opacity: 0.65, roughness: 0.15 });
  const trippedM = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 3 });
  const upM = new THREE.MeshStandardMaterial({ color: 0x7af0c8, emissive: 0x4af0b0, emissiveIntensity: 2, transparent: true, opacity: 0.85 });
  const sphere = new THREE.SphereGeometry(1, 12, 8);

  function buildCar(d, color) {
    const g = new THREE.Group(); g.position.x = CAR_X[d]; scene.add(g);
    const car = { group: g, color, tiles: [], lanes: [], cells: Array(cols * rows).fill(null), sig: Array(cols * rows).fill('') };
    cars[d] = car;
    g.add(instance(T.car, d));
    for (let i = 0; i < cols * rows; i++) {
      const [x, z] = cellXZ(i); const c = i % cols, r = Math.floor(i / cols);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.94, TILE_H, 0.94), (c + r) % 2 ? tileA : tileB);
      t.position.set(x, FL + TILE_H / 2, z); t.receiveShadow = true; g.add(t); car.tiles.push(t);
    }
    for (let c = 0; c < cols; c++) {
      const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.98, rows), lm); lp.rotation.x = -Math.PI / 2; lp.position.set(c - (cols - 1) / 2, FL + TILE_H + 0.01, 0); g.add(lp); car.lanes.push(lp);
    }
    const crew = instance(T.crew, d); crew.position.set(L / 2 - 0.42, FL, 1.25); g.add(crew); car.crew = crew;
    const light = new THREE.PointLight(0xffb070, quality === 'high' ? 14 : 18, 9, 1.6); light.position.set(0, FL + HT - 0.9, -0.2); g.add(light); car.light = light;
    if (quality === 'high') { const l2 = new THREE.PointLight(0xffb070, 6, 6, 1.8); l2.position.set(0, FL + 0.8, 1.6); g.add(l2); }
    return car;
  }

  function cellSig(m, ghost) { return m ? [m.type, m.lvl, m.jam ? 'j' : '', m.idle ? 'i' : '', m.tripped ? 't' : '', m.hot ? 'h' : '', m.type === 'engine' ? 'H' + (m.heat || 0) : '', (m.type === 'module' && !m.online) || (m.type === 'projector' && !m.charged) ? 'o' : ''].join(',') : (ghost ? 'g:' + ghost : ''); }

  function setCell(d, i, m, ghost) {
    const car = cars[d]; const sig = cellSig(m, ghost);
    if (car.sig[i] === sig) return; car.sig[i] = sig;
    if (car.cells[i]) { car.group.remove(car.cells[i]); car.cells[i] = null; }
    if (!m && !ghost) return;
    const [x, z] = cellXZ(i); const g = new THREE.Group(); g.position.set(x, FL + TILE_H, z);
    if (!m) { const tpl = T['machines/' + ghost]; if (tpl) { const o = instance(tpl, d, 'ghost'); o.scale.setScalar(1.05); g.add(o); g.userData.ghost = true; } }
    else {
      const tpl = T['machines/' + m.type];
      const off = (m.type === 'module' && !m.online) || (m.type === 'projector' && !m.charged) || m.tripped;
      const variant = m.idle ? 'idle' : off ? 'dim' : '';
      if (tpl) { const o = instance(tpl, d, variant); o.scale.setScalar(1.05); g.add(o); }
      for (let l = 0; l < (m.lvl || 1); l++) { const p = new THREE.Mesh(sphere, pipM); p.scale.setScalar(0.055); p.position.set(-0.32 + l * 0.15, 0.05, 0.4); g.add(p); }
      if (m.type === 'engine') for (let k = 0; k < 4; k++) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), k < (m.heat || 0) ? heatOn : heatOff); h.position.set(0.42, 0.06 + k * 0.1, 0.4); g.add(h); }
      if (m.hot) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 32), hotRing); r.rotation.x = Math.PI / 2; r.position.y = 0.05; g.add(r); g.userData.hot = r; }
      if (m.jam) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.03, 0.96), frostM); f.position.y = 0.02; g.add(f);
        for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25 + (k % 3) * 0.12, 5), iceM); s.position.set(Math.cos(k * 1.7) * 0.35, 0.12, Math.sin(k * 1.7) * 0.35); s.rotation.z = (k % 2 - 0.5) * 0.5; g.add(s); } }
      if (m.tripped) { const t = new THREE.Mesh(sphere, trippedM); t.scale.setScalar(0.08); t.position.set(0, 1.05, 0); g.add(t); g.userData.blink = t; }
    }
    car.group.add(g); car.cells[i] = g;
  }

  function setUpgrade(d, cell) {
    const car = cars[d];
    if (car.upArrow) { car.group.remove(car.upArrow); car.upArrow = null; }
    if (cell == null) return;
    const [x, z] = cellXZ(cell); const a = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), upM); a.position.set(x, FL + 1.35, z); car.group.add(a); car.upArrow = a;
  }

  function applyView(v) {
    for (const d of order) {
      const dv = v.depts && v.depts[d]; if (!dv) continue;
      if (!cars[d]) buildCar(d, dv.color || DEFAULT_COLORS[d]);
      const b = dv.building;
      for (let i = 0; i < cols * rows; i++) {
        const m = dv.grid ? dv.grid[i] : null;
        const ghost = !m && b && b.cell === i ? (b.type || (b.tech ? 'module' : null)) : null;
        setCell(d, i, m, ghost);
      }
      setUpgrade(d, b && b.upgrade != null ? b.upgrade : null);
    }
    if (v.city != null && v.storm != null) setRace({ city: v.city, storm: v.storm });
  }

  function setRace({ city, storm }) {
    const gap = Math.max(0, (city || 0) - (storm || 0));
    wallTarget = rearX - 3 - Math.min(40, gap * 1.6);
  }

  // ---------- camera
  // Poses are fitted so the box fills the safe area: the camera looks along `dir` and backs off until every
  // corner of the box lands inside the margins (NDC), so framing holds at any screen shape.
  const fitCam = new THREE.PerspectiveCamera();
  function fitPose(box, dir, hfov, mx, myTop, myBot) {
    const c = box.getCenter(new THREE.Vector3()), dv = dir.clone().normalize();
    fitCam.aspect = camera.aspect; fitCam.fov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / Math.max(1, camera.aspect)) * 180 / Math.PI; fitCam.updateProjectionMatrix();
    const pts = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
    // binary-search the distance at which the projected extent fits, then pan so it is centred in the margins
    let lo = 2, hi = 400, sx = 0, sy = 0;
    for (let k = 0; k < 28; k++) {
      const dist = (lo + hi) / 2; fitCam.position.copy(c).addScaledVector(dv, dist); fitCam.lookAt(c); fitCam.updateMatrixWorld();
      let ok = true, x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const p of pts) { const q = p.clone().project(fitCam); if (q.z > 1) ok = false; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      if (x1 - x0 > 2 * mx || y1 - y0 > myTop + myBot) ok = false;
      if (ok) { hi = dist; sx = (x1 + x0) / 2; sy = (y1 + y0) / 2 - (myTop - myBot) / 2; } else lo = dist;
    }
    const pos = c.clone().addScaledVector(dv, hi);
    fitCam.position.copy(pos); fitCam.lookAt(c); fitCam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(fitCam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(fitCam.matrixWorld, 1);
    const halfH = Math.tan(THREE.MathUtils.degToRad(fitCam.fov) / 2) * hi, halfW = halfH * fitCam.aspect;
    const pan = right.multiplyScalar(sx * halfW).addScaledVector(up, sy * halfH);
    return { pos: pos.add(pan), tgt: c.clone().add(pan), hfov };
  }
  const trainBox = () => new THREE.Box3(new THREE.Vector3(rearX - 0.5, 0.2, -WD / 2), new THREE.Vector3(frontX + 9.5, FL + HT + 0.4, WD / 2));
  const carBox = d => new THREE.Box3(new THREE.Vector3(CAR_X[d] - L / 2, FL, -WD / 2), new THREE.Vector3(CAR_X[d] + L / 2, FL + HT, WD / 2));
  let overview, poses = {};
  function refit() {
    overview = fitPose(trainBox(), new THREE.Vector3(...(opts.overviewDir || [0.85, 0.95, 1])), 34, 0.97, 0.8, 0.94);
    for (const d of order) poses[d] = fitPose(carBox(d), new THREE.Vector3(0.3, 0.95, 1), 40, 0.86, 0.72, 0.86);
    camTo = focusDept ? poses[focusDept] : overview;
    if (camT >= 1) { camPos.copy(camTo.pos); camTgt.copy(camTo.tgt); camH = camTo.hfov; }
  }
  const carView = d => poses[d];
  let camFrom = null, camTo = null, camT = 1;
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3(); let camH = 42;
  function focus(d) { focusDept = d && cars[d] ? d : null; camFrom = { pos: camPos.clone(), tgt: camTgt.clone(), hfov: camH }; camTo = focusDept ? carView(focusDept) : overview; camT = 0; }

  // ---------- post-processing
  let composer = null;
  if (quality === 'high') {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.85));
    composer.addPass(new OutputPass());
  }
  // The HUD covers part of the stage (race bar on top, console panel on the right), so the camera frames the
  // train inside the uncovered "safe" rectangle while still drawing scenery behind the panels.
  const safeOpt = opts.safe;
  function safeRect(w, h) {
    let s = typeof safeOpt === 'function' ? safeOpt(w, h) : safeOpt;
    if (!s) { // default: the TV HUD's race bar (top 90px of the window) and console (right 470px), where they overlap the stage
      const r = container.getBoundingClientRect(), W = innerWidth;
      s = W >= 1100 ? { top: Math.max(0, 90 - r.top), right: Math.max(0, r.right - (W - 470)) } : {};
    }
    const l = s.left || 0, tp = s.top || 0, sw = Math.max(1, w - l - (s.right || 0)), sh = Math.max(1, h - tp - (s.bottom || 0));
    return { l, tp, sw, sh };
  }
  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const { l, tp, sw, sh } = safeRect(w, h);
    renderer.setSize(w, h, false); camera.aspect = sw / sh;
    camera.setViewOffset(sw, sh, -l, -tp, w, h); camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
    refit();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ---------- effects
  function runFx(dur, step, end) { fx.push({ t: 0, dur, step, end }); }
  function lane(d, col, kind = 'hit') {
    const car = cars[d]; if (!car || !car.lanes[col]) return;
    const lp = car.lanes[col]; const x = col - (cols - 1) / 2;
    lp.material.color.set(kind === 'cov' ? 0x5cf2c8 : kind === 'miss' ? 0x8090a8 : 0x9ad0ff);
    const shards = [];
    for (let k = 0; k < 7; k++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 5), iceM); s.rotation.x = Math.PI; s.position.set(x + (Math.random() - 0.5) * 0.7, FL + 7 + k * 0.9, (Math.random() - 0.5) * 2.6 + (kind === 'miss' ? 3.4 : 0)); car.group.add(s); shards.push(s); }
    let shield = null;
    if (kind === 'cov') { shield = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, rows + 0.2), new THREE.MeshStandardMaterial({ color: 0x5cf2c8, emissive: 0x3ad8a8, emissiveIntensity: 1.5, transparent: true, opacity: 0.0 })); shield.position.set(x, FL + HT - 0.2, 0); car.group.add(shield); }
    const stopY = kind === 'cov' ? FL + HT : kind === 'miss' ? 0.4 : FL + 0.2;
    runFx(1.8, k => {
      for (const s of shards) { s.position.y = Math.max(stopY, s.position.y - 0.32); s.visible = !(s.position.y <= stopY && k > 0.6); }
      lp.material.opacity = k < 0.35 ? k / 0.35 * 0.7 : 0.7 * (1 - (k - 0.35) / 0.65);
      if (shield) shield.material.opacity = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.7;
    }, () => { for (const s of shards) car.group.remove(s); if (shield) car.group.remove(shield); lp.material.opacity = 0; });
  }

  function worldToCss(v3) { const p = v3.clone().project(camera); const r = cv.getBoundingClientRect(), cr = container.getBoundingClientRect();
    return [(p.x + 1) / 2 * r.width + (r.left - cr.left), (1 - p.y) / 2 * r.height + (r.top - cr.top), p.z]; }
  const popSlots = {};
  function pop(d, cell, text, cls = '') {
    const car = cars[d]; if (!car) return;
    const local = cell != null ? (() => { const [x, z] = cellXZ(cell); return new THREE.Vector3(x, FL + 1.2, z); })() : new THREE.Vector3(0, FL + HT + 0.6, 0);
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:absolute;transform:translate(-50%,-100%);font:800 26px/1 "Saira Condensed",Inter,sans-serif;letter-spacing:.04em;color:${POP_COLOR[cls] || POP_COLOR['']};text-shadow:0 2px 6px #000c,0 0 14px #0008;white-space:nowrap;will-change:transform,opacity`;
    overlay.appendChild(el);
    // stack pops that land on the same spot at the same time
    const key = d + ':' + cell, slot = (popSlots[key] = (popSlots[key] || 0) + 1) - 1;
    el.style.background = '#0a1220b0'; el.style.padding = '3px 8px';
    runFx(1.6, k => { const wp = car.group.localToWorld(local.clone()); wp.y += k * 1.4; const [x, y] = worldToCss(wp); el.style.left = x + 'px'; el.style.top = (y - slot * 34) + 'px'; el.style.opacity = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1; },
      () => { el.remove(); popSlots[key]--; });
  }
  function transfer(from, to, res, n = 1) {
    const a = cars[from], b = cars[to]; if (!a || !b) return;
    const col = new THREE.Color(RES_COLOR[res] || '#c8b090');
    const crates = [];
    for (let k = 0; k < Math.min(4, Math.max(1, n)); k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.6 })); c.castShadow = true; scene.add(c); crates.push(c); }
    const x0 = CAR_X[from], x1 = CAR_X[to], dur = 0.9 + Math.abs(x1 - x0) / SP * 0.7;
    runFx(dur, k => crates.forEach((c, j) => { const kk = Math.min(1, Math.max(0, k * 1.25 - j * 0.08)); const e = kk * kk * (3 - 2 * kk);
      c.position.set(x0 + (x1 - x0) * e, FL + 0.3 + Math.abs(Math.sin(kk * Math.PI * Math.abs(x1 - x0) / SP)) * 0.12, 1.75); c.visible = kk > 0 && kk < 1; }),
      () => crates.forEach(c => scene.remove(c)));
  }
  function carScreenRect(d) {
    const car = cars[d]; if (!car) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sx of [-L / 2, L / 2]) for (const sy of [FL - 0.4, FL + HT + 0.2]) for (const sz of [-WD / 2, WD / 2]) {
      const [x, y] = worldToCss(car.group.localToWorld(new THREE.Vector3(sx, sy, sz))); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- loop
  const clock = new THREE.Clock(); const tmpM = new THREE.Matrix4(); const tmpQ = new THREE.Quaternion(); const tmpS = new THREE.Vector3(); const tmpP = new THREE.Vector3();
  let raf = 0, t = 0;
  const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const rawDt = Math.min(0.3, clock.getDelta()), dt = Math.min(0.05, rawDt); t += dt;
    tick(dt, rawDt);
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  function tick(dt, rawDt = dt) {
    const speed = 14;
    for (const [obj, f, wrap] of scrollers) {
      if (obj.isInstancedMesh) { obj.position.x = -((t * speed * f) % wrap); continue; }
      for (const c of obj.children) { c.position.x -= speed * f * dt; if (c.position.x < -wrap / 2) c.position.x += wrap; }
    }
    for (let i = 0; i < snow.length; i++) { const s = snow[i]; s.x -= s.v * dt; s.y -= 0.6 * dt; if (s.x < -60) { s.x += 120; s.y = 0.3 + Math.random() * 14; } if (s.y < 0.2) s.y = 14;
      tmpM.compose(tmpP.set(s.x, s.y, s.z), tmpQ, tmpS.set(s.len, 1, 1)); streaks.setMatrixAt(i, tmpM); }
    streaks.instanceMatrix.needsUpdate = true;
    wallX += (wallTarget - wallX) * Math.min(1, dt * 1.2); whiteout.position.x = wallX;
    for (const p of puffs) { p.s.position.y = p.y + Math.sin(t * 0.4 + p.ph) * 0.8; p.s.material.rotation = Math.sin(t * 0.2 + p.ph) * 0.3; }
    for (const d in cars) { const car = cars[d];
      car.light.intensity = (quality === 'high' ? 14 : 18) * (0.94 + Math.sin(t * 7.3 + car.group.position.x) * 0.03 + Math.sin(t * 17.1 + car.group.position.x * 3) * 0.03);
      car.group.position.y = Math.sin(t * 9 + car.group.position.x) * 0.012;
      for (const g of car.cells) if (g) {
        if (g.userData.hot) g.userData.hot.material.emissiveIntensity = 3 + Math.sin(t * 6) * 1.2;
        if (g.userData.blink) g.userData.blink.visible = Math.sin(t * 8) > 0;
        if (g.userData.ghost) g.position.y = FL + TILE_H + 0.05 + Math.sin(t * 2.5) * 0.04;
      }
      if (car.upArrow) { car.upArrow.position.y = FL + 1.35 + Math.sin(t * 3) * 0.1; car.upArrow.rotation.y = t * 1.5; }
    }
    // camera glide + gentle handheld sway
    if (camT < 1) { camT = Math.min(1, camT + rawDt / 1.3); const e = ease(camT);
      camPos.lerpVectors(camFrom.pos, camTo.pos, e); camTgt.lerpVectors(camFrom.tgt, camTo.tgt, e); camH = camFrom.hfov + (camTo.hfov - camFrom.hfov) * e; }
    camera.position.copy(camPos); camera.position.x += Math.sin(t * 0.35) * 0.25; camera.position.y += Math.sin(t * 0.5) * 0.12;
    camera.lookAt(camTgt);
    const vf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camH) / 2) / Math.max(1, camera.aspect)) * 180 / Math.PI;
    if (Math.abs(camera.fov - vf) > 0.01) { camera.fov = vf; camera.updateProjectionMatrix(); }
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += rawDt; const k = Math.min(1, f.t / f.dur); f.step(k); if (k >= 1) { f.end && f.end(); fx.splice(i, 1); } }
  }

  // ---------- load assets
  const names = ['car', 'crew', 'gangway', 'loco', ...['reactor', 'turbine', 'capacitor', 'cooler', 'drill', 'smelter', 'press', 'assembler', 'engine', 'radiator', 'gearbox', 'projector', 'armory', 'radar', 'lab', 'analyzer', 'uplink', 'module'].map(m => 'machines/' + m)];
  const ready = Promise.all(names.map(nm => loader.loadAsync(assetBase.replace(/\/?$/, '/') + nm + '.glb').then(g => { T[nm] = g.scene; }))).then(() => {
    if (disposed) return;
    // gangways and the plough locomotive
    for (let i = 0; i < n - 1; i++) { const gw = instance(T.gangway, order[i]); gw.position.x = (CAR_X[order[i]] + CAR_X[order[i + 1]]) / 2; scene.add(gw); }
    const loco = instance(T.loco, order[0]); loco.position.x = frontX + 0.5; scene.add(loco);
    const head = new THREE.SpotLight(0xfff2d8, 220, 60, 0.45, 0.6, 1.4); head.position.set(frontX + 7, FL + 2.7, 0); head.target.position.set(frontX + 30, 0, 0); scene.add(head, head.target);
    if (lastV) applyView(lastV);
    else for (const d of order) buildCar(d, DEFAULT_COLORS[d] || '#888');
  });
  frame();

  return {
    ready, canvas: cv,
    update(v) { lastV = v; if (T.car) applyView(v); },
    setRace, focus, lane, pop, transfer, carScreenRect,
    resize,
    dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); cv.remove(); overlay.remove(); },
  };
}

function rng(seed = 7) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
