// End-to-end smoke test: a TV page, one phone, two practice bots, one full round.
// Needs `node server.js` running.  Run: node test/smoke.cjs [outDir]
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = process.env.BASE || 'http://localhost:8080';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('console', m => { if (m.type() === 'error') errors.push('TV: ' + m.text()); });
  tv.on('pageerror', e => errors.push('TV pageerror: ' + e.message));
  await tv.goto(BASE + '/orbital-couriers/host.html?fresh=1' + (process.env.QUERY || ''));
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#roomCode').textContent));
  const code = await tv.textContent('#roomCode');
  console.log('code', code, 'join', await tv.textContent('#joinUrl'));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // BLOCK_RTC=1 simulates a network that blocks the direct phone-to-TV link, to exercise the relay fallback.
  if (process.env.BLOCK_RTC) await ctx.addInitScript(() => {
    const Real = window.RTCPeerConnection;
    window.RTCPeerConnection = function (cfg) { return new Real({ ...(cfg || {}), iceServers: [], iceTransportPolicy: 'relay' }); };
    window.RTCPeerConnection.prototype = Real.prototype;
  });
  const ph = await ctx.newPage();
  ph.on('console', m => { if (process.env.DEBUG) console.log('PH', m.type(), m.text()); if (m.type() === 'error') errors.push('PH: ' + m.text()); });
  ph.on('pageerror', e => errors.push('PH pageerror: ' + e.message));
  await ph.goto(BASE + '/orbital-couriers/play.html?room=' + code + (process.env.QUERY || ''));
  await ph.fill('#nameIn', 'Brendan');
  await ph.click('#joinBtn'); if (process.env.DEBUG) console.log('joined');
  await ph.waitForSelector('#wait:not(.hidden)');
  for (let i = 0; i < (Number(process.env.BOTS) || 2); i++) await tv.click('#addBot');
  await tv.waitForTimeout(600);
  await tv.screenshot({ path: OUT + '/tv-lobby.png' });
  await ph.screenshot({ path: OUT + '/ph-lobby.png' });
  await tv.click('#startBtn');
  await ph.waitForSelector('#program:not(.hidden)');
  await tv.waitForTimeout(3000);
  await tv.screenshot({ path: OUT + '/tv-program.png' });
  for (let round = 1; round <= (Number(process.env.ROUNDS) || 1); round++) {
    await ph.waitForSelector('#program:not(.hidden)', { timeout: 90000 });
    for (let i = 0; i < 3; i++) {
      const cards = await ph.$$('#hand .card:not(.used)');
      await cards[0].click();
      if (await ph.isVisible('#dirPad')) {
        if (round === 1 && i === 1) await ph.screenshot({ path: OUT + '/ph-dir.png' });
        await ph.click('#dirPad [data-d="' + 'SENW'[(round + i) % 4] + '"]');
      }
    }
    if (round === 1) await ph.screenshot({ path: OUT + '/ph-program.png' });
    await ph.click('#readyBtn');
    if (round === 1) { await tv.waitForTimeout(3500); await tv.screenshot({ path: OUT + '/tv-resolve.png' }); }
    await ph.waitForSelector('#shop:not(.hidden), #wait:not(.hidden) >> text=place', { timeout: 90000 }).catch(() => {});
    if (await ph.isVisible('#shop')) {
      if (round === 1) { await tv.screenshot({ path: OUT + '/tv-shop.png' }); await ph.screenshot({ path: OUT + '/ph-shop.png' }); }
      const buy = await ph.$('#shopList .btn.gold:not([disabled])');
      if (buy) await buy.click();
      await ph.waitForTimeout(300);
      await ph.click('#shopDone');
    }
  }
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: OUT + '/tv-end.png' });
  await ph.screenshot({ path: OUT + '/ph-end.png' });
  console.log('errors:', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
