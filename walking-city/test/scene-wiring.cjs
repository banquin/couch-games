// Checks host.js drives the 3D renderer API (createTrain/update/setRace/focus/lane/pop/transfer/carScreenRect)
// using a stand-in train served in place of js/ui/train3d.js. Needs node server.js. Run: node walking-city/test/scene-wiring.cjs [outDir]
const { chromium } = require('playwright');
const MOCK = `export async function createTrain(el, o) {
  const c = document.createElement('div'); c.style.cssText='position:absolute;inset:0;background:linear-gradient(#1a2a44,#0b1424)'; el.appendChild(c);
  window.__calls = [];
  const rect = d => { const i = o.order.indexOf(d); return { x: 120 + i * 230, y: 700 - i * 90, w: 220, h: 120 }; };
  for (const d of o.order) { const b = document.createElement('div'); const r = rect(d); b.style.cssText = 'position:absolute;border:2px solid #fff3;left:'+r.x+'px;top:'+r.y+'px;width:'+r.w+'px;height:'+r.h+'px'; b.id='car-'+d; c.appendChild(b); }
  const log = (...a) => window.__calls.push(a.map(x => typeof x === 'object' ? JSON.stringify(x).slice(0,60) : x).join(' '));
  return { update(v) { for (const d of o.order) document.getElementById('car-'+d).textContent = v.depts[d].grid.filter(Boolean).map(m=>m.type).join(' '); },
    setRace(t) { log('race', t); }, focus(d) { log('focus', d); }, lane(...a) { log('lane', ...a); }, pop(...a) { log('pop', ...a); }, transfer(...a) { log('transfer', ...a); }, carScreenRect: rect };
}`;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] }); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => (m.type() === 'error' || m.type()==='warning') && errs.push(m.text()));
  await p.route('**/js/ui/train3d.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await p.goto('' + (process.env.BASE || 'http://localhost:8080') + '/walking-city/host.html?net=local&fresh=1&speed=0.3');
  await p.waitForTimeout(1500);
  await p.click('#startBtn'); await p.waitForTimeout(2500);
  await p.screenshot({ path: (process.argv[2] || '.') + '/tv3d-plan.png' });
  await p.waitForTimeout(7000);
  await p.screenshot({ path: (process.argv[2] || '.') + '/tv3d-watch.png' });
  console.log((await p.evaluate(() => window.__calls || [])).slice(0, 30).join('\n'));
  console.log('body class:', await p.evaluate(() => document.body.className));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
