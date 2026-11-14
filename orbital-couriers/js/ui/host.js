// TV / host controller: runs the rules engine, talks to phones, draws the board.
import { CONFIG, CARDS } from '../config.js';
import { createGame, applyAction } from '../engine/engine.js';
import { publicView, privateView } from '../engine/views.js';
import { botProgram, botShop } from '../engine/bot.js';
import { makeRng } from '../engine/rng.js';
import { hostRoom, pickTransport } from '../../../shared/net.js';
import { createBoard, CARGO_ICON } from './board.js';
import { beatLines, cardText, esc, nameOf, planetName, cargoIcon } from './text.js';

const $ = s => document.querySelector(s);
const SAVE_KEY = 'oc-host-v1';
const MAX = 5, MIN = 3;
const BOT_NAMES = ['Vex', 'Rook', 'Juniper', 'Moth', 'Kestrel'];

let S = load() || { code: newCode(), lobby: [], game: null, animatedRound: 0, seats: [] };
let net = null, board = null, paused = false, animating = false, stood = false;
let viewSeq = Date.now(); // stamps views so phones can ignore ones that arrive out of order

// Players in the engine are seats ('p0'..'p4'); each seat maps to a phone id (never shown to other phones).
const seatOf = pid => (S.seats || []).find(x => x.pid === pid);
const seatById = id => (S.seats || []).find(x => x.seat === id);
const isBotSeat = id => { const x = seatById(id); return !x || x.bot; };
const botRng = makeRng(Date.now());

function newCode() {
  const A = 'BCDFGHJKLMNPQRSTVWXZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, t: Date.now() })); } catch (e) {} }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.game && !s.seats) s.game = null; // save from an older version
    if (s && Date.now() - s.t < 6 * 3600e3 && !new URLSearchParams(location.search).has('fresh')) return s;
  } catch (e) {}
  return null;
}

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
      if (info.ips && info.ips.length) {
        base = new URL(`http://${info.ips[0]}:${info.port}${location.pathname.replace(/[^/]*$/, '')}play.html`);
        if (info.ips.length > 1) note += ` If the QR doesn't work, try: ${info.ips.slice(1).map(ip => `${ip}:${info.port}`).join(', ')}`;
      }
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
  $('#footCode').textContent = 'Room ' + S.code + ' · ' + url.replace(/^https?:\/\//, '').replace(/\?.*/, '');
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
    const name = String(msg.name || 'Pilot').trim().slice(0, 12) || 'Pilot';
    if (!S.game) {
      const existing = S.lobby.find(p => p.pid === pid);
      if (existing) existing.name = name;
      else if (S.lobby.length < MAX) S.lobby.push({ pid, name, bot: false });
      else return net.send(pid, { type: 'full' });
      save(); renderLobby();
    } else {
      let seat = seatOf(pid);
      if (!seat) {
        // Same name as a human seat? Treat it as that player on a new browser/phone.
        seat = S.seats.find(x => !x.bot && S.game.players.find(p => p.id === x.seat).name.toLowerCase() === name.toLowerCase());
        if (!seat) return net.send(pid, { type: 'inProgress' });
        seat.pid = pid; save();
      }
      const p = S.game.players.find(x => x.id === seat.seat);
      if (p.auto && msg.reclaim) { p.auto = false; save(); renderGame(); }
    }
    pushAll();
    return;
  }
  if (msg.type === 'action' && S.game && msg.action && typeof msg.action === 'object') {
    const seat = seatOf(pid);
    if (!seat) return;
    const action = { ...msg.action, pid: seat.seat };
    if (action.type === 'continue') return; // only the TV advances resolution
    const r = applyAction(S.game, action);
    if (!r.ok) { net.send(pid, { type: 'reject', error: r.error, actionSeq: msg.seq }); pushAll(); return; }
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
  for (const x of S.seats) if (!x.bot) net.send(x.pid, { type: 'view', view: privateView(S.game, x.seat), seq: ++viewSeq });
}

function afterChange() {
  if (stood) return;
  save();
  pushAll();
  renderGame();
  driveBots();
  if (S.game && S.game.phase === 'resolve' && S.animatedRound !== S.game.round && !animating) animateResolve();
}

// Bots (practice bots, and humans switched to autopilot)
let botTimer = null;
function driveBots() {
  clearTimeout(botTimer);
  const g = S.game; if (!g) return;
  botTimer = setTimeout(() => {
    let changed = false;
    for (const p of g.players) {
      const isBot = isBotSeat(p.id) || p.auto;
      if (!isBot) continue;
      if (g.phase === 'program' && !p.ready) {
        applyAction(g, botProgram(g, p.id, { rng: botRng, noise: 4 })); changed = true;
      } else if (g.phase === 'shop' && !p.shopDone) {
        for (const a of botShop(g, p.id, 'balanced')) applyAction(g, a);
        changed = true;
      }
    }
    if (changed) afterChange();
  }, 900);
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
      ? `${shipIcon(c)}<span><b>${esc(p.name)}</b>${p.bot ? ' <span class="muted">(bot)</span>' : ''}</span><button class="x" data-i="${i}">remove</button>`
      : `<span class="muted">${i < MIN ? 'Waiting for a pilot…' : 'Open seat'}</span>`;
    slots.appendChild(d);
  }
  slots.querySelectorAll('.x').forEach(b => b.onclick = () => { S.lobby.splice(Number(b.dataset.i), 1); save(); renderLobby(); pushAll(); });
  $('#countLabel').textContent = `${S.lobby.length} / ${MAX}`;
  const okCount = S.lobby.length >= MIN;
  $('#startBtn').disabled = !okCount;
  $('#startBtn').textContent = okCount ? `Launch ${S.lobby.length}-player game` : `Launch (needs ${MIN})`;
  $('#addBot').disabled = S.lobby.length >= MAX;
}

function shipIcon(c) {
  return `<svg class="ship-ico" viewBox="-40 -40 80 80"><circle r="38" fill="${c}" opacity=".2"/><path d="M0,-30 L20,22 L0,12 L-20,22 Z" fill="${c}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>`;
}

$('#addBot').onclick = () => {
  if (S.lobby.length >= MAX) return;
  const used = new Set(S.lobby.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
  S.lobby.push({ pid: 'bot-' + Math.random().toString(36).slice(2, 7), name, bot: true });
  save(); renderLobby(); pushAll();
};
$('#startBtn').onclick = () => {
  if (S.lobby.length < MIN) return;
  S.seats = S.lobby.map((p, i) => ({ seat: 'p' + i, pid: p.pid, bot: p.bot }));
  S.game = createGame({ players: S.lobby.map((p, i) => ({ id: 'p' + i, name: p.name })), seed: Date.now() & 0x7fffffff });
  S.animatedRound = 0;
  board = null;
  banner(`<span class="title">Round 1</span>Plot your 3 moves on your phone`, 2600);
  afterChange();
};
$('#againBtn').onclick = () => { S.game = null; S.animatedRound = 0; board = null; save(); renderLobby(); pushAll(); };
$('#newBtn').onclick = () => {
  if (!confirmNew()) return;
  S.game = null; board = null; save(); renderLobby(); pushAll();
};
function confirmNew() {
  const b = $('#newBtn');
  if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'New game'; return true; }
  b.dataset.armed = '1'; b.textContent = 'Click again to quit';
  setTimeout(() => { delete b.dataset.armed; b.textContent = 'New game'; }, 3000);
  return false;
}
$('#pauseBtn').onclick = () => { paused = !paused; $('#pauseBtn').textContent = paused ? 'Resume' : 'Pause'; };
document.addEventListener('keydown', e => { if (e.code === 'Space' && S.game) { e.preventDefault(); $('#pauseBtn').click(); } });

// ---------------- game rendering ----------------
function show(id) { for (const s of ['#lobby', '#game', '#over']) $(s).classList.toggle('hidden', s !== id); }

function renderGame(viewOverride) {
  const g = S.game;
  if (!g) return renderLobby();
  const v = viewOverride || publicView(g);
  if (v.phase === 'over' && !animating) return renderOver(v);
  show('#game');
  // During a flight the animation owns the board and rail; don't show the result early.
  if (v.phase === 'resolve' && (animating || S.animatedRound !== v.round)) return;
  $('#game').classList.toggle('crowded', v.players.length >= 5);
  if (!board) board = createBoard($('#board'), v);
  board.updateContracts(v.contracts, v.players);
  board.updateShips(v.players);
  $('#roundNum').textContent = v.round;
  $('#roundMax').textContent = v.rounds;
  const phase = {
    program: `Plot 3 moves on your phone · <span class="muted">${v.players.filter(p => p.ready).length}/${v.players.length} locked</span>`,
    resolve: 'Flight in progress…',
    shop: `Shipyard open on phones · <span class="muted">${v.players.filter(p => p.shopDone).length}/${v.players.length} done</span>`,
    over: 'Game over',
  }[v.phase];
  if (!animating) $('#phaseText').innerHTML = phase;
  renderPlayers(v);
  renderContracts(v);
}

function renderPlayers(v, activeId) {
  const box = $('#players'); box.innerHTML = '';
  v.order.forEach((id, i) => {
    const p = v.players.find(x => x.id === id);
    const d = document.createElement('div');
    d.className = 'prow' + (activeId === id ? ' turn' : '');
    d.style.setProperty('--c', p.color);
    const holdBoxes = Array.from({ length: p.holdSize }, (_, k) => {
      const h = p.hold[k];
      if (!h) return '<i></i>';
      const col = h.salvage ? '#666' : (v.cfg.planets[h.to] || {}).color;
      return `<i class="full" style="background:${col}" title="${esc(h.cargo)}">${h.salvage ? '' : esc((v.cfg.planets[h.to] || {}).name || '?')[0]}</i>`;
    }).join('');
    const ups = Object.keys(v.cfg.upgrades).filter(k => p.upgrades[k]).map(k => `<span>${{ hold: 'Hold', hand: 'Card', boost: 'Burn+', shield: 'Shield' }[k] || k} ${'I'.repeat(p.upgrades[k])}</span>`).join('');
    let ready = '';
    if (v.phase === 'program') ready = p.auto ? '<span class="ready auto">AUTO</span>' : `<span class="ready ${p.ready ? 'on' : ''}">${p.ready ? 'READY' : 'plotting…'}</span>`;
    if (v.phase === 'shop') ready = `<span class="ready ${p.shopDone ? 'on' : ''}">${p.shopDone ? 'DONE' : 'shopping…'}</span>`;
    const isBot = isBotSeat(id);
    d.innerHTML = `<div class="order">${['1st', '2nd', '3rd', '4th', '5th'][i]}</div>
      <div class="name">${esc(p.name)}<span class="cap">${esc(v.cfg.captains[p.captain].name)}</span></div>
      <div class="score">${p.points}★</div>
      <div class="sub"><span class="cr">${p.credits}⬢</span><span class="hold">${holdBoxes}</span><span class="ups">${ups}</span>
      <span class="sub-right">${!isBot && (v.phase === 'program' || v.phase === 'shop') && !(v.phase === 'program' ? p.ready : p.shopDone) ? `<button class="autobtn" data-id="${esc(id)}">${p.auto ? 'take back' : 'autopilot'}</button>` : ''}${ready}</span></div>`;
    d.title = v.cfg.captains[p.captain].desc;
    box.appendChild(d);
  });
  box.querySelectorAll('.autobtn').forEach(b => b.onclick = () => {
    const p = S.game.players.find(x => x.id === b.dataset.id);
    p.auto = !p.auto; afterChange();
  });
}

function renderContracts(v) {
  const box = $('#contracts'); box.innerHTML = '';
  const carriedBy = c => v.players.filter(p => p.hold.some(h => h.cid === c.id && !h.salvage)).length;
  // Carried cargo shows in each player's hold, so the list only shows what can still be picked up.
  const list = [...v.contracts].filter(c => v.cfg.sharedCargo || !carriedBy(c)).sort((a, b) => b.points - a.points);
  for (const c of list) {
    const to = v.cfg.planets[c.to], from = v.cfg.planets[c.from];
    const carriers = v.players.filter(p => p.hold.some(h => h.cid === c.id && !h.salvage));
    const d = document.createElement('div');
    d.className = 'crow' + (v.phase === 'shop' && v.refilled.includes(c.id) ? ' fresh' : '') + (carriers.length && !v.cfg.sharedCargo ? ' carried' : '');
    d.style.setProperty('--c', to.color);
    d.innerHTML = `<div class="pts">${c.points}${c.bonus ? `<sup title="Unclaimed: worth more each round">+${c.bonus}</sup>` : ''}</div>
      <div class="route">${cargoIcon(c.cargo)} <b style="color:${from.color}">${esc(from.name)}</b> → <b style="color:${to.color}">${esc(to.name)}</b></div>
      <div class="carriers">${carriers.map(p => `<span class="carrier" style="--c:${p.color}">${esc(p.name)}</span>`).join('')}</div>`;
    box.appendChild(d);
  }
}

function log(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  const box = $('#log'); box.prepend(d);
  while (box.children.length > 30) box.lastChild.remove();
}

let bannerTimer;
function banner(html, ms = 1800) {
  const b = $('#banner'); b.innerHTML = html; b.classList.remove('hidden');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}

const SPEED = Number(new URLSearchParams(location.search).get('speed')) || 1; // ?speed=4 for quick tests
const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
async function waitWhilePaused() { while (paused) await sleep(200); }

// The public view as it was before this round's flight (from the engine's snapshot).
function preView(v) {
  if (!v.pre) return { ...v, players: v.players.map(p => ({ ...p })) };
  return { ...v, contracts: v.pre.contracts.map(c => ({ ...c })),
    players: v.players.map(p => ({ ...p, ...v.pre.players[p.id], hold: v.pre.players[p.id].hold.map(h => ({ ...h })) })) };
}

async function animateResolve() {
  animating = true;
  const g = S.game, round = g.round;
  try { await playFlight(g); }
  catch (e) { console.error('flight animation failed', e); }
  finally { animating = false; }
  if (stood || S.game !== g || g.round !== round || g.phase !== 'resolve') return;
  S.animatedRound = round;
  applyAction(g, { type: 'continue' });
  if (g.phase === 'shop') banner(`<span class="title">Shipyard open</span>New contracts arrived · buy upgrades on your phone`, 2600);
  if (g.phase === 'program') banner(`<span class="title">Round ${g.round}</span>Plot your moves`, 2200);
  afterChange();
}

async function playFlight(g) {
  const v = publicView(g);
  const round = g.round;
  if (!board) board = createBoard($('#board'), v);
  const step = CONFIG.resolveStepMs;
  const preview = preView(v);
  let pos = Object.fromEntries(preview.players.map(p => [p.id, [p.x, p.y]]));
  show('#game');
  renderPlayers(preview); renderContracts(preview);
  board.updateContracts(preview.contracts, preview.players);
  $('#phaseText').innerHTML = 'Launch!';
  board.updateShips(preview.players, pos);
  banner(`<span class="title">Launch!</span>Round ${round}`, 1300);
  log(`<b class="title" style="font-size:16px">— Round ${round} —</b>`);
  await sleep(1400);
  let lastStep = -1;
  for (const beat of v.beats) {
    await waitWhilePaused();
    if (stood || S.game !== g || !board) return;
    if (beat.step !== lastStep) {
      lastStep = beat.step;
      $('#phaseText').innerHTML = `Move ${beat.step + 1} of ${v.cfg.movesPerRound}`;
    }
    const mover = v.players.find(p => p.id === beat.id);
    $('#phaseText').innerHTML = `<span class="muted">Move ${beat.step + 1}/${v.cfg.movesPerRound}</span> · <b style="color:${mover.color}">${esc(mover.name)}</b> · ${cardText(beat.type, beat.dir)}`;
    renderPlayers(preview, beat.id);
    board.highlightShip(beat.id);
    const move = beat.events.find(e => e.t === 'move');
    // 1) fly the path
    const facing = beat.dir ? { [beat.id]: beat.dir } : {};
    const path = move.path;
    for (let i = 1; i < path.length; i++) {
      pos = { ...pos, [beat.id]: path[i] };
      board.updateShips(preview.players, pos, facing);
      await sleep(Math.max(140, step * 0.38));
    }
    if (path.length === 1) { board.updateShips(preview.players, pos, facing); await sleep(step * 0.3); }
    // 2) bumps / pulls / pickups
    for (const e of beat.events) {
      const at = pos[e.id] || [0, 0];
      if (e.t === 'bump') { pos = { ...pos, [e.victim]: e.to }; board.fx(e.from[0], e.from[1], e.moved ? 'BUMP!' : 'CLANG', 'bad'); }
      if (e.t === 'slingshot') board.fx(path[0][0], path[0][1], 'SLINGSHOT +1', 'purple');
      if (e.t === 'pull') { pos = { ...pos, [e.id]: e.to }; board.fx(e.from[0], e.from[1], 'PULL', 'purple'); }
      if (e.t === 'shield') board.fx(at[0], at[1], 'SHIELD', 'purple');
      if (e.t === 'blocked' && path.length === 1) board.fx(at[0], at[1], 'BLOCKED', 'bad');
    }
    if (beat.events.some(e => e.t === 'bump' || e.t === 'pull')) { board.updateShips(preview.players, pos, facing); await sleep(step * 0.6); }
    // apply cargo/score changes to the preview so the rail updates live
    for (const e of beat.events) {
      const pp = preview.players.find(p => p.id === e.id);
      if (e.t === 'load') { pp.hold = [...pp.hold, { cid: e.cid, cargo: e.cargo, to: e.to, salvage: false }]; board.fx(pos[e.id][0], pos[e.id][1], cargoIcon(e.cargo) + ' LOADED'); }
      if (e.t === 'deliver') { pp.hold = pp.hold.filter(h => h.cid !== e.cid); board.fx(pos[e.id][0], pos[e.id][1], `+${e.points}★`, 'gold'); preview.contracts = preview.contracts.filter(c => c.id !== e.cid); }
      if (e.t === 'salvaged') pp.hold = pp.hold.map(h => h.cid === e.cid ? { ...h, salvage: true } : h);
      if (e.t === 'sell') { pp.hold = pp.hold.filter(h => !h.salvage); board.fx(pos[e.id][0], pos[e.id][1], `+${e.credits}⬢`); }
    }
    for (const p of preview.players) { const sc = beat.score[p.id]; p.points = sc[0]; p.credits = sc[1]; }
    pos = { ...beat.pos }; // stay in sync with the engine
    board.updateShips(preview.players, pos);
    board.updateContracts(preview.contracts, preview.players);
    renderContracts(preview);
    for (const line of beatLines(v, beat)) log(line);
    const notable = beat.events.some(e => ['deliver', 'bump', 'load'].includes(e.t));
    await sleep(notable ? step * 1.3 : step * 0.6);
  }
  board.highlightShip(null);
  await sleep(600);
}

function renderOver(v) {
  show('#over');
  const pod = $('#podium'); pod.innerHTML = '';
  const order = v.standings;
  const places = ['1st', '2nd', '3rd', '4th', '5th'];
  const visual = order.length >= 3 ? [order[1], order[0], order[2], ...order.slice(3)] : order;
  for (const id of visual) {
    const p = v.players.find(x => x.id === id);
    const place = order.indexOf(id);
    const d = document.createElement('div');
    d.className = 'pod' + (place === 0 ? ' first' : '');
    d.style.setProperty('--c', p.color);
    d.innerHTML = `<div class="place">${places[place]}</div><div class="nm" style="color:${p.color}">${esc(p.name)}</div><div class="pt">${p.points}★</div><div class="muted">${p.deliveries} deliveries${p.endBonus ? ` · +${p.endBonus}★ from credits` : ''}</div><div class="muted">${esc(v.cfg.captains[p.captain].name)}</div>`;
    pod.appendChild(d);
  }
}

// When the TV page is refreshed mid-flight, replay or skip straight to the shop.
window.addEventListener('beforeunload', save);
if (S.game) { if (S.game.phase === 'resolve') S.animatedRound = 0; renderGame(); } else renderLobby();
startNet().then(() => afterChange());
