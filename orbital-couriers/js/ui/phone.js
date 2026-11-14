// Phone controller: private hand, 3-slot flight plan with ghost path, shop.
import { CARDS } from '../config.js';
import { ghostPath } from '../engine/move.js';
import { joinRoom } from '../../../shared/net.js';
import { createBoard, el, CELL, mapFor } from './board.js';
import { cardText, cargoIcon, esc, planetName, DIR_ARROW } from './text.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
let pid = store.get('oc-pid');
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 10); store.set('oc-pid', pid); }

let conn = null, view = null, lobby = null, code = null, seq = 0, gotReply = false, lastMsg = 0, lastViewSeq = 0, busyUntil = 0;
let board = null, boardKey = '';
let draft = { round: 0, slots: [null, null, null], pending: null };

// ---------------- join ----------------
$('#codeIn').value = (params.get('room') || store.get('oc-room') || '').toUpperCase();
$('#nameIn').value = store.get('oc-name') || '';
$('#joinBtn').onclick = doJoin;
$('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
if (params.get('room') && store.get('oc-name') && store.get('oc-room') === params.get('room').toUpperCase()) doJoin();

async function doJoin() {
  const c = $('#codeIn').value.trim().toUpperCase();
  const name = $('#nameIn').value.trim();
  if (c.length !== 4) return ($('#joinMsg').textContent = 'Enter the 4-letter code from the TV.');
  if (!name) return ($('#joinMsg').textContent = 'Pick a name.');
  store.set('oc-room', c); store.set('oc-name', name);
  code = c;
  $('#joinBtn').disabled = true;
  $('#joinMsg').textContent = 'Connecting…';
  wakeLock();
  conn = await joinRoom(code, pid, {
    onOpen: () => hello(),
    onClose: () => { if (gotReply) toast('Connection lost. Reconnecting…'); gotReply = false; },
    onNoHost: () => { if (!gotReply) { $('#joinMsg').textContent = `No game with code ${code} is open. Check the TV.`; $('#joinBtn').disabled = false; } },
    onMessage,
  });
  // Heartbeat: keep saying hello until the TV answers, and again whenever it goes quiet.
  setInterval(() => {
    if (!gotReply || Date.now() - lastMsg > 15000) { conn.reconnect && conn.reconnect(); hello(); }
  }, 2500);
  hello();
  // If nothing answers for a while, say so instead of spinning forever.
  setTimeout(() => {
    if (!gotReply) $('#joinMsg').textContent = 'Still connecting… This can take up to a minute. If it never connects, the TV\'s network or computer is probably blocking it: try hosting from another device (a personal laptop or tablet works).';
  }, 20000);
}
function hello() { if (conn) conn.send({ type: 'hello', name: store.get('oc-name'), reclaim: true }); }

let lock = null;
async function wakeLock() { try { lock = await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conn) { wakeLock(); gotReply = false; conn.reconnect && conn.reconnect(); hello(); }
});

// Ignore double-taps: the screen re-renders under your finger once the TV answers.
let lastSent = '';
function send(action) {
  if (!conn) return;
  // The same kind of tap twice within 0.6s is a double-tap (e.g. Buy, Lock in -> unlock).
  const kind = action.type === 'unready' ? 'submit' : action.type === 'unshop' ? 'shopDone' : action.type;
  if (kind === lastSent && Date.now() < busyUntil) return;
  lastSent = kind; busyUntil = Date.now() + 600;
  conn.send({ type: 'action', action, seq: ++seq });
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  gotReply = true; lastMsg = Date.now();
  if (msg.seq) { if (msg.seq < lastViewSeq) return; lastViewSeq = msg.seq; }
  if (msg.type === 'lobby') { lobby = msg; view = null; return renderLobby(); }
  if (msg.type === 'view') { view = msg.view; return render(); }
  if (msg.type === 'reject') return toast(msg.error);
  if (msg.type === 'full') return waitScreen('Room is full', 'This game already has 5 captains.', '');
  if (msg.type === 'inProgress') return waitScreen('Game in progress', 'This game started without you. Wait for the next one!', '');
}

// ---------------- screens ----------------
function show(id) {
  for (const s of ['#join', '#wait', '#program', '#shop']) $(s).classList.toggle('hidden', s !== id);
  $('#top').classList.toggle('hidden', id === '#join');
}
function shipSvg(c) {
  return `<svg viewBox="-50 -50 100 100"><circle r="46" fill="${c}" opacity=".18"/><path d="M0,-38 L26,28 L0,15 L-26,28 Z" fill="${c}" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><circle cy="-2" r="7" fill="#0b1026"/></svg>`;
}
function waitScreen(title, text, color, extra = '') {
  show('#wait');
  $('#waitArt').innerHTML = shipSvg(color || '#7ef3ff');
  $('#waitTitle').textContent = title;
  $('#waitText').innerHTML = text;
  $('#waitExtra').innerHTML = extra;
}
function setTop(name, color, cap, pts, cr) {
  $('#top').style.setProperty('--c', color);
  $('#meDot').style.background = color; $('#meDot').style.color = color;
  $('#meName').textContent = name;
  $('#meCap').textContent = cap || '';
  $('#meScore').textContent = pts != null ? pts + '★' : '';
  $('#meCredits').textContent = cr != null ? cr + '⬢' : '';
}

function renderLobby() {
  const me = lobby.players[lobby.you];
  if (!me) return waitScreen('Joining…', '', '');
  setTop(me.name, me.color, '', null, null);
  const others = lobby.players.map(p => `<span class="pill"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join(' ');
  waitScreen(`You're in, ${me.name}!`, 'Look at the TV. The game starts when the host presses Launch.', me.color,
    `<div class="center" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:10px">${others}</div>`);
}

function render() {
  const v = view, me = v.players.find(p => p.id === v.me.id);
  const cap = v.cfg.captains[me.captain];
  const shown = v.phase === 'resolve' && v.pre ? v.pre.players[me.id] : me; // no spoilers during the flight
  setTop(me.name, me.color, cap.name, shown.points, shown.credits);
  $('#meCap').onclick = () => toast(cap.name + ': ' + cap.desc, 'info');
  if (v.phase === 'program') return renderProgram(v, me);
  if (v.phase === 'resolve') {
    return waitScreen('Eyes on the TV!', 'Your ship is flying. Watch for bumps and deliveries.', me.color);
  }
  if (v.phase === 'shop') return renderShop(v, me);
  if (v.phase === 'over') {
    const place = v.standings.indexOf(me.id) + 1;
    const word = ['', '1st place! 🏆', '2nd place', '3rd place', '4th place', '5th place'][place];
    return waitScreen(word, `You finished with <b class="c-gold">${me.points}★</b> from ${me.deliveries} deliveries${me.endBonus ? ` (including +${me.endBonus}★ for leftover credits)` : ''}.<br>Thanks for flying!`, me.color);
  }
}

// ---------------- programming ----------------
function ensureDraft(v) {
  if (draft.round !== v.round || draft.gameId !== v.gameId) {
    const saved = (() => { try { return JSON.parse(store.get('oc-draft')); } catch (e) { return null; } })();
    if (saved && saved.round === v.round && saved.code === code && saved.gameId === v.gameId) draft = saved;
    else draft = { round: v.round, code, gameId: v.gameId, slots: Array(v.cfg.movesPerRound).fill(null), pending: null };
  }
  // drop cards no longer in hand
  draft.slots = draft.slots.map(s => (s && v.me.hand.some(c => c.id === s.cardId)) ? s : null);
}
function saveDraft() { store.set('oc-draft', JSON.stringify(draft)); }

function renderProgram(v, me) {
  show('#program');
  const cap = v.cfg.captains[me.captain];
  ensureDraft(v);
  const locked = v.me.ready;
  if (locked && v.me.program) {
    draft.slots = v.me.program.map(s => ({ cardId: s.cardId, type: s.type, dir: s.dir, shield: s.shield }));
    draft.pending = null;
  }
  $('#progRound').textContent = `Round ${v.round} of ${v.rounds}`;
  const pos = v.order.indexOf(me.id) + 1;
  $('#progHint').textContent = `You move ${['1st', '2nd', '3rd', '4th', '5th'][pos - 1]} each step`;

  const tip = $('#tip');
  tip.classList.toggle('hidden', v.round > 1 || locked || !!draft.pending);
  if (v.round <= 1) tip.innerHTML = `Tap a card, then a direction. Numbered dots = where you'll be. <b>${esc(cap.name)}:</b> ${esc(cap.desc)}`;
  // hold bar
  const hb = $('#holdBar'); hb.innerHTML = '<span class="lbl">Hold</span>';
  for (let i = 0; i < me.holdSize; i++) {
    const h = me.hold[i];
    if (!h) { hb.insertAdjacentHTML('beforeend', `<span class="cargo empty">empty</span>`); continue; }
    const to = v.cfg.planets[h.to];
    hb.insertAdjacentHTML('beforeend', `<span class="cargo ${h.salvage ? 'salvage' : ''}" style="--c:${to.color}">${cargoIcon(h.cargo)} ${h.salvage ? 'Salvage: sell at any planet' : '→ ' + esc(to.name)}${locked ? '' : `<button data-dump="${h.cid}">dump</button>`}</span>`);
  }
  hb.querySelectorAll('[data-dump]').forEach(b => b.onclick = () => send({ type: 'dump', cid: b.dataset.dump }));

  // mini map
  const key = v.cfg.map.join('') + v.n;
  if (!board || boardKey !== key) { board = createBoard($('#mini'), v, { mini: true }); boardKey = key; }
  board.updateContracts(v.contracts, v.players);
  const carried = new Set(v.players.flatMap(p => p.hold.filter(h => !h.salvage).map(h => h.cid)));
  $('#contractList').innerHTML = v.contracts.filter(c => v.cfg.sharedCargo || !carried.has(c.id)).map(c => {
    const f = v.cfg.planets[c.from], t = v.cfg.planets[c.to];
    return `<div class="cline"><span class="pts" style="--c:${t.color}">${c.points}</span>${cargoIcon(c.cargo)} <b style="color:${f.color}">${esc(f.name)}</b> → <b style="color:${t.color}">${esc(t.name)}</b></div>`;
  }).join('') || '<div class="muted small">All contracts are taken. New ones arrive after this round.</div>';
  $('#contractList').insertAdjacentHTML('afterbegin', '<span class="lbl">Pickups:</span>');
  const waitingOn = v.players.filter(p => !p.ready).length;
  board.updateShips(v.players.map(p => ({ ...p })));
  for (const p of v.players) board.ships[p.id].g.classList.toggle('other-ship', p.id !== me.id);
  drawGhost(v, me);

  // slots
  const box = $('#slots'); box.innerHTML = '';
  const nextIdx = draft.slots.findIndex(s => !s);
  draft.slots.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'slot' + (s ? ' filled' : '') + (!s && i === nextIdx && !locked ? ' next' : '');
    d.style.setProperty('--c', me.color);
    if (s) {
      const c = CARDS[s.type];
      d.innerHTML = `<span class="n">${i + 1}</span><span class="big">${c.label.replace('Burn ', 'Burn&nbsp;')} ${s.dir ? DIR_ARROW[s.dir] : ''}</span>
        <span class="sub">${locked ? '' : 'tap to clear'}</span>${v.me.shields ? `<span class="shield ${s.shield ? 'on' : ''}" data-shield="${i}">🛡 shield ${s.shield ? 'ON' : 'off'}</span>` : ''}`;
      if (!locked) d.onclick = e => {
        if (e.target.dataset.shield != null) { s.shield = !s.shield; saveDraft(); return renderProgram(view, me); }
        draft.slots[i] = null; saveDraft(); renderProgram(view, me);
      };
    } else d.innerHTML = `<span class="n">${i + 1}</span><span class="muted">${i === nextIdx && draft.pending ? 'choose direction' : 'empty'}</span>`;
    box.appendChild(d);
  });

  // hand
  const hand = $('#hand'); hand.innerHTML = '';
  const used = new Set(draft.slots.filter(Boolean).map(s => s.cardId));
  const order = ['burn3', 'burn2', 'burn1', 'brake', 'drift'];
  [...v.me.hand].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)).forEach(card => {
    const c = CARDS[card.type];
    const b = document.createElement('button');
    b.className = `card ${card.type}` + (used.has(card.id) || locked ? ' used' : '') + (draft.pending === card.id ? ' sel' : '');
    b.innerHTML = `<span class="v">${c.short}</span><span class="l">${c.label.replace(/ \d/, '')}</span>`;
    b.onclick = () => pickCard(card);
    hand.appendChild(b);
  });
  $('#dirPad').classList.toggle('hidden', !draft.pending);
  $('#handArea').classList.toggle('hidden', !!draft.pending);
  if (draft.pending) {
    const card = v.me.hand.find(c => c.id === draft.pending);
    $('#dirCard').textContent = CARDS[card.type].label;
  }

  const full = draft.slots.every(Boolean);
  const rb = $('#readyBtn');
  rb.disabled = !full && !locked;
  rb.classList.toggle('locked', locked);
  rb.classList.toggle('hidden', !!draft.pending);
  rb.textContent = locked ? `Locked in ✓ · waiting for ${waitingOn} (tap to change)` : full ? 'Lock in flight plan' : `Pick ${draft.slots.filter(s => !s).length} more move${draft.slots.filter(s => !s).length > 1 ? 's' : ''}`;
  rb.onclick = () => {
    if (locked) return send({ type: 'unready' });
    if (!full) return;
    send({ type: 'submit', slots: draft.slots.map(s => ({ cardId: s.cardId, dir: s.dir, shield: !!s.shield })) });
  };
}

function pickCard(card) {
  const idx = draft.slots.findIndex(s => !s);
  if (idx < 0) return toast('All 3 slots are full. Tap a slot to clear it.');
  if (!CARDS[card.type].dir) { draft.slots[idx] = { cardId: card.id, type: card.type, dir: null, shield: false }; draft.pending = null; }
  else draft.pending = draft.pending === card.id ? null : card.id;
  saveDraft();
  renderProgram(view, view.players.find(p => p.id === view.me.id));
}
document.querySelectorAll('#dirPad [data-d]').forEach(b => b.onclick = () => chooseDir(b.dataset.d));
$('#dirCancel').onclick = () => { draft.pending = null; saveDraft(); renderProgram(view, view.players.find(p => p.id === view.me.id)); };
function chooseDir(d) {
  if (!draft.pending) return;
  const card = view.me.hand.find(c => c.id === draft.pending);
  const idx = draft.slots.findIndex(s => !s);
  if (idx < 0 || !card) return;
  draft.slots[idx] = { cardId: card.id, type: card.type, dir: d, shield: false };
  draft.pending = null; saveDraft();
  renderProgram(view, view.players.find(p => p.id === view.me.id));
}

function drawGhost(v, me) {
  const g = board.overlay; g.innerHTML = '';
  const map = mapFor(v);
  const C = x => (x + 0.5) * CELL;
  const slots = draft.slots.map(s => s && { type: s.type, dir: s.dir, shield: s.shield });
  const res = ghostPath(v.cfg, map, me, slots, v.me.shields);
  // highlight destinations of carried cargo
  for (const h of me.hold) {
    const pl = map.planets[h.to]; if (!pl || h.salvage) continue;
    el('circle', { cx: C(pl.x), cy: C(pl.y), r: CELL * 1.2, class: 'target-ring', stroke: pl.color }, g);
  }
  res.forEach((r, i) => {
    if (!r) return;
    const mv = r.events.find(e => e.t === 'move');
    if (mv.path.length > 1) el('polyline', { points: mv.path.map(([x, y]) => `${C(x)},${C(y)}`).join(' '), class: 'ghost-line', stroke: me.color, 'stroke-opacity': 0.85 }, g);
    const pull = r.events.find(e => e.t === 'pull');
    if (pull) el('line', { x1: C(pull.from[0]), y1: C(pull.from[1]), x2: C(pull.to[0]), y2: C(pull.to[1]), class: 'ghost-pull' }, g);
  });
  const seen = {};
  res.forEach((r, i) => {
    if (!r) return;
    const k = r.x + ',' + r.y, off = (seen[k] = (seen[k] || 0) + 1) - 1;
    const cx = C(r.x) + off * 26, cy = C(r.y) - off * 26;
    el('circle', { cx, cy, r: 30, fill: me.color, stroke: '#fff', 'stroke-width': 5 }, g);
    const t = el('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'ghost-num' }, g); t.textContent = i + 1;
  });
  // landing previews for the card being placed
  if (draft.pending) {
    const card = v.me.hand.find(c => c.id === draft.pending);
    const idx = draft.slots.findIndex(s => !s);
    for (const d of ['N', 'E', 'S', 'W']) {
      const trial = slots.map((s, i) => i < idx ? s : null);
      trial[idx] = { type: card.type, dir: d };
      const r = ghostPath(v.cfg, map, me, trial, v.me.shields)[idx];
      const lg = el('g', { class: 'landing' }, g);
      el('circle', { cx: C(r.x), cy: C(r.y), r: 46, fill: '#7ef3ff', opacity: 0.9, stroke: '#fff', 'stroke-width': 4 }, lg);
      el('circle', { cx: C(r.x), cy: C(r.y), r: 75, fill: 'transparent' }, lg);
      const t = el('text', { x: C(r.x), y: C(r.y) + 18, 'text-anchor': 'middle' }, lg); t.textContent = DIR_ARROW[d];
      lg.addEventListener('click', () => chooseDir(d));
    }
  }
}

// ---------------- shop ----------------
function renderShop(v, me) {
  show('#shop');
  const list = $('#shopList'); list.innerHTML = '';
  for (const [k, u] of Object.entries(v.cfg.upgrades)) {
    const cost = v.me.costs[k];
    const lvl = me.upgrades[k];
    const d = document.createElement('div'); d.className = 'up';
    d.innerHTML = `<div><span class="nm">${esc(u.name)}</span><span class="lv">${'★'.repeat(lvl)}${'☆'.repeat(u.cost.length - lvl)}</span></div>
      <div class="ds">${esc(u.desc)}</div>
      <button class="btn ${cost != null && cost <= me.credits ? 'gold' : 'secondary'}" ${cost == null || cost > me.credits || me.shopDone ? 'disabled' : ''}>${cost == null ? 'MAX' : cost + '⬢'}</button>`;
    d.querySelector('button').onclick = () => send({ type: 'buy', upgrade: k });
    list.appendChild(d);
  }
  const hasSalvage = me.hold.some(h => h.salvage);
  $('#shopHold').innerHTML = hasSalvage ? '<p class="tip">You are carrying salvage. End a move next to any planet to sell it.</p>' : '';
  const b = $('#shopDone');
  b.textContent = me.shopDone ? 'Waiting for others… (tap to keep shopping)' : 'Done shopping';
  b.classList.toggle('locked', me.shopDone);
  b.onclick = () => send({ type: me.shopDone ? 'unshop' : 'shopDone' });
}

let toastT;
function toast(text, kind) {
  const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
  t.style.background = kind === 'info' ? '#2a3577' : '#ff6b81';
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2800);
}
