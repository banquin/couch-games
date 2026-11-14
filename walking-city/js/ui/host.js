// TV / host: runs the rules engine, talks to phones, draws the city. Rules live in ../engine; art in ./icons.js + ./board.js.
import { CONFIG, DEPTS, DEPT_INFO, MACHINES, TERRAIN, TECHS, OVERCLOCK } from '../config.js';
import { THEME } from '../theme.js';
import * as E from '../engine/engine.js';
import { planBots } from '../engine/bots.js';
import { publicView, privateView } from '../engine/views.js';
import { hostRoom, pickTransport } from '../../../shared/net.js';
import { makeScene, ORDER } from './scene.js';
import { resIcon, deptBadge } from './icons.js';
import { recapLines, esc, dn, dc, tag, W, terrainLine, COLS } from './text.js';

const $ = s => document.querySelector(s);
const SAVE_KEY = 'wc3-host';
const BEST_KEY = 'wc3-best';
const SPEED = Number(new URLSearchParams(location.search).get('speed')) || 1;

const sceneReady = makeScene().then(s => { scene = s; if (S.game) render(); return s; });
let S = load() || { code: newCode(), players: [], seats: {}, game: null, animatedRound: 0, mode: 'first' };
let net = null, paused = false, animating = false, stood = false, viewSeq = 0, scene = null;

function newCode() { const A = 'BCDFGHJKLMNPQRSTVWXZ'; return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, t: Date.now() })); } catch (e) {} }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && Date.now() - s.t < 6 * 3600e3 && !new URLSearchParams(location.search).has('fresh')) return s;
  } catch (e) {}
  return null;
}
function best(mode) { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}')[mode] || null; } catch (e) { return null; } }
function setBest(mode, v) { try { const b = JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); b[mode] = v; localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) {} }

// ---------------- static text from the theme ----------------
$('#logo').innerHTML = `${esc(THEME.title[0])}<br><b>${esc(THEME.title[1])}</b>`;
$('#tagline').textContent = THEME.tagline;
document.title = THEME.title.join(' ') + ' · TV';
$('#howto').innerHTML = [
  `There are always five cars. Pick one on your phone; bots run the rest.`,
  `Each round, everyone plans at once: build or upgrade one machine, move machines, set your dials, and pledge your output to the others.`,
  `Your phone shows what the others are asking of you. ${dn('power')} and ${dn('fab')} feed everyone. ${dn('loco')} turns ${W.power} and ${W.gears} into ${W.strides}.`,
  `Only ${dn('shield')} sees where ${W.lightning} strikes. Only ${dn('research')} sees the road ahead and the techs on offer. Talk!`,
  `Then the TV runs the whole ${W.city} and shows what slowed you down. Reach the ${W.haven} before the ${W.storm} catches you.`,
].map(s => `<li>${s}</li>`).join('');

// ---------------- networking ----------------
async function startNet() {
  const kind = await pickTransport();
  let codeChanged = false;
  for (let tries = 0; ; tries++) {
    try {
      net = await hostRoom(S.code, { onJoin: () => {}, onLeave: () => {}, onMessage: safeOnMessage, onReplaced, idRetries: S.game ? 6 : 0 }, kind);
      break;
    } catch (e) {
      if (e && e.type === 'unavailable-id' && tries < 3) { S.code = newCode(); save(); codeChanged = true; continue; }
      $('#netNote').innerHTML = `<b style="color:var(--bad)">Couldn't open the room (${esc(e.type || e.message || e)}).</b> Refresh to try again, or run <code>node server.js</code> on this computer.`;
      return;
    }
  }
  await showJoinInfo(kind);
  if (codeChanged) $('#netNote').innerHTML = '<b>New room code ' + S.code + '.</b> The old one was still in use (is another TV tab open?). Everyone scan the new QR code. ' + $('#netNote').innerHTML;
  pushAll();
}
async function showJoinInfo(kind) {
  let base = new URL('play.html', location.href);
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  let note = kind === 'relay' ? 'Phones must be on the same Wi-Fi as this computer.' : kind === 'peer' ? 'Connected through the internet. Phones can use any network.' : 'Local test mode: open phones as tabs on this computer.';
  if (kind === 'relay' && local) {
    try {
      const info = await (await fetch(new URL('../../../relay/info', import.meta.url))).json();
      if (info.ips && info.ips.length) base = new URL(`http://${info.ips[0]}:${info.port}${location.pathname.replace(/[^/]*$/, '')}play.html`);
    } catch (e) {}
  } else if (kind === 'peer' && local) note += ' <b>Heads-up:</b> this page is on "localhost", so phones can\'t open the link. Host it online or run <code>node server.js</code>.';
  const params = new URLSearchParams(location.search);
  base.searchParams.set('room', S.code);
  for (const k of ['net', 'peerhost']) if (params.get(k)) base.searchParams.set(k, params.get(k));
  const url = base.toString();
  $('#joinUrl').textContent = url.replace(/^https?:\/\//, '');
  $('#roomCode').textContent = S.code;
  $('#footCode').textContent = 'Room ' + S.code;
  $('#netNote').innerHTML = note;
  try { const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make(); $('#qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (e) { $('#qr').textContent = ''; }
}
function onReplaced() {
  stood = true; net = null; clearTimeout(botTimer);
  document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:28px;text-align:center;padding:40px">This game was opened in another tab or window.<br>Use that one, or refresh here to take it back.</div>';
}
function safeOnMessage(pid, msg) { if (stood) return; try { onMessage(pid, msg); } catch (e) { console.error('bad message', msg, e); } }

const seatOf = pid => DEPTS.find(d => S.seats[d] && S.seats[d].pid === pid) || null;
function onMessage(pid, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hello') {
    const name = String(msg.name || 'Chief').trim().slice(0, 12) || 'Chief';
    const p = S.players.find(x => x.pid === pid);
    if (p) p.name = name; else S.players.push({ pid, name });
    const d = seatOf(pid);
    if (d) S.seats[d].name = name;
    if (S.game && d && S.game.depts[d].auto && msg.reclaim) { S.game.depts[d].auto = false; S.game.depts[d].ready = false; }
    save(); afterChange(); return;
  }
  if (msg.type === 'claim') {
    const d = msg.dept;
    if (!DEPTS.includes(d)) return;
    const mine = seatOf(pid);
    if (S.game) {
      // mid-game: you may take a bot-run seat (or your own back)
      const dep = S.game.depts[d];
      if (dep.seat && dep.seat.pid !== pid && !dep.auto) return net.send(pid, { type: 'reject', error: `${dn(d)} is taken.` });
      if (mine && mine !== d) { S.game.depts[mine].seat = null; delete S.seats[mine]; }
      const p = S.players.find(x => x.pid === pid);
      S.seats[d] = { pid, name: p ? p.name : 'Chief' };
      dep.seat = { pid, name: S.seats[d].name }; dep.auto = false; dep.ready = false;
    } else {
      if (S.seats[d] && S.seats[d].pid !== pid) return net.send(pid, { type: 'reject', error: `${dn(d)} is taken.` });
      if (mine) delete S.seats[mine];
      const p = S.players.find(x => x.pid === pid);
      S.seats[d] = { pid, name: p ? p.name : 'Chief' };
    }
    save(); afterChange(); return;
  }
  if (msg.type === 'unclaim' && !S.game) { const d = seatOf(pid); if (d) delete S.seats[d]; save(); afterChange(); return; }
  if (!S.game) return;
  const d = seatOf(pid);
  if (!d) return;
  const g = S.game;
  if (msg.type === 'action') {
    const a = msg.action || {};
    if (a.type === 'autopilot') {
      if (g.phase !== 'plan') return;
      planBots(g, [d], {});
      net.send(pid, { type: 'toast', text: 'Autopilot filled in a plan. Check it, then tap Ready.' });
      afterChange(); return;
    }
    if (a.type === 'draft' || a.type === 'ready' || a.type === 'unready') {
      const r = E.applyAction(g, { ...a, dept: d });
      if (r.error) net.send(pid, { type: 'reject', error: r.error });
      if (a.type === 'ready') g.depts[d].readyPledge = pledgeTo(g, d);
      afterChange();
    }
  }
}
// what's promised to a department right now (to notice when it drops after Ready)
function pledgeTo(g, d) {
  return { power: (g.depts.power.plan.outbox[d] || {}).power || 0, plates: (g.depts.fab.plan.outbox[d] || {}).plates || 0 };
}

// ---------------- pushing views ----------------
let pushTimer = null;
function pushAll() { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 30); }
function pushNow() {
  if (!net) return;
  const claims = Object.fromEntries(DEPTS.map(d => [d, S.seats[d] ? S.seats[d].name : null]));
  for (const p of S.players) {
    const d = seatOf(p.pid);
    if (!S.game) { net.send(p.pid, { type: 'lobby', claims, you: d, mode: S.mode, seq: ++viewSeq }); continue; }
    if (!d) { net.send(p.pid, { type: 'pick', claims: Object.fromEntries(DEPTS.map(x => [x, S.game.depts[x].seat && !S.game.depts[x].auto ? S.game.depts[x].seat.name : null])), seq: ++viewSeq }); continue; }
    const v = privateView(S.game, d);
    if (animating) v.replaying = true;
    net.send(p.pid, { type: 'view', view: v, seq: ++viewSeq });
  }
}

// ---------------- game flow ----------------
function botDepts() { const g = S.game; return DEPTS.filter(d => !g.depts[d].seat || g.depts[d].auto); }
let botTimer = null, lastHumanSig = '';
function humanSig(g) { return JSON.stringify(DEPTS.filter(d => g.depts[d].seat && !g.depts[d].auto).map(d => [d, g.depts[d].plan.asks, g.depts[d].plan.outbox, g.depts[d].plan.recipe, g.depts[d].plan.route, g.depts[d].plan.overclock])); }
function driveBots(force) {
  const g = S.game; if (!g || g.phase !== 'plan') return;
  const humansReady = DEPTS.every(d => !g.depts[d].seat || g.depts[d].auto || g.depts[d].ready);
  const sig = humanSig(g);
  if (!force && (sig === lastHumanSig || humansReady)) return;
  lastHumanSig = sig;
  clearTimeout(botTimer);
  botTimer = setTimeout(() => {
    if (!S.game || S.game.phase !== 'plan') return;
    const bots = botDepts();
    planBots(S.game, bots, {});
    for (const d of bots) S.game.depts[d].ready = true;
    lastHumanSig = humanSig(S.game);
    afterChange(true);
  }, force ? 50 : 500);
}
function checkPledgeDrops(g) {
  for (const d of DEPTS) {
    const x = g.depts[d];
    if (!x.seat || x.auto || !x.ready || !x.readyPledge) continue;
    const now = pledgeTo(g, d);
    const draw = x.plan.asks.power;
    if ((now.power < x.readyPledge.power && now.power < draw) || (now.plates < x.readyPledge.plates && now.plates < x.plan.asks.plates)) {
      x.ready = false;
      if (net) net.send(x.seat.pid, { type: 'toast', text: `A pledge to you dropped (${W.power} ${x.readyPledge.power}→${now.power}). Check your plan and tap Ready again.` });
    }
  }
}
function afterChange(fromBots) {
  if (stood) return;
  const g = S.game;
  if (g && g.phase === 'plan') {
    checkPledgeDrops(g);
    if (!fromBots) driveBots();
    if (E.allReady(g)) {
      planBots(g, botDepts(), {}); // final fit to the humans' final plans
      for (const d of botDepts()) g.depts[d].ready = true;
      E.resolveRound(g);
    }
  }
  save();
  pushAll();
  render();
  if (S.game && (S.game.phase === 'watch' || S.game.phase === 'over') && S.animatedRound !== S.game.round && !animating) animateRound();
}

// ---------------- lobby ----------------
function show(id) { for (const s of ['#lobby', '#game', '#over']) $(s).classList.toggle('hidden', s !== id); }
function renderLobby() {
  show('#lobby');
  const slots = $('#slots');
  slots.innerHTML = DEPTS.map(d => {
    const info = DEPT_INFO[d], s = S.seats[d];
    return `<div class="slot ${s ? 'filled' : ''}" style="--c:${info.color}">
      ${deptBadge(info.color, info.short[0], 44)}
      <div class="slot-main"><b>${esc(info.name)}</b> <span class="pips">${'●'.repeat(info.difficulty)}${'○'.repeat(3 - info.difficulty)}</span><div class="muted slot-blurb">${esc(info.blurb)}</div></div>
      <div class="slot-who">${s ? esc(s.name) : '<span class="muted">Bot</span>'}</div>
      ${s ? `<button class="x" data-d="${d}">✕</button>` : ''}</div>`;
  }).join('');
  slots.querySelectorAll('.x').forEach(b => b.onclick = () => { delete S.seats[b.dataset.d]; save(); renderLobby(); pushAll(); });
  const unseated = S.players.filter(p => !seatOf(p.pid));
  $('#startBtn').textContent = Object.keys(S.seats).length ? `Start with ${Object.keys(S.seats).length} ${Object.keys(S.seats).length === 1 ? 'player' : 'players'} + bots` : 'Start (all bots: watch a demo)';
  $('#startBtn').title = unseated.length ? `${unseated.map(p => p.name).join(', ')} still choosing` : '';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
}
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; save(); renderLobby(); pushAll(); });
$('#startBtn').onclick = () => {
  const seats = {};
  for (const d of DEPTS) if (S.seats[d]) seats[d] = { pid: S.seats[d].pid, name: S.seats[d].name };
  S.game = E.createGame({ seats, seed: Date.now() & 0x7fffffff, mode: S.mode });
  S.animatedRound = 0; lastHumanSig = '';
  banner(`<span class="title">Round 1</span>Plan on your phones`, 2600);
  driveBots(true);
  afterChange();
};
$('#againBtn').onclick = () => { S.game = null; S.animatedRound = 0; save(); renderLobby(); pushAll(); };
$('#newBtn').onclick = () => {
  const b = $('#newBtn');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to quit'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'New game'; }, 3000); return; }
  S.game = null; save(); renderLobby(); pushAll();
};
$('#pauseBtn').onclick = () => { paused = !paused; $('#pauseBtn').textContent = paused ? 'Resume' : 'Pause'; };
document.addEventListener('keydown', e => { if (e.code === 'Space' && S.game) { e.preventDefault(); $('#pauseBtn').click(); } });

// ---------------- game screen ----------------
let shownEv = null; // the round being animated (beats revealed so far)
function render() {
  const g = S.game;
  if (!g) return renderLobby();
  if (g.phase === 'over' && !animating && S.animatedRound === g.round) return renderOver();
  show('#game');
  const v = publicView(g, { projection: g.phase === 'plan' });
  // before a round's replay starts, keep showing where the train was
  const track = animating && shownEv ? shownEv.track : (g.phase !== 'plan' && g.last && S.animatedRound !== g.last.round ? g.last.before : null);
  if (scene) scene.draw(v, { shownEv: animating ? shownEv : null, track });
  if (scene && scene.kind === '3d') { renderLabels(v); renderRaceBar(v, track); }
  bindSeatButtons();
  renderCenter(v);
  $('#footLine').innerHTML = footLine(v);
}
// 3D mode: HTML labels pinned above each car, and a race bar across the top.
function renderLabels(v) {
  $('#carLabels').innerHTML = ORDER.map((d, i) => {
    const x = v.depts[d];
    return `<div class="car-label" data-car="${d}" style="--c:${dc(d)}"><span class="cl-n">${i + 1}</span><span class="cl-name">${esc(dn(d))}</span>
      <span class="cl-who">${x.seat ? esc(x.seat.name) + (x.auto ? ' (auto)' : '') : 'bot'}</span>
      ${v.phase === 'plan' ? `<span class="cl-lamp ${x.ready ? 'on' : ''}">${x.ready ? 'READY' : '…'}</span>` : ''}
      ${x.seat ? `<button class="cl-auto ${x.auto ? 'on' : ''}" data-auto="${d}">${x.auto ? 'Give back' : 'Autopilot'}</button>` : ''}</div>`;
  }).join('');
}
function renderRaceBar(v, track) {
  const city = track ? track.city : v.city, storm = track ? track.storm : v.storm;
  const lo = Math.min(v.stormStart, 0), hi = v.haven, pct = p => Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100));
  $('#raceBar').innerHTML = `<div class="rb-top"><span class="rb-freeze">${esc(W.Storm.toUpperCase())} · ${Math.max(0, city - storm)} ${esc(W.strides.toUpperCase())} BEHIND</span>
    <span class="rb-goal">${esc(W.haven.toUpperCase())} · ${Math.max(0, hi - city)} ${esc(W.strides.toUpperCase())}</span></div>
    <div class="rb-track"><i class="rb-storm" style="width:${pct(storm)}%"></i><b class="rb-train" style="left:${pct(city)}%"></b></div>`;
}
function bindSeatButtons() {
  document.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => {
    const d = b.dataset.auto, dep = S.game.depts[d];
    dep.auto = !dep.auto; if (!dep.auto) dep.ready = false;
    if (dep.auto) driveBots(true);
    save(); afterChange();
  });
}
function footLine(v) {
  if (v.phase === 'plan') {
    const waiting = DEPTS.filter(d => !v.depts[d].ready);
    return waiting.length ? `Waiting for ${waiting.map(d => `${tag(d)} (${esc(v.depts[d].seat ? v.depts[d].seat.name : 'bot')})`).join(', ')}` : 'Everyone is ready';
  }
  if (v.last && v.last.ev.blame && !animating) return `<span class="c-bad">Lost ${v.last.ev.blame.lost} ${W.strides}:</span> ${esc(v.last.ev.blame.steps.join(' ← '))}`;
  return '';
}

function renderCenter(v) {
  const c = $('#center');
  if (animating && shownEv) { c.innerHTML = watchBoard(v); return; }
  const p = v.projection;
  const planned = p ? p.dist : 0;
  const gap = v.city - v.storm;
  const verdict = planned - v.speedNow;
  const supply = (k, have, ask) => `<div class="sup ${have < ask ? 'short' : ''}"><span class="sup-k">${resIcon(k, 26)} ${esc(W[k] || k)}</span><span class="sup-v">${have} <small>/ asked ${ask}</small></span></div>`;
  const D = v.depts;
  const pwAsk = ['fab', 'loco', 'shield', 'research'].reduce((s, d) => s + D[d].asks.power, 0);
  const pwPledge = ['fab', 'loco', 'shield', 'research'].reduce((s, d) => s + ((D.power.outbox[d] || {}).power || 0), 0);
  const plAsk = ['power', 'loco', 'shield', 'research'].reduce((s, d) => s + D[d].asks.plates, 0);
  const plPledge = ['power', 'loco', 'shield', 'research'].reduce((s, d) => s + ((D.fab.outbox[d] || {}).plates || 0), 0);
  const fork = v.fork ? v.fork.map((t, i) => `<div class="fork ${v.route === i ? 'on' : ''}"><b>${esc(TERRAIN[t].name)}</b><span>${TERRAIN[t].grade !== 1 ? '×' + TERRAIN[t].grade + ' ' + W.strides : esc(TERRAIN[t].text)}</span></div>`).join('') : '';
  c.innerHTML = `
    <div class="c-round"><span class="title">Round ${v.round}</span><span class="muted"> / ${v.rounds}</span><span class="c-mode muted">${esc(v.modeName)}</span></div>
    <div class="c-race">
      <div class="race-cell"><span class="k">${esc(W.Storm)} this round</span><span class="v c-storm">+${v.speedNow}</span></div>
      <div class="race-cell"><span class="k">${esc(W.City)} as planned</span><span class="v c-stride">+${planned}</span></div>
      <div class="race-cell ${verdict < 0 ? 'danger' : ''}"><span class="k">Gap ${gap} →</span><span class="v ${verdict < 0 ? 'c-bad' : 'c-good'}">${gap + verdict}</span></div>
    </div>
    <div class="c-row"><span class="k">${esc(W.Lightning)}</span> <b>${v.strikesNow}</b> ${esc(v.strikesNow === 1 ? W.strike : W.strikes)} coming <span class="muted">(only ${tag('shield')} knows where)</span></div>
    <div class="c-row"><span class="k">${esc(W.route)}</span><div class="forks">${fork}</div>${v.sprint ? `<span class="sprint">Sprint next round</span>` : ''}</div>
    <div class="sups">${supply('power', pwPledge, pwAsk)}${supply('plates', plPledge, plAsk)}</div>
    <div class="lamps">${DEPTS.map(d => `<span class="lamp ${v.depts[d].ready ? 'on' : ''}" style="--c:${dc(d)}">${esc(DEPT_INFO[d].short)}</span>`).join('')}</div>
    ${v.last && v.last.ev ? `<div class="c-recap"><div class="muted small">Last round</div>${recapLines(v.last.ev, 3).map(l => `<div>${l}</div>`).join('')}</div>` : ''}`;
}

const BEATS = [
  ['strike', W.Lightning], ['power', dn('power')], ['fab', dn('fab')], ['support', `${dn('shield')} & ${dn('research')}`], ['loco', dn('loco')], ['storm', W.Storm],
];
function watchBoard(v) {
  const ev = shownEv.ev;
  const b = shownEv.beat;
  const lines = shownEv.recap ? recapLines(ev, 6) : [];
  return `<div class="c-round"><span class="title">Round ${ev.round}</span><span class="muted"> · the ${esc(W.city)} rolls</span></div>
    <div class="beats">${BEATS.map(([k, label], i) => `<div class="beat ${i < b ? 'done' : i === b ? 'now' : ''}">${esc(label)}<span>${beatText(k, ev, i <= b)}</span></div>`).join('')}</div>
    ${lines.length ? `<div class="c-recap big">${lines.map(l => `<div>${l}</div>`).join('')}</div>` : ''}`;
}
function beatText(k, ev, shown) {
  if (!shown) return '';
  if (k === 'strike') { const hit = ev.strikes.filter(s => s.hit.length).length; return ev.strikes.length ? `${ev.strikes.length} ${ev.strikes.length === 1 ? W.strike : W.strikes}, ${ev.strikes.filter(s => s.covered).length} covered, ${hit} hit` : `none`; }
  if (k === 'power') return `${ev.power.gen} made${ev.power.capUsed ? `, ${ev.power.capUsed} from storage` : ''}${ev.power.surplus ? `, ${ev.power.surplus} left over` : ''}`;
  if (k === 'fab') return `${ev.fab.plates} ${W.plates}${ev.fab.gears ? `, ${ev.fab.gears} ${W.gears}` : ''}${ev.fab.coresMade ? `, ${ev.fab.coresMade} ${W.cores}` : ''}`;
  if (k === 'support') return `+${ev.research.insight} ${W.insight}`;
  if (k === 'loco') return `${ev.loco.strides} × ${ev.loco.grade}${ev.loco.oc ? ' × 1.2' : ''} = <b>${ev.loco.dist}</b>`;
  if (k === 'storm') return `+${ev.speed}`;
  return '';
}

// ---------------- the watch ----------------
let bannerTimer;
function banner(html, ms = 1800) {
  const b = $('#banner'); b.innerHTML = html; b.classList.remove('hidden');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wait(ms) { await sleep(ms * SPEED); while (paused) await sleep(200); }

async function animateRound() {
  if (!scene) await sceneReady;
  const g = S.game; const L = g.last; if (!L) return;
  animating = true;
  const ev = L.ev;
  const round = L.round;
  shownEv = { ev, beat: 0, track: { city: L.before.city, storm: L.before.storm }, recap: false };
  pushAll();
  render();
  banner(`<span class="title">Round ${round}</span>The ${esc(W.city)} rolls`, 1200);
  await wait(1300);
  // 1 strike
  scene.focus(null);
  for (const s of ev.strikes) scene.lane(s.dept, s.at < 0 ? s.col : s.at, s.covered ? 'cov' : s.hit.length ? 'hit' : 'miss');
  await wait(ev.strikes.length ? 1800 : 600);
  // 2 power
  shownEv.beat = 1; render(); scene.focus('power');
  scene.pop('power', null, `+${ev.power.gen}`, 'gold');
  for (const d of ['fab', 'loco', 'shield', 'research']) scene.transfer('power', d, 'power', ev.power.delivered[d] || 0);
  for (const d of ['fab', 'loco', 'shield', 'research']) scene.pop(d, null, `${resIconText('power')} ${ev.power.delivered[d] || 0}`, (ev.broken.some(b => b.to === d && b.res === 'power')) ? 'bad' : '');
  await wait(1500);
  // 3 fab
  shownEv.beat = 2; render(); scene.focus('fab');
  scene.pop('fab', null, `+${ev.fab.plates} ${W.plates}`, 'gold');
  for (const [d, n] of Object.entries(ev.fab.shipped || {})) if (n) { scene.transfer('fab', d, 'plates', n); scene.pop(d, null, `+${n} ${W.plates}`, ''); }
  await wait(1400);
  // 4 shield & research
  shownEv.beat = 3; render(); scene.focus(ev.research.insight ? 'research' : 'shield');
  if (ev.research.insight) scene.pop('research', null, `+${ev.research.insight} ${W.insight}`, 'gold');
  await wait(1100);
  // 5 loco
  shownEv.beat = 4; render(); scene.focus('loco');
  scene.pop('loco', null, `+${ev.loco.dist} ${W.strides}`, 'good');
  shownEv.track = { city: L.after.city, storm: L.before.storm }; render();
  await wait(1500);
  // 6 storm
  scene.focus(null);
  shownEv.beat = 5; shownEv.track = { city: L.after.city, storm: L.after.storm }; render();
  await wait(1300);
  // recap
  shownEv.beat = 6; shownEv.recap = true; render();
  await wait(Math.min(9000, 2500 + recapLines(ev, 6).length * 1300));
  animating = false; shownEv = null;
  if (S.game !== g) return;
  S.animatedRound = round;
  if (g.phase === 'watch') {
    E.nextRound(g);
    lastHumanSig = '';
    banner(`<span class="title">Round ${g.round}</span>${g.round === 3 ? `New techs on ${esc(dn('research'))}'s shelf. ` : ''}Plan on your phones`, 2200);
    driveBots(true);
  }
  afterChange();
}
const resIconText = k => ({ power: '⚡' })[k] || '';

function renderOver() {
  show('#over');
  const g = S.game, o = g.outcome;
  const prev = best(g.mode);
  if (!prev || g.city > prev) setBest(g.mode, g.city);
  const stats = DEPTS.map(d => {
    const x = g.depts[d];
    return `<div class="ost hud" style="--c:${dc(d)}">${deptBadge(dc(d), DEPT_INFO[d].short[0], 36)}<b>${esc(dn(d))}</b><span>${esc(x.seat ? x.seat.name : 'bot')} · ${x.stats.builds} built · ${x.stats.moves} moves${d === 'fab' ? ` · ${x.stats.shipped} shipped` : ''}</span></div>`;
  }).join('');
  $('#overBox').innerHTML = `<h1 class="logo big">${o.win ? esc(THEME.win) : esc(THEME.lose[o.reason] || THEME.lose.caught)}</h1>
    <p class="over-sub">${o.win ? `In round ${o.round} of ${g.rules.rounds}.` : `In round ${o.round}.`}</p>
    <div class="score-big"><span>${g.city}</span><small>/ ${g.rules.haven} ${esc(W.strides)}</small></div>
    <p class="muted">${prev ? (g.city > prev ? `New best on ${esc(CONFIG.modes[g.mode].name)} (was ${prev}).` : `Best on ${esc(CONFIG.modes[g.mode].name)}: ${prev}.`) : 'First run on this difficulty.'}</p>
    <div class="ostats">${stats}</div>`;
}

window.addEventListener('resize', () => S.game && render());
render();
startNet();
if (S.game && S.game.phase === 'plan') driveBots(true);
