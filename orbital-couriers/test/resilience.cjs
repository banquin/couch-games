// Resilience test: TV refresh mid-flight, phone refresh mid-plan, then a full game to the podium.
// Needs `node server.js` running.  Run: node test/resilience.cjs [outDir]
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const BASE = (process.env.BASE || 'http://localhost:8080') + '/orbital-couriers';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', e => errors.push(tag + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|404|fonts/.test(m.text())) errors.push(tag + ': ' + m.text()); });
  };
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage(); watch(tv, 'TV');
  await tv.goto(BASE + '/host.html?fresh=1&speed=6');
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('#roomCode').textContent));
  const code = await tv.textContent('#roomCode');
  const phCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ph = await phCtx.newPage(); watch(ph, 'PH');
  await ph.goto(BASE + '/play.html?room=' + code);
  await ph.fill('#nameIn', 'Brendan'); await ph.click('#joinBtn');
  await ph.waitForSelector('#wait:not(.hidden)');
  for (let i = 0; i < 3; i++) await tv.click('#addBot');
  await tv.click('#startBtn');

  const plan = async () => {
    await ph.waitForSelector('#program:not(.hidden)', { timeout: 60000 });
    await ph.waitForTimeout(300);
    for (let guard = 0; guard < 12; guard++) {
      if ((await ph.$$('#slots .slot.filled')).length >= 3) break;
      if (await ph.isVisible('#dirPad')) await ph.click('#dirPad [data-d="' + 'NESW'[Math.floor(Math.random() * 4)] + '"]');
      else await ph.click('#hand .card:not(.used) >> nth=0');
      await ph.waitForTimeout(150);
    }
    await ph.waitForTimeout(700);
    await ph.click('#readyBtn');
  };
  const shop = async () => {
    await ph.waitForSelector('#shop:not(.hidden)', { timeout: 60000 });
    await ph.waitForTimeout(700);
    await ph.click('#shopDone');
  };

  // Round 1: refresh the TV in the middle of the flight.
  const before = await ph.textContent('#meScore');
  await plan();
  await tv.waitForTimeout(1200);
  await tv.goto(BASE + '/host.html?speed=6'); // a refresh (without ?fresh, which starts over)
  await ph.waitForTimeout(500);
  const during = await ph.textContent('#meScore');
  await shop();
  console.log(`round 1 ok (TV refreshed mid-flight); phone score before ${before}, during flight ${during}`);

  // Round 2: refresh the phone in the middle of planning.
  await ph.waitForSelector('#program:not(.hidden)', { timeout: 60000 });
  await ph.waitForTimeout(300);
  const cards = await ph.$$('#hand .card:not(.used)'); await cards[0].click();
  await ph.reload();
  await ph.waitForSelector('#program:not(.hidden)', { timeout: 30000 });
  console.log('phone refresh mid-plan ok');

  for (let r = 2; r <= 8; r++) {
    await plan();
    if (r < 8) await shop();
  }
  await ph.waitForSelector('#waitTitle >> text=/place/', { timeout: 120000 });
  await tv.waitForSelector('#over:not(.hidden)', { timeout: 120000 });
  await tv.screenshot({ path: OUT + '/tv-over.png' });
  await ph.screenshot({ path: OUT + '/ph-over.png' });
  console.log('game over reached:', (await ph.textContent('#waitTitle')).trim());
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
