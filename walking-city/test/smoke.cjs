// End-to-end smoke test: a TV page, one phone, practice bots, several rounds.
// Needs the server running (node server.js).  Run: node walking-city/test/smoke.cjs [outDir]
// Env: BASE (default http://localhost:8080), BOTS (default 3), ROUNDS (default 3), SPEED (TV animation multiplier, default 0.35)
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:8080';
const BOTS = Number(process.env.BOTS || 3), ROUNDS = Number(process.env.ROUNDS || 3), SPEED = process.env.SPEED || '0.35';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('console', m => { if (m.type() === 'error') errors.push('TV: ' + m.text()); });
  tv.on('pageerror', e => errors.push('TV pageerror: ' + e.message));
  await tv.goto(BASE + '/walking-city/host.html?fresh=1&speed=' + SPEED + (process.env.QUERY || ''));
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#roomCode').textContent));
  const code = await tv.textContent('#roomCode');
  console.log('code', code, 'join', await tv.textContent('#joinUrl'));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // BLOCK_RTC=1 simulates a network that blocks the direct phone-to-TV link, to exercise the relay fallback.
  if (process.env.BLOCK_RTC) await ctx.addInitScript(() => {
    const Real = window.RTCPeerConnection;
    window.RTCPeerConnection = function (cfg) { return new Real({ ...(cfg || {}), iceServers: [], iceTransportPolicy: 'relay' }); };
    window.RTCPeerConnection.prototype = Real.prototype;
  });
  const ph = await ctx.newPage();
  ph.on('console', m => { if (m.type() === 'error') errors.push('PH: ' + m.text()); });
  ph.on('pageerror', e => errors.push('PH pageerror: ' + e.message));
  await ph.goto(BASE + '/walking-city/play.html?room=' + code + (process.env.QUERY || ''));
  await ph.fill('#nameIn', 'Brendan');
  await ph.click('#joinBtn');
  await ph.waitForSelector('#wait:not(.hidden)');
  for (let i = 0; i < BOTS; i++) await tv.click('#addBot');
  await tv.waitForTimeout(600);
  await tv.screenshot({ path: OUT + '/1-tv-lobby.png' });
  await tv.click('#startBtn');
  for (let round = 1; round <= ROUNDS; round++) {
    await ph.waitForSelector('#plan:not(.hidden)', { timeout: 120000 });
    await ph.waitForTimeout(400);
    // 1) build: first card the phone allows us to build, on the first empty tile (else tile 0)
    const cards = await ph.$$('#hand .card');
    let built = false;
    for (const c of cards) {
      if (!(await c.getAttribute('class')).includes(' sel')) await c.click();
      const b = await ph.$('#actions .act[data-m="build"], #actions .act[data-m="action"]');
      if (b) {
        await b.click();
        const empty = await ph.$$('#grid .tile.empty:not(.ghost)');
        const tiles = empty.length ? empty : await ph.$$('#grid .tile:not(.ghost)');
        await tiles[0].click();
        const rt = await ph.textContent('#readyBtn');
        if (rt.includes('two tiles') || rt.includes('surge')) { const t2 = await ph.$$('#grid .tile:not(.ghost)'); await t2[4].click(); }
        built = true; break;
      }
    }
    if (!built) { await cards[0].click(); await ph.click('#actions .act[data-m="scrap"]'); }
    if (round === 1) await ph.screenshot({ path: OUT + '/3-phone-build.png' });
    // 2) passes
    for (const side of ['left', 'right']) {
      const free = await ph.$$('#hand .card:not(.assigned)');
      if (!free.length) break;
      if (!(await free[0].getAttribute('class')).includes(' sel')) await free[0].click();
      await ph.click(`#actions .act[data-m="${side}"]`);
    }
    if (round === 2) await ph.screenshot({ path: OUT + '/4-phone-plan.png', fullPage: true });
    if (round === 1) await tv.screenshot({ path: OUT + '/2-tv-planning.png' });
    const txt = await ph.textContent('#readyBtn');
    if (await ph.isDisabled('#readyBtn')) throw new Error('ready disabled: ' + txt);
    await ph.click('#readyBtn');
    await ph.waitForSelector('#locked:not(.hidden), #wait:not(.hidden)');
    if (round === 1) await ph.screenshot({ path: OUT + '/5-phone-locked.png' });
    await tv.waitForTimeout(2600);
    if (round === 2) await tv.screenshot({ path: OUT + '/6-tv-running.png' });
    // wait until the TV has replayed the round and opened the next one (or the game ended)
    await tv.waitForFunction(r => !document.querySelector('#over').classList.contains('hidden') || (Number(document.querySelector('#roundNum').textContent) > r && document.querySelector('#phaseText').textContent.includes('Plan')), round, { timeout: 120000 });
    if (round === ROUNDS - 1 || round === 3) await tv.screenshot({ path: OUT + `/7-tv-round${round}.png` });
    const over = await tv.isVisible('#over');
    if (over) break;
  }
  await tv.waitForTimeout(1000);
  await tv.screenshot({ path: OUT + '/8-tv-end.png' });
  await ph.screenshot({ path: OUT + '/9-phone-end.png' });
  console.log('round reached', await tv.textContent('#roundNum'), 'over', await tv.isVisible('#over'));
  console.log('errors:', JSON.stringify(errors, null, 1));
  await browser.close();
  if (errors.length) process.exit(2);
})().catch(e => { console.error(e); process.exit(1); });
