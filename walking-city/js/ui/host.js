// TV / host controller: runs the rules engine, talks to phones, draws the city.
import { CONFIG, CARDS } from '../config.js';
import { createGame, applyAction } from '../engine/engine.js';
import { publicView, privateView } from '../engine/views.js';
import { botPlan } from '../engine/bot.js';
import { resolveProduction } from '../engine/production.js';
import { makeRng } from '../engine/rng.js';
import { hostRoom, pickTransport } from '../../../shared/net.js';
import { createRing } from './ring.js';
import { crest, resIcon, resPath } from './art.js';
import { recapLines, esc, cardName, who } from './text.js';

const $ = s => document.querySelector(s);
const SAVE_KEY = 'wc-host-v1';
const BEST_KEY = 'wc-best-v1';
const MAX = CONFIG.maxPlayers, MIN = CONFIG.minPlayers;
const BOT_NAMES = ['Ada', 'Brick', 'Cog', 'Dottie', 'Ember'];

let S = load() || { code: newCode(), lobby: [], game: null, animatedRound: 0, storm: 'lightning', mode: 'first' };
if (!S.mode) S.mode = 'first';
let net = null, ring = null, paused = false, animating = false, stood = false, viewSeq = 0;
const botRng = makeRng(Date.now());

function newCode() {
  const A = 'BCDFGHJKLMNPQRSTVWXZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, t: Date.now() })); } catch (e) {} }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && Date.now() - s.t < 6 * 3600e3 && !new URLSearchParams(location.search).has('fresh')) return s;
  } catch (e) {}
  return null;
}
function best(N) { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}')[N] || null; } catch (e) { return null; } }
function setBest(N, v) { try { const b = JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); b[N] = v; localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) {} }

// ---------------- networking ----------------
async function startNet() {
  const kind = await pickTransport();
  try {
    net = await hostRoom(S.code, { onJoin: () => {}, onLeave: () => {}, onMessage: safeOnMessage, onReplaced }, kind);
  } catch (e) {
    $('#netNote').innerHTML = `<b style="color:var(--bad)">Couldn't open the room (${esc(e.type || e.message || e)}).</b> Refresh to try again, or run <code>node server.js</code> on this computer.`;
    return;
  }
  await showJoinInfo(kind);
  pushAll();
}

async function showJoinInfo(kind) {
  let base = new URL('play.html', location.href);
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  let note = kind === 'relay' ? 'Phones must be on the same Wi-Fi as this computer.' : kind === 'peer' ? 'Connected through the internet (PeerJS). Phones can use any network.' : 'Local test mode: open phones as tabs on this computer.';
  if (kind === 'relay' && local) {
    try {
      const info = await (await fetch(new URL('../../../relay/info', import.meta.url))).json();
      if (info.ips && info.ips.length) base = new URL(`http://${info.ips[0]}:${info.port}${location.pathname.replace(/[^/]*$/, '')}play.html`);
    } catch (e) {}
  } else if (kind === 'peer' && local) {
    note += ' <b>Heads-up:</b> this page is on "localhost", so phones can\'t open the link. Host it online or run <code>node server.js</code>.';
  }
  const params = new URLSearchParams(location.search);
  base.searchParams.set('room', S.code);
  for (const k of ['net', 'peerhost']) if (params.get(k)) base.searchParams.set(k, params.get(k));
  const url = base.toString();
  $('#joinUrl').textContent = url.replace(/^https?:\/\//, '');
  $('#roomCode').textContent = S.code;
  $('#footCode').textContent = 'Room ' + S.code;
  $('#netNote').innerHTML = note;
  try {
    const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
    $('#qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  } catch (e) { $('#qr').textContent = ''; }
}

function onReplaced() {
  stood = true; net = null; clearTimeout(botTimer);
  document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:28px;text-align:center;padding:40px">This game was opened in another tab or window.<br>Use that one, or refresh here to take it back.</div>';
}
function safeOnMessage(pid, msg) {
  if (stood) return;
  try { onMessage(pid, msg); } catch (e) { console.error('bad message', msg, e); }
}

function onMessage(pid, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hello') {
    const name = String(msg.name || 'Chief').trim().slice(0, 12) || 'Chief';
    if (!S.game) {
      const existing = S.lobby.find(p => p.pid === pid);
      if (existing) existing.name = name;
      else if (S.lobby.length < MAX) S.lobby.push({ pid, name, bot: false });
      else return net.send(pid, { type: 'full' });
      save(); renderLobby();
    } else if (!S.game.players.some(p => p.id === pid)) {
      return net.send(pid, { type: 'inProgress' });
    } else {
      const p = S.game.players.find(x => x.id === pid);
      if (p.auto && msg.reclaim) { p.auto = false; save(); renderGame(); }
    }
    pushAll();
    return;
  }
  if (msg.type === 'action' && S.game) {
    const action = { ...msg.action, pid };
    if (action.type === 'continue') return; // only the TV advances
    const r = applyAction(S.game, action);
    if (!r.ok) { net.send(pid, { type: 'reject', error: r.error }); pushAll(); return; }
    afterChange();
  }
}

function pushAll() {
  if (!net) return;
  if (!S.game) {
    const lobby = S.lobby.map((p, i) => ({ name: p.name, color: CONFIG.playerColors[i], bot: p.bot }));
    S.lobby.forEach((p, i) => { if (!p.bot) net.send(p.pid, { type: 'lobby', players: lobby, you: i, seq: ++viewSeq }); });
    return;
  }
  // While the TV replays a round, phones keep showing "watch the TV" (the engine already moved on).
  for (const p of S.game.players) if (!p.id.startsWith('bot-')) {
    const view = privateView(S.game, p.id);
    if (animating) view.replaying = true;
    // Phone ids double as relay credentials, so views only carry seat ids.
    for (const q of view.players) q.id = 'p' + q.seat;
    view.me.id = 'p' + view.me.seat;
    net.send(p.id, { type: 'view', view, seq: ++viewSeq });
  }
}

function afterChange() {
  if (stood) return;
  save();
  pushAll();
  renderGame();
  driveBots();
  if (S.game && S.game.phase === 'watch' && S.animatedRound !== S.game.round && !animating) animateRound();
}

// Bots (practice bots, and humans switched to autopilot)
let botTimer = null;
function driveBots() {
  clearTimeout(botTimer);
  const g = S.game; if (!g || g.phase !== 'plan') return;
  botTimer = setTimeout(() => {
    let changed = false;
    for (const p of g.players) {
      if (!(p.id.startsWith('bot-') || p.auto) || p.ready || g.phase !== 'plan') continue;
      const a = botPlan(g, p.id, { rng: botRng, noise: 2 });
      applyAction(g, a); changed = true;
    }
    if (changed) afterChange();
  }, 1200);
}

// ---------------- lobby ----------------
function renderLobby() {
  show('#lobby');
  const slots = $('#slots'); slots.innerHTML = '';
  for (let i = 0; i < MAX; i++) {
    const p = S.lobby[i];
    const c = CONFIG.playerColors[i];
    const d = document.createElement('div');
    d.className = 'slot' + (p ? ' filled' : '');
    d.style.setProperty('--c', c);
    d.innerHTML = p
      ? `${crest(c, 48)}<span><b>${esc(p.name)}</b>${p.bot ? ' <span class="muted">(bot)</span>' : ''}</span><button class="x" data-i="${i}">remove</button>`
      : `<span class="muted">${i < MIN ? 'Waiting for a chief…' : 'Open seat'}</span>`;
    slots.appendChild(d);
  }
  slots.querySelectorAll('.x').forEach(b => b.onclick = () => { S.lobby.splice(Number(b.dataset.i), 1); save(); renderLobby(); pushAll(); });
  $('#countLabel').textContent = `${S.lobby.length} / ${MAX}`;
  const ok = S.lobby.length >= MIN;
  $('#startBtn').disabled = !ok;
  $('#startBtn').textContent = ok ? `Start ${S.lobby.length}-player game` : `Start (needs ${MIN})`;
  $('#addBot').disabled = S.lobby.length >= MAX;
  document.querySelectorAll('[data-storm]').forEach(b => b.classList.toggle('on', b.dataset.storm === S.storm));
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
}
document.querySelectorAll('[data-storm]').forEach(b => b.onclick = () => { S.storm = b.dataset.storm; save(); renderLobby(); });
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; save(); renderLobby(); });

$('#addBot').onclick = () => {
  if (S.lobby.length >= MAX) return;
  const used = new Set(S.lobby.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
  S.lobby.push({ pid: 'bot-' + Math.random().toString(36).slice(2, 7), name, bot: true });
  save(); renderLobby(); pushAll();
};
$('#startBtn').onclick = () => {
  if (S.lobby.length < MIN) return;
  S.game = createGame({ players: S.lobby.map(p => ({ id: p.pid, name: p.name })), seed: Date.now() & 0x7fffffff, storm: S.storm, mode: S.mode });
  S.animatedRound = 0;
  ring = null;
  banner(`<span class="title">Round 1</span>Plan your district on your phone`, 2600);
  afterChange();
};
$('#againBtn').onclick = () => { S.game = null; S.animatedRound = 0; ring = null; save(); renderLobby(); pushAll(); };
$('#newBtn').onclick = () => {
  const b = $('#newBtn');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to quit'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'New game'; }, 3000); return; }
  S.game = null; ring = null; save(); renderLobby(); pushAll();
};
$('#pauseBtn').onclick = () => { paused = !paused; $('#pauseBtn').textContent = paused ? 'Resume' : 'Pause'; };
document.addEventListener('keydown', e => { if (e.code === 'Space' && S.game) { e.preventDefault(); $('#pauseBtn').click(); } });

// ---------------- game rendering ----------------
function show(id) { for (const s of ['#lobby', '#game', '#over']) $(s).classList.toggle('hidden', s !== id); }

// What the city would do this round if nobody built anything (shown while planning).
function projection(v) {
  const off = new Set(v.offNow);
  const prod = resolveProduction(v.districts, { disabled: off });
  return { prod, off, starved: new Map(prod.starved.map(s => [s.k, s.missing])) };
}

function renderGame() {
  const g = S.game;
  if (!g) return renderLobby();
  const v = publicView(g);
  if (v.phase === 'over' && !animating) return renderOver(v);
  show('#game');
  if (!ring) ring = createRing($('#ring'), v.N, v.players);
  $('#roundNum').textContent = v.round;
  $('#roundMax').textContent = v.maxRounds;
  if (animating) return;
  if (v.phase === 'plan') {
    const P = projection(v);
    ring.setTiles(v.districts, { active: new Set(P.prod.active), starved: P.starved, off: P.off });
    ring.setCore(v);
    ring.setReady(v);
    const n = v.players.filter(p => p.ready).length;
    $('#phaseText').innerHTML = `Plan on your phones · <span class="muted">${n}/${v.players.length} ready</span>`;
    renderStats(v, P.prod.strides);
    drawTrack(v, v.city, v.storm);
  }
  renderTwist(v);
  renderPlayers(v);
  if (!$('#log').dataset.round || Number($('#log').dataset.round) !== (v.last ? v.last.round : 0)) renderLog(v);
}

function renderStats(v, projected) {
  const gap = v.city - v.storm;
  $('#stats').innerHTML = `
    <div class="stat hud"><span class="k">City</span><span class="v" id="cityV">${v.city}<small>/${v.haven}</small></span></div>
    <div class="stat hud ${gap <= 6 ? 'danger' : ''}"><span class="k">Storm gap</span><span class="v">${gap}</span></div>
    ${verdict(v.speedNow, projected + v.bonus)}`;
}
// "Storm +6 vs City +4 → losing 2/round": the one number that matters while planning.
function verdict(storm, city) {
  const d = city - storm;
  return `<div class="stat hud ${d < 0 ? 'danger' : ''}"><span class="k">This round, as built</span><span class="v verdict"><span class="c-storm" style="white-space:nowrap">Storm +${storm}</span><br><span class="c-stride" style="white-space:nowrap">City +${city}</span><br>${d < 0 ? `<span class="c-bad">LOSING ${-d}</span>` : d > 0 ? `<span class="c-good">GAINING ${d}</span>` : 'HOLDING'}</span></div>`;
}
function renderTwist(v) {
  const icon = v.stormType === 'lightning' ? '⚡' : '≋';
  const tiers = Object.entries(v.cfg.tierUnlockRounds).filter(([t, r]) => r > v.round).map(([t, r]) => `Tier ${'I'.repeat(t)} cards arrive in round ${r}.`)[0] || 'All cards are in play.';
  $('#twist').innerHTML = `<div class="tw hud ${v.twist.now ? 'hot' : ''}"><span class="tw-ico">${icon}</span><span><b>${esc(v.stormInfo.name)}</b> · ${esc(v.twist.text)}</span></div>
    <div class="tw small muted">${tiers}</div>`;
}
function renderPlayers(v) {
  const box = $('#players'); box.innerHTML = '';
  for (const p of v.players) {
    const d = document.createElement('div');
    d.className = 'prow hud';
    d.style.setProperty('--c', p.color);
    const isBot = p.id.startsWith('bot-');
    let ready = '';
    if (v.phase === 'plan') ready = p.auto ? '<span class="ready auto">AUTO</span>' : `<span class="ready ${p.ready ? 'on' : ''}">${p.ready ? 'READY' : 'planning…'}</span>`;
    const crates = `${'<i class="crate s"></i>'.repeat(p.crates.supply)}${'<i class="crate p"></i>'.repeat(p.crates.part)}`;
    d.innerHTML = `${crest(p.color, 38)}<span class="name">${esc(p.name)}</span><span class="crates" title="crates">${crates}</span>
      <span class="sub-right">${!isBot && v.phase === 'plan' && !p.ready ? `<button class="autobtn" data-id="${esc(p.id)}">${p.auto ? 'take back' : 'autopilot'}</button>` : ''}${ready}</span>`;
    box.appendChild(d);
  }
  box.querySelectorAll('.autobtn').forEach(b => b.onclick = () => {
    const p = S.game.players.find(x => x.id === b.dataset.id);
    p.auto = !p.auto; afterChange();
  });
}
function renderLog(v, lines) {
  const box = $('#log');
  lines = lines || recapLines(v);
  box.dataset.round = v.last ? v.last.round : 0;
  $('#logTitle').textContent = v.last ? `Round ${v.last.round} recap` : 'Recap';
  box.innerHTML = lines.length ? lines.map(l => `<div>${l}</div>`).join('') : '<div class="muted">Each round, the TV runs the city and explains what happened here.</div>';
}

// ---------------- distance track ----------------
function drawTrack(v, city, storm) {
  const svg = $('#track');
  const H = 1000, top = 110, bot = 960;
  const min = v.cfg.stormStart - 2, max = v.haven;
  const y = p => bot - (Math.max(min, Math.min(max, p)) - min) / (max - min) * (bot - top);
  svg.setAttribute('viewBox', `0 0 170 ${H}`);
  let ticks = '';
  for (let p = 0; p <= max - 12; p += 10) ticks += `<line x1="70" x2="100" y1="${y(p)}" y2="${y(p)}" class="tick"/><text x="62" y="${y(p) + 7}" class="tick-t" text-anchor="end">${p}</text>`;
  const ys = y(storm), yc = y(city);
  let jag = `M0,${H} L0,${ys}`;
  for (let x = 0; x <= 170; x += 17) jag += ` L${x},${ys + (x / 17 % 2 ? -12 : 6)}`;
  jag += ` L170,${H} Z`;
  svg.innerHTML = `
    <defs><linearGradient id="stormG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4d6d" stop-opacity=".95"/><stop offset=".2" stop-color="#7a1530"/><stop offset="1" stop-color="#1a0610"/></linearGradient></defs>
    <rect x="76" y="${top}" width="18" height="${bot - top}" rx="9" class="rail-bar"/>
    ${ticks}
    <g transform="translate(85,${top - 20})"><path d="M-40,22 L-40,-8 A40,40 0 0 1 40,-8 L40,22" class="haven"/><text y="10" text-anchor="middle" class="haven-t">HAVEN</text></g>
    <path d="${jag}" fill="url(#stormG)" class="storm-band"/>
    <text x="85" y="${Math.min(H - 14, ys + 44)}" text-anchor="middle" class="storm-t">STORM</text>
    <g class="city-mark" transform="translate(85,${yc})">${cityIcon()}</g>
    <text x="150" y="${yc + 8}" class="city-t" text-anchor="middle">${city}</text>
    <path d="M128,${yc + 16} H138 V${ys - 4} H128" class="gap-line" stroke="${city - storm <= 6 ? '#ff4d3a' : '#8ea3bf'}"/>
    ${ys - yc > 60 ? `<text x="150" y="${(yc + ys) / 2 + 30}" text-anchor="middle" class="gap-t" fill="${city - storm <= 6 ? '#ff4d3a' : '#8ea3bf'}">gap</text><text x="150" y="${(yc + ys) / 2 + 52}" text-anchor="middle" class="gap-t" fill="${city - storm <= 6 ? '#ff4d3a' : '#8ea3bf'}">${city - storm}</text>` : ''}`;
}
function cityIcon() {
  return `<g transform="scale(1.1)"><path d="M-22,0 L-18,-20 L-8,-20 L-8,-30 L8,-30 L8,-20 L18,-20 L22,0 Z" fill="#dfe9f5" stroke="#0b0d14" stroke-width="3"/>
    <path d="M-16,0 L-24,22 M-6,0 L-9,22 M6,0 L9,22 M16,0 L24,22" stroke="#ff8f2e" stroke-width="5" stroke-linecap="round" class="walk"/>
    <rect x="-4" y="-16" width="8" height="8" fill="#0b0d14"/></g>`;
}

// ---------------- the round replay ----------------
let bannerTimer;
function banner(html, ms = 1800) {
  const b = $('#banner'); b.innerHTML = html; b.classList.remove('hidden');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wait(ms) { await sleep(ms); while (paused) await sleep(200); }

async function animateRound() {
  animating = true;
  const g = S.game, v = publicView(g), L = v.last, round = L.round;
  const step = CONFIG.resolveStepMs * (Number(new URLSearchParams(location.search).get('speed')) || 1);
  pushAll();
  if (!ring) ring = createRing($('#ring'), v.N, v.players);
  ring.setReady({ ...v, phase: 'watch' });
  $('#phaseText').innerHTML = 'The city is running…';
  drawTrack(v, L.before.city, L.before.storm);
  const off = new Set(L.prod.off), fresh = new Set(L.built), surge = new Set(L.surge);
  const lit = new Set();
  const lines = [];
  // 1) new buildings appear
  ring.setTiles(v.districts, { lit, off, fresh, surge, active: lit });
  banner(`<span class="title">Round ${round}</span>The city runs`, 1300);
  await wait(step * 1.4);
  for (const e of L.events.filter(e => e.t === 'build')) ring.fx(e.seat * 9 + e.tile, 'NEW', 'gold');
  if (off.size) { for (const k of off) ring.fx(k, v.stormType === 'lightning' ? '⚡ OFF' : 'BURIED', 'bad'); }
  if (L.events.some(e => e.t === 'build') || off.size) await wait(step);
  // 2) production waves
  for (let w = 0; w < L.prod.waves; w++) {
    const now = L.prod.active.filter(k => L.prod.wave[k] === w && !L.prod.fed.includes(k));
    now.forEach(k => lit.add(k));
    const fl = L.prod.flows.filter(f => L.prod.wave[f.to] === w);
    ring.flows(fl, step);
    await wait(step * 0.45);
    ring.setTiles(v.districts, { lit, off, fresh, surge, active: lit });
    await wait(step * 0.6);
  }
  // 3) emergency feed from crates
  for (const k of L.prod.fed) { lit.add(k); ring.fx(k, 'CRATES!', 'gold'); }
  if (L.prod.fed.length) { ring.setTiles(v.districts, { lit, off, fresh, surge, active: lit }); await wait(step); }
  // 4) starved buildings
  const starved = new Map(L.prod.starved.map(s => [s.k, s.missing]));
  ring.setTiles(v.districts, { lit, off, starved, surge, active: lit });
  if (starved.size) await wait(step);
  // 5) docks and the Main Drive
  const docks = L.events.filter(e => e.t === 'dock' || e.t === 'commit');
  for (const e of docks) ring.dock(e.t === 'dock' ? e.seat : e.to, 'part', step);
  if (docks.length) await wait(step);
  ring.setCore(v);
  if (L.stageDone != null) { ring.fx('core', `STAGE ${L.stageDone + 1}!`, 'gold'); banner(`<span class="title">Main Drive stage ${L.stageDone + 1}</span>+${L.events.find(e => e.t === 'stage').add} strides every round`, 2200); await wait(step * 2); }
  // 6) engines fire, the city walks
  for (const k of L.prod.active) {
    const card = v.districts[Math.floor(k / 9)][k % 9];
    if (card && CARDS[card.card].makes.stride) ring.fx(k, '+' + CARDS[card.card].makes.stride * (surge.has(k) ? 2 : 1), 'good');
  }
  await wait(step * 0.8);
  const c0 = L.before.city;
  for (let i = 1; i <= 12; i++) { drawTrack(v, Math.round(c0 + (L.city - c0) * i / 12), L.before.storm); await sleep(45); }
  if ($('#cityV')) $('#cityV').innerHTML = `${L.city}<small>/${v.haven}</small>`;
  await wait(step * 0.6);
  // 7) storm
  if (L.outcome !== 'won') {
    const s0 = L.before.storm;
    for (let i = 1; i <= 12; i++) { drawTrack(v, L.city, Math.round(s0 + (L.storm - s0) * i / 12)); await sleep(55); }
  }
  renderLog(v);
  const n = recapLines(v).length;
  await wait(step * Math.min(5, 1.6 + n * 0.5));
  animating = false;
  if (S.game !== g || g.phase !== 'watch') return;
  S.animatedRound = round;
  applyAction(g, { type: 'continue' });
  if (g.phase === 'plan') {
    const unlock = Object.entries(g.cfg.tierUnlockRounds).find(([t, r]) => r === g.round && t !== '1');
    banner(`<span class="title">Round ${g.round}</span>${unlock ? `New Tier ${'I'.repeat(unlock[0])} cards in the deck!` : 'Plan on your phones'}`, 2400);
  }
  afterChange();
}

function renderOver(v) {
  show('#over');
  const won = v.outcome === 'won';
  const dist = Math.min(v.city, v.haven);
  const prev = best(v.N);
  const isBest = !prev || dist > prev.dist || (won && (!prev.won || v.round < prev.round));
  if (isBest && S.savedBestFor !== S.game.seed) { setBest(v.N, { dist, won, round: v.round }); S.savedBestFor = S.game.seed; save(); }
  const stats = v.players.map(p => `<div class="ost hud" style="--c:${p.color}">${crest(p.color, 40)}<b>${esc(p.name)}</b><span>${p.stats.builds} built · ${p.stats.passedBuilt} gifts used · ${p.stats.commits} crate${p.stats.commits===1?'':'s'} to the Drive</span></div>`).join('');
  $('#overBox').innerHTML = `
    <h1 class="logo big">${won ? 'You reached the Haven!' : 'The storm caught the city'}</h1>
    <p class="over-sub">${won ? `In ${v.round} rounds, with the storm ${v.city - v.storm} strides behind.` : v.outcome === 'timeout' ? `Out of time after ${v.round} rounds.` : `In round ${v.round}.`}</p>
    <div class="score-big"><span>${dist}</span><small>/ ${v.haven} strides</small></div>
    <p class="muted">${prev ? `Best with ${v.N} players: ${prev.dist}${prev.won ? ` (won in round ${prev.round})` : ''}${isBest ? ' · <b class="c-gold">new best!</b>' : ''}` : 'First run with this many players: that\'s your best to beat.'}</p>
    <div class="ostats">${stats}</div>`;
}

window.addEventListener('beforeunload', save);
if (S.game) { if (S.game.phase === 'watch') S.animatedRound = 0; renderGame(); } else renderLobby();
startNet().then(() => afterChange());
