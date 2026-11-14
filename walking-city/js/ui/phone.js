// Phone controller: your hand, your district, and your plan for the round.
import { CARDS } from '../config.js';
import { resolveProduction } from '../engine/production.js';
import { joinRoom } from '../../../shared/net.js';
import { cardFace, crest, resIcon, tileGlyph, resPath, RES_COLOR, KIND_TINT } from './art.js';
import { esc, cardName, leanHint } from './text.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
let pid = store.get('wc-pid');
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 10); store.set('wc-pid', pid); }

let conn = null, view = null, lobby = null, code = null, seq = 0, gotReply = false, lastMsg = 0, lastViewSeq = 0;
// draft: { round, assign: {uid: 'build'|'left'|'right'|'keep'|'scrap'|'action'}, tile, tile2, commit, sel }
let draft = null;

// ---------------- join ----------------
$('#codeIn').value = (params.get('room') || store.get('wc-room') || '').toUpperCase();
$('#nameIn').value = store.get('wc-name') || '';
$('#joinBtn').onclick = doJoin;
$('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
if (params.get('room') && store.get('wc-name') && store.get('wc-room') === params.get('room').toUpperCase()) doJoin();

async function doJoin() {
  const c = $('#codeIn').value.trim().toUpperCase();
  const name = $('#nameIn').value.trim();
  if (c.length !== 4) return ($('#joinMsg').textContent = 'Enter the 4-letter code from the TV.');
  if (!name) return ($('#joinMsg').textContent = 'Pick a name.');
  store.set('wc-room', c); store.set('wc-name', name);
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
  // Heartbeat: keep saying hello until the TV answers, and again whenever it goes quiet (phones sleep).
  setInterval(() => {
    if (!gotReply || Date.now() - lastMsg > 15000) { conn.reconnect && conn.reconnect(); hello(); }
  }, 2500);
  hello();
  // If nothing answers for a while, say so instead of spinning forever.
  setTimeout(() => {
    if (!gotReply) $('#joinMsg').textContent = 'Still connecting… This can take up to a minute. If it never connects, the TV\'s network or computer is probably blocking it: try hosting from another device (a personal laptop or tablet works).';
  }, 20000);
}
function hello() { if (conn) conn.send({ type: 'hello', name: store.get('wc-name'), reclaim: true }); }
let lock = null;
async function wakeLock() { try { lock = await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conn) { wakeLock(); gotReply = false; conn.reconnect && conn.reconnect(); hello(); }
});
function send(action) { conn && conn.send({ type: 'action', action, seq: ++seq }); }

function onMessage(msg) {
  gotReply = true; lastMsg = Date.now();
  if (msg.seq) { if (msg.seq < lastViewSeq) return; lastViewSeq = msg.seq; }
  if (msg.type === 'lobby') { lobby = msg; view = null; return renderLobby(); }
  if (msg.type === 'view') { view = msg.view; return render(); }
  if (msg.type === 'reject') return toast(msg.error);
  if (msg.type === 'full') return waitScreen('City is full', 'This game already has 5 districts.', '#e0b46a');
  if (msg.type === 'inProgress') return waitScreen('Game in progress', 'This game started without you. Catch the next one!', '#e0b46a');
}

// ---------------- screens ----------------
function show(id) {
  for (const s of ['#join', '#wait', '#plan', '#locked']) $(s).classList.toggle('hidden', s !== id);
  $('#top').classList.toggle('hidden', id === '#join');
}
function waitScreen(title, text, color, extra = '') {
  show('#wait');
  $('#waitArt').innerHTML = crest(color || '#e0b46a', 120);
  $('#waitTitle').textContent = title;
  $('#waitText').innerHTML = text;
  $('#waitExtra').innerHTML = extra;
}
function setTop(name, color, round, crates) {
  $('#top').style.setProperty('--c', color);
  $('#meCrest').innerHTML = crest(color, 34);
  $('#meName').textContent = name;
  $('#meRound').textContent = round ? `Round ${round}` : '';
  $('#meCrates').innerHTML = crates ? `${'<i class="crate s"></i>'.repeat(crates.supply)}${'<i class="crate p"></i>'.repeat(crates.part)}` : '';
}
function renderLobby() {
  const me = lobby.players[lobby.you];
  if (!me) return waitScreen('Joining…', '', '');
  setTop(me.name, me.color);
  const others = lobby.players.map(p => `<span class="pill"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join(' ');
  waitScreen(`You're in, ${me.name}!`, 'Look at the TV. The game starts when the host presses Start.', me.color,
    `<div class="pills">${others}</div>`);
}

function render() {
  const v = view, me = v.me;
  if (!me) return;
  setTop(me.name, me.color, v.round, me.crates);
  if (v.phase === 'over') {
    const won = v.outcome === 'won';
    return waitScreen(won ? 'You reached the Haven!' : 'The storm caught you', `The city walked <b class="c-gold">${Math.min(v.city, v.haven)}</b> of ${v.haven} strides. ${won ? 'Well walked, chief.' : 'Try to beat it next time!'}`, me.color);
  }
  if (v.phase === 'watch' || v.replaying) return waitScreen('Eyes on the TV!', 'Your city is running. Watch what your buildings feed.', me.color);
  if (v.phase === 'plan') return me.ready ? renderLocked(v) : renderPlan(v);
}

// ---------------- the district grid ----------------
const T = 100, GH = 40, TOP = 34; // tile size, ghost column width, core bar height
function gridSvg(svg, v, district, st, opts = {}) {
  const me = v.me, N = v.N;
  const L = v.districts[me.left], R = v.districts[me.right];
  const W = GH + 3 * T + GH, H = TOP + 3 * T + 4;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let s = `<defs><pattern id="hatchP" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#0b0d14aa"/><line x1="0" y1="0" x2="0" y2="10" stroke="#ffffff30" stroke-width="4"/></pattern></defs>`;
  s += `<rect x="${GH}" y="0" width="${3 * T}" height="${TOP - 6}" rx="2" class="corebar"/><text x="${GH + 1.5 * T}" y="${TOP - 13}" text-anchor="middle" class="corebar-t">▲ CORE · MAIN DRIVE ▲</text>`;
  const tileAt = (x, y, w, b, cls, k, scale) => {
    const def = b && CARDS[b.card];
    const glow = def ? RES_COLOR[Object.keys(def.makes)[0]] : '#fff';
    return `<g class="tile ${cls}" data-t="${k}" style="--glow:${glow};--tint:${def ? KIND_TINT[def.kind] : '#171b26'}">
      <rect class="tbg" x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${T - 6}" rx="4"/>
      <rect class="thatch" x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${T - 6}" rx="4" fill="url(#hatchP)"/>
      ${b ? `<g class="glyph" transform="translate(${x + w / 2},${y + T / 2 - 2}) scale(${scale})">${tileGlyph(b.card)}</g>` : ''}</g>`;
  };
  const off = new Set(v.offNow);
  // ghost columns: neighbours' facing tiles
  for (let r = 0; r < 3; r++) {
    const kl = me.left * 9 + r * 3 + 2, kr = me.right * 9 + r * 3;
    s += tileAt(0, TOP + r * T, GH, L[r * 3 + 2], 'ghost ' + stateCls(st, kl, L[r * 3 + 2], off), 'gl' + r, 0.42);
    s += tileAt(GH + 3 * T, TOP + r * T, GH, R[r * 3], 'ghost ' + stateCls(st, kr, R[r * 3], off), 'gr' + r, 0.42);
  }
  for (let t = 0; t < 9; t++) {
    const r = Math.floor(t / 3), c = t % 3, k = me.seat * 9 + t, b = district[t];
    let cls = stateCls(st, k, b, off);
    if (opts.target === t) cls += ' target';
    if (opts.target2 === t) cls += ' target';
    if (opts.pick) cls += ' pickable';
    s += tileAt(GH + c * T, TOP + r * T, T, b, cls, t, 1.05);
    const miss = st.starved.get(k);
    if (miss) s += `<g transform="translate(${GH + c * T + T - 20},${TOP + r * T + 20})"><circle r="13" fill="#2a0d12" stroke="#ff5a6e" stroke-width="3"/>${resPath(Object.keys(miss)[0], 0, 0, 0.8)}</g>`;
    if (opts.target === t || opts.target2 === t) s += `<rect x="${GH + c * T + 2}" y="${TOP + r * T + 2}" width="${T - 4}" height="${T - 4}" rx="13" class="target-ring"/>`;
  }
  s += `<line x1="${GH}" y1="${TOP}" x2="${GH}" y2="${H}" class="nb-line" stroke="${v.players[me.left].color}"/><line x1="${GH + 3 * T}" y1="${TOP}" x2="${GH + 3 * T}" y2="${H}" class="nb-line" stroke="${v.players[me.right].color}"/>`;
  svg.innerHTML = s;
}
function stateCls(st, k, b, off) {
  if (!b) return 'empty';
  let c = CARDS[b.card].kind;
  c += st.active.has(k) ? ' active' : ' idle';
  if (st.starved.has(k)) c += ' starved';
  if (off.has(k)) c += ' off';
  return c;
}
function simulate(v, districts, surge) {
  const prod = resolveProduction(districts, { disabled: new Set(v.offNow), surge });
  return { prod, active: new Set(prod.active), starved: new Map(prod.starved.map(s => [s.k, s.missing])) };
}

// ---------------- planning ----------------
const SLOTS = ['play', 'left', 'right', 'keep'];
function ensureDraft(v) {
  const key = `${code}-${v.round}`;
  if (!draft || draft.key !== key) {
    let saved = null;
    try { saved = JSON.parse(store.get('wc-draft')); } catch (e) {}
    draft = saved && saved.key === key ? saved : { key, assign: {}, tile: null, tile2: null, commit: null, sel: null };
  }
  const ids = new Set(v.me.hand.map(c => c.uid));
  for (const uid of Object.keys(draft.assign)) if (!ids.has(uid)) delete draft.assign[uid];
  if (draft.sel && !ids.has(draft.sel)) draft.sel = null;
}
function saveDraft() { store.set('wc-draft', JSON.stringify(draft)); }
const cardOf = uid => view.me.hand.find(c => c.uid === uid);
const holder = slot => Object.keys(draft.assign).find(u => draft.assign[u] === slot || (slot === 'play' && ['build', 'scrap', 'action'].includes(draft.assign[u])));

function buildPlan(v) {
  const playUid = holder('play');
  const plan = { play: null, left: holder('left') || null, right: holder('right') || null, reserve: holder('keep') || null, commit: draft.commit };
  if (playUid) {
    const mode = draft.assign[playUid];
    plan.play = { uid: playUid, mode };
    if (mode === 'build' || mode === 'action') { plan.play.tile = draft.tile; if (cardOf(playUid).card === 'overhaul') plan.play.tile2 = draft.tile2; }
  }
  return plan;
}
function planProblem(v, plan) {
  const me = v.me;
  if (!plan.play) return 'Pick a card to build (tap a card, then a tile).';
  const card = cardOf(plan.play.uid).card;
  if (plan.play.mode === 'build' && plan.play.tile == null) return `Tap a tile for your ${cardName(card)}.`;
  if (plan.play.mode === 'action' && card === 'overhaul' && (plan.play.tile == null || plan.play.tile2 == null)) return 'Tap two tiles to swap.';
  if (plan.play.mode === 'action' && card === 'surge' && plan.play.tile == null) return 'Tap one of your buildings to surge.';
  const need = Math.min(2, me.hand.length - 1);
  if (need >= 1 && !plan.left) return `Pass a card left to ${v.players[me.left].name}.`;
  if (need >= 2 && !plan.right) return `Pass a card right to ${v.players[me.right].name}.`;
  return null;
}
// The district as it will look after my play, for the live preview.
function afterPlay(v, plan) {
  const D = v.districts.map(d => d.slice());
  const s = v.me.seat;
  let surge = null;
  if (plan.play && plan.play.tile != null) {
    const card = cardOf(plan.play.uid).card;
    if (plan.play.mode === 'build') D[s][plan.play.tile] = { card, passedBy: null };
    else if (card === 'overhaul' && plan.play.tile2 != null) { const a = plan.play.tile, b = plan.play.tile2; [D[s][a], D[s][b]] = [D[s][b], D[s][a]]; }
    else if (card === 'surge') surge = new Set([s * 9 + plan.play.tile]);
  }
  return { D, surge };
}

function renderPlan(v) {
  show('#plan');
  ensureDraft(v);
  const me = v.me;
  const plan = buildPlan(v);
  const { D, surge } = afterPlay(v, plan);
  const now = simulate(v, v.districts), next = simulate(v, D, surge);
  const gap = v.city - v.storm;
  const st = v.core.current;
  const need = st ? Math.max(0, st.need - v.core.progress[me.seat]) : 0;
  const full = me.crates.supply + me.crates.part >= v.cfg.crateCap;
  $('#strip').innerHTML = `
    <span class="chip-s ${gap <= 6 ? 'bad' : ''}">GAP <b>${gap}</b> <span class="muted">storm +${v.speedNow}</span></span>
    <span class="chip-s">${st ? (need ? `DRIVE ${need}×${resIcon('part', 15)}` : 'DRIVE ✓') : 'DRIVE DONE'}</span>
    ${v.twist.now ? `<span class="chip-s storm">${v.stormType === 'lightning' ? '⚡ NOW' : '≋ NOW'}</span>` : v.twist.next ? `<span class="chip-s storm">${v.stormType === 'lightning' ? '⚡' : '≋'} NEXT</span>` : ''}
    ${full ? '<span class="chip-s bad">CRATES FULL</span>' : ''}`;
  const sel = draft.sel && cardOf(draft.sel);
  const selMode = sel && draft.assign[draft.sel];
  const picking = sel && (selMode === 'build' || selMode === 'action');
  gridSvg($('#grid'), v, D[me.seat], next, { target: picking ? draft.tile : (plan.play && plan.play.tile), target2: draft.tile2, pick: picking });
  $('#grid').querySelectorAll('.tile[data-t]').forEach(g => {
    const t = Number(g.dataset.t);
    if (Number.isNaN(t)) return;
    g.onclick = () => onTile(t);
  });
  const mine = s => s.prod.stridesBy[me.seat];
  const dEng = mine(next) - mine(now), dCity = next.prod.strides - now.prod.strides;
  $('#preview').innerHTML = `This round your district walks <b class="c-stride">${mine(next)}</b>${resIcon('stride', 16)}${dEng ? ` <span class="delta">(${dEng > 0 ? '+' : ''}${dEng})</span>` : ''} · whole city <b class="c-stride">${next.prod.strides + v.bonus}</b>${dCity !== dEng && dCity ? ` <span class="delta">(${dCity > 0 ? '+' : ''}${dCity})</span>` : ''}`;
  $('#hint').innerHTML = v.me.nudge ? '<b class="c-gold">Everyone else is ready.</b> No rush, but the city is waiting on you.'
    : v.giftOnly && v.round === 2 ? '<b class="c-accent">From now on you can only build gifts</b> (cards your neighbours passed you) and your kept card. Pass your fresh cards to whoever can use them.'
    : v.twist.next && v.stormType === 'lightning' ? '⚡ <b>Lightning next round:</b> Power outside your top row (next to the core) will shut off, including your starting Dynamo.'
    : leanHint(v, me.seat);
  // hand
  const hand = $('#hand'); hand.innerHTML = '';
  for (const c of me.hand) {
    const a = draft.assign[c.uid];
    const d = document.createElement('button');
    const fresh = CARDS[c.card].kind !== 'action' && !buildable(v, c);
    const giver = c.from === 'left' ? v.players[me.left] : c.from === 'right' ? v.players[me.right] : null;
    d.className = 'card ' + CARDS[c.card].kind + (draft.sel === c.uid ? ' sel' : '') + (a ? ' assigned' : '') + (fresh ? ' fresh-only' : ' can-build') + (giver ? ' gift' : '');
    if (giver) d.style.setProperty('--g', giver.color);
    const ribbon = giver ? `<span class="ribbon">GIFT · ${esc(giver.name)}</span>` : c.from === 'reserve' ? '<span class="ribbon kept">KEPT</span>' : fresh ? '<span class="ribbon fresh">pass or keep</span>' : '';
    d.innerHTML = cardFace(c.card) + (a ? `<span class="tag t-${a}">${tagText(v, a)}</span>` : ribbon);
    d.onclick = () => { draft.sel = draft.sel === c.uid ? null : c.uid; saveDraft(); renderPlan(view); };
    hand.appendChild(d);
  }
  renderActions(v, sel);
  renderCommit(v);
  const prob = planProblem(v, plan);
  const unassigned = me.hand.filter(c => !draft.assign[c.uid]).length;
  $('#readyBtn').disabled = !!prob;
  $('#readyBtn').textContent = prob ? prob : unassigned > 1 ? `Ready · ${unassigned} cards unused` : `Ready${unassigned ? ' · 1 card discarded' : ''}`;
  $('#readyBtn').classList.toggle('hinting', !!prob);
  $('#readyBtn').classList.toggle('warnish', !prob && unassigned > 1);
  $('#readyBtn').classList.toggle('hidden', !!sel);
}
// After round 1 you may only build cards a neighbour passed you, or the card you kept.
function buildable(v, c) { return !v.giftOnly || v.round <= 1 || ['left', 'right', 'reserve'].includes(c.from); }
function tagText(v, a) {
  return { build: 'BUILD', action: 'PLAY', scrap: 'SCRAP', left: `◀ ${esc(v.players[v.me.left].name)}`, right: `${esc(v.players[v.me.right].name)} ▶`, keep: 'KEEP' }[a];
}
function renderActions(v, sel) {
  const box = $('#actions');
  if (!sel) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const def = CARDS[sel.card];
  const a = draft.assign[sel.uid];
  const scrapKind = (v.cfg.scrapYield[def.tier] || 'supply') === 'part' ? 'Part' : 'Supply';
  const btn = (mode, label, extra = '') => `<button class="act ${a === mode ? 'on' : ''}" data-m="${mode}" ${extra}>${label}</button>`;
  box.innerHTML = `<div class="act-title"><span>${esc(def.name)}: ${def.kind === 'action' ? esc(def.text) : 'what should it do?'}</span><button class="act-close" aria-label="close">✕</button></div>
    ${def.kind !== 'action' && !buildable(v, sel) ? '<div class="act-hint">Fresh cards can\'t be built. Pass it to a neighbour who needs it, or keep it: kept cards can be built next round.</div>' : ''}
    <div class="act-row">
      ${def.kind === 'action' ? btn('action', '▶ Play it') : buildable(v, sel) ? btn('build', '⬢ Build') : `<button class="act" disabled>⬢ Build<small>gifts only</small></button>`}
      ${btn('left', `◀ To ${esc(v.players[v.me.left].name)}`)}
      ${btn('right', `To ${esc(v.players[v.me.right].name)} ▶`)}
      ${btn('keep', '⏸ Keep')}
      ${btn('scrap', `✕ Scrap <small>+1 ${scrapKind}</small>`)}
    </div>
    ${a === 'build' ? '<div class="act-hint">Now tap a tile on your district above. Building on a tile replaces what is there.</div>' : ''}
    ${a === 'action' && sel.card === 'overhaul' ? '<div class="act-hint">Tap two tiles to swap them.</div>' : ''}
    ${a === 'action' && sel.card === 'surge' ? '<div class="act-hint">Tap one of your buildings: it makes double this round.</div>' : ''}`;
  box.querySelectorAll('.act[data-m]').forEach(b => b.onclick = () => assign(sel.uid, b.dataset.m));
  box.querySelector('.act-close').onclick = () => { draft.sel = null; saveDraft(); renderPlan(view); };
}
function assign(uid, mode) {
  if (draft.assign[uid] === mode) { delete draft.assign[uid]; if (['build', 'action'].includes(mode)) { draft.tile = draft.tile2 = null; } }
  else {
    // one card per slot: free the slot first
    const slot = ['build', 'scrap', 'action'].includes(mode) ? 'play' : mode;
    const prev = holder(slot);
    if (prev && prev !== uid) delete draft.assign[prev];
    if (['build', 'scrap', 'action'].includes(draft.assign[uid]) || slot === 'play') { draft.tile = draft.tile2 = null; }
    draft.assign[uid] = mode;
    if (mode !== 'build' && mode !== 'action') {
      // jump to the next unassigned card to keep things moving
      draft.sel = nextSel();
    }
  }
  saveDraft(); renderPlan(view);
}
// Keep the sheet moving to the next card only while the required choices (play, pass left, pass right) are open.
function nextSel() {
  if (holder('play') && holder('left') && (holder('right') || view.me.hand.length < 3)) return null;
  const nxt = view.me.hand.find(c => !draft.assign[c.uid]);
  return nxt ? nxt.uid : null;
}
function onTile(t) {
  const playUid = holder('play');
  if (!playUid) { toast('Pick a card first, then tap a tile.', 'info'); return; }
  const mode = draft.assign[playUid];
  const card = cardOf(playUid).card;
  if (mode === 'build') draft.tile = t;
  else if (mode === 'action' && card === 'overhaul') {
    if (draft.tile == null || (draft.tile != null && draft.tile2 != null)) { draft.tile = t; draft.tile2 = null; }
    else if (t !== draft.tile) draft.tile2 = t;
  } else if (mode === 'action' && card === 'surge') {
    if (!view.districts[view.me.seat][t]) return toast('Surge needs one of your buildings.', 'info');
    draft.tile = t;
  } else { toast('Pick a card first, then tap a tile.', 'info'); return; }
  if (mode === 'build' || (mode === 'action' && (card !== 'overhaul' || draft.tile2 != null))) {
    draft.sel = nextSel();
  }
  saveDraft(); renderPlan(view);
}
function renderCommit(v) {
  const box = $('#commitRow');
  const st = v.core.current, me = v.me;
  const has = me.crates.supply + me.crates.part;
  if (!st || !has || me.commitTarget < 0) { box.classList.add('hidden'); draft.commit = null; return; }
  const ok = k => me.crates[k] > 0 && (st.res !== 'part' || k === 'part');
  if (draft.commit && !ok(draft.commit)) draft.commit = null;
  box.classList.remove('hidden');
  const target = me.commitTarget === me.seat ? 'your Drive slot' : `${esc(v.players[me.commitTarget].name)}'s Drive slot`;
  box.innerHTML = `<span>Send a crate to ${target}?</span>
    ${ok('supply') ? `<button class="act ${draft.commit === 'supply' ? 'on' : ''}" data-k="supply"><i class="crate s"></i> Supply</button>` : ''}
    ${ok('part') ? `<button class="act ${draft.commit === 'part' ? 'on' : ''}" data-k="part"><i class="crate p"></i> Part</button>` : ''}
    ${!ok('supply') && !ok('part') ? '<span class="muted">This stage needs a Part crate.</span>' : ''}`;
  box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { draft.commit = draft.commit === b.dataset.k ? null : b.dataset.k; saveDraft(); renderPlan(view); });
}
$('#readyBtn').onclick = () => {
  const plan = buildPlan(view);
  if (planProblem(view, plan)) return;
  send({ type: 'submit', plan });
};
$('#changeBtn').onclick = () => send({ type: 'unready' });

function renderLocked(v) {
  show('#locked');
  ensureDraft(v);
  const plan = buildPlan(v);
  const { D, surge } = afterPlay(v, plan);
  gridSvg($('#grid2'), v, D[v.me.seat], simulate(v, D, surge), { target: plan.play && plan.play.tile });
  const ready = v.players.filter(p => p.ready).length;
  const line = (label, uid) => uid ? `<div><span class="muted">${label}</span> ${esc(cardName(cardOf(uid).card))}</div>` : '';
  const pm = plan.play && { build: 'Build', scrap: 'Scrap', action: 'Play' }[plan.play.mode];
  $('#lockedSummary').innerHTML = line(pm || 'Play', plan.play && plan.play.uid) + line(`◀ ${esc(v.players[v.me.left].name)}`, plan.left) + line(`${esc(v.players[v.me.right].name)} ▶`, plan.right) + line('Keep', plan.reserve) + (plan.commit ? `<div><span class="muted">Drive</span> 1 ${plan.commit} crate</div>` : '');
  $('#lockedWait').textContent = ready === v.players.length ? 'Everyone is ready!' : `Waiting for ${v.players.filter(p => !p.ready).map(p => p.name).join(', ')}…`;
}

// ---------------- toast ----------------
let toastT;
function toast(msg, kind = 'bad') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind;
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2600);
}
