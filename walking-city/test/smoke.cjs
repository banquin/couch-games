// End-to-end smoke test: the TV, two phones (Engine + Boiler cars), bots for the rest, several rounds.
// Needs the server running (node server.js).  Run: node walking-city/test/smoke.cjs [outDir]
// Env: RENDER (2d|3d, default 2d), BASE (default http://localhost:8080), ROUNDS (default 3), SPEED (TV animation multiplier, default 0.25), ROLES (default loco,power)
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:8080';
const ROUNDS = Number(process.env.ROUNDS || 3), SPEED = process.env.SPEED || '0.25';
const ROLES = (process.env.ROLES || 'loco,power').split(',');
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('console', m => { if (m.type() === 'error') errors.push('TV: ' + m.text()); });
  tv.on('pageerror', e => errors.push('TV pageerror: ' + e.message));
  await tv.goto(BASE + '/walking-city/host.html?fresh=1&render=' + (process.env.RENDER || '2d') + '&speed=' + SPEED + (process.env.QUERY || ''));
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#roomCode').textContent));
  const code = await tv.textContent('#roomCode');
  console.log('room', code);
  const phones = [];
  for (const role of ROLES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const ph = await ctx.newPage();
    ph.on('console', m => { if (m.type() === 'error') errors.push(role + ': ' + m.text()); });
    ph.on('pageerror', e => errors.push(role + ' pageerror: ' + e.message));
    await ph.goto(BASE + '/walking-city/play.html?room=' + code + (process.env.QUERY || ''));
    await ph.fill('#nameIn', role === 'loco' ? 'Brendan' : 'Sam');
    await ph.click('#joinBtn');
    await ph.waitForSelector(`.pick[data-d="${role}"]`);
    await ph.click(`.pick[data-d="${role}"]`);
    await ph.waitForSelector(`.pick.mine[data-d="${role}"]`);
    phones.push({ role, ph });
  }
  await phones[0].ph.screenshot({ path: OUT + '/1-phone-pick.png' });
  await tv.waitForTimeout(500);
  await tv.screenshot({ path: OUT + '/1-tv-lobby.png' });
  await tv.click('#startBtn');
  let last = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    for (const { role, ph } of phones) {
      await ph.waitForSelector('#plan:not(.hidden)', { timeout: 120000 });
      await ph.waitForTimeout(500);
      if (role === 'loco') {
        // set the first engine to its highest legal throttle, then build on an empty cell if affordable
        const engine = await ph.$('#gridBox .tile.m-engine');
        if (engine) { await engine.click(); const t = await ph.$$('#sheet .tbtn:not([disabled])'); if (t.length) await t[t.length - 1].click(); await ph.waitForTimeout(200); }
        const empty = await ph.$$('#gridBox .tile.empty');
        if (empty.length) { await empty[0].click(); const b = await ph.$('#sheet [data-build]'); if (b) await b.click(); else { const n = await ph.$('#sheet [data-next]'); if (n) await n.click(); } }
        const r = await ph.$('[data-route="1"]'); if (r && round === 2) await r.click();
        if (round === 1) await ph.screenshot({ path: OUT + '/2-phone-loco.png', fullPage: true });
      }
      if (role === 'power') {
        const f = await ph.$('[data-fill="power"]'); if (f) await f.click(); await ph.waitForTimeout(200); const fit = await ph.$('[data-x2="fit"]'); if (fit) await fit.click();
        await ph.waitForTimeout(200);
        if (round === 1) await ph.screenshot({ path: OUT + '/2-phone-power.png', fullPage: true });
      }
      await ph.waitForTimeout(300);
      await ph.click('#readyBtn');
    }
    if (round === 1) { await tv.waitForTimeout(400); await tv.screenshot({ path: OUT + '/3-tv-plan.png' }); }
    // wait for the TV to replay the round and start the next one
    await tv.waitForFunction(r => { const s = JSON.parse(localStorage.getItem('wc3-host')); return s.game && (s.game.round > r || s.game.phase === 'over'); }, round, { timeout: 120000 });
    if (round === 1) await phones[0].ph.screenshot({ path: OUT + '/4-phone-watch.png' });
    const st = await tv.evaluate(() => { const s = JSON.parse(localStorage.getItem('wc3-host')); return { round: s.game.round, phase: s.game.phase, city: s.game.city, storm: s.game.storm }; });
    console.log('after round', round, JSON.stringify(st));
    if (st.phase === 'over') break;
    last = round;
  }
  await tv.screenshot({ path: OUT + '/5-tv-later.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
