// Phone controller: pick a department, then plan your round on your own 4×4 grid.
// The TV is the authority: every edit is sent as a draft plan, and the TV sends back a cleaned-up view.
import { DEPTS, DEPT_INFO, MACHINES, TECHS, TERRAIN, OVERCLOCK, CONFIG, THROTTLE } from '../config.js';
import { THEME } from '../theme.js';
import { gridAfterMoves } from '../engine/engine.js';
import { joinRoom } from '../../../shared/net.js';
import { gridSvg } from './board.js';
import { resIcon, deptBadge, machineSvg } from './icons.js';
import { esc, W, COLS, NCELLS, cellName, dn, dc, mn, tag, recapLines } from './text.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
let pid = store.get('wc-pid');
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 10); store.set('wc-pid', pid); }

let conn = null, view = null, code = null, seq = 0, gotReply = false, lastMsg = 0, lastViewSeq = 0;
let plan = null, planRound = 0, lastEdit = 0, sendTimer = null;
let sel = null, mode = null; // mode: {kind:'move', from} | {kind:'tech', tech}

$('#logo').innerHTML = `${esc(THEME.title[0])}<br><b>${esc(THEME.title[1])}</b>`;
document.title = THEME.title.join(' ') + ' · Phone';

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
  setInterval(() => { if (!gotReply || Date.now() - lastMsg > 15000) { conn.reconnect && conn.reconnect(); hello(); } }, 2500);
  hello();
  setTimeout(() => { if (!gotReply) $('#joinMsg').textContent = 'Still connecting… This can take up to a minute. If it never connects, the TV\'s network is probably blocking it: try hosting from another device.'; }, 20000);
}
function hello() { if (conn) conn.send({ type: 'hello', name: store.get('wc-name'), reclaim: true }); }
let lock = null;
async function wakeLock() { try { lock = await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conn) { wakeLock(); gotReply = false; conn.reconnect && conn.reconnect(); hello(); }
});
const sendMsg = m => conn && conn.send({ ...m, seq: ++seq });
const act = action => sendMsg({ type: 'action', action });

function onMessage(msg) {
  gotReply = true; lastMsg = Date.now();
  if (msg.seq) { if (msg.seq < lastViewSeq) return; lastViewSeq = msg.seq; }
  if (msg.type === 'lobby') { view = null; return renderPick(msg.claims, msg.you, false); }
  if (msg.type === 'pick') { view = null; return renderPick(msg.claims, null, true); }
  if (msg.type === 'view') { view = msg.view; return render(); }
  if (msg.type === 'reject') return toast(msg.error);
  if (msg.type === 'toast') return toast(msg.text);
}

// ---------------- screens ----------------
function show(id) {
  for (const s of ['#join', '#wait', '#plan', '#locked']) $(s).classList.toggle('hidden', s !== id);
  $('#top').classList.toggle('hidden', id === '#join');
}
function topBar(d) {
  const t = $('#top');
  if (!d) { t.innerHTML = `<span class="me-name">${esc(store.get('wc-name') || '')}</span><span class="spacer"></span><span class="muted">Room ${esc(code || '')}</span>`; t.style.removeProperty('--c'); return; }
  const me = view.me, h = me.hold;
  t.style.setProperty('--c', dc(d));
  const left = me.left || {};
  t.innerHTML = `${deptBadge(dc(d), DEPT_INFO[d].short[0], 30)}<span class="me-name">${esc(dn(d))}</span><span class="spacer"></span>
    <span class="me-round">R${view.round}/${view.rounds}</span>
    <span class="me-hold">${resIcon('plates', 18)}<b>${left.plates != null ? left.plates : h.plates}</b>${left.plates != null && left.plates !== h.plates ? `<small>/${h.plates}</small>` : ''}</span>
    ${d === 'loco' || h.gears ? `<span class="me-hold">${resIcon('gears', 18)}<b>${h.gears}</b></span>` : ''}
    ${d === 'research' ? `<span class="me-hold">${resIcon('insight', 18)}<b>${left.insight != null ? left.insight : h.insight}</b></span>` : ''}
    ${d === 'research' && h.cores ? `<span class="me-hold">${resIcon('cores', 18)}<b>${h.cores}</b></span>` : ''}`;
}

function renderPick(claims, you, midGame) {
  show('#wait'); topBar(null);
  const w = $('#wait');
  w.innerHTML = `<h2 class="title center">${you ? 'You\'re in' : midGame ? 'Take over a car' : 'Pick your car'}</h2>
    <p class="muted center">${you ? `Waiting for the TV to start. You can still switch.` : midGame ? `The game is running. Bots are driving these; tap one to take it over.` : `Bots run any car nobody picks.`}</p>
    <div class="picks">${DEPTS.map(d => {
      const info = DEPT_INFO[d], who = claims[d], mine = you === d;
      const taken = who && !mine;
      return `<button class="pick ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}" data-d="${d}" style="--c:${info.color}" ${taken ? 'disabled' : ''}>
        ${deptBadge(info.color, info.short[0], 40)}
        <span class="pick-main"><b>${esc(info.name)}</b> <span class="pips">${'●'.repeat(info.difficulty)}${'○'.repeat(3 - info.difficulty)}</span>
        <span class="pick-blurb">${esc(info.blurb)}</span></span>
        <span class="pick-who">${mine ? 'YOU' : who ? esc(who) : 'bot'}</span></button>`;
    }).join('')}</div>
    ${you ? `<button id="unclaim" class="btn secondary wide">Leave ${esc(dn(you))}</button>` : ''}`;
  w.querySelectorAll('.pick').forEach(b => b.onclick = () => sendMsg({ type: 'claim', dept: b.dataset.d }));
  const u = $('#unclaim'); if (u) u.onclick = () => sendMsg({ type: 'unclaim' });
}

function render() {
  const v = view; if (!v || !v.me) return;
  const d = v.me.dept;
  topBar(d);
  if (v.phase === 'over' && !v.replaying) return renderOver();
  if (v.phase !== 'plan' || v.replaying) return renderWatch();
  // adopt the TV's cleaned-up plan unless we've edited in the last moment
  if (!plan || planRound !== v.round || Date.now() - lastEdit > 700) { plan = JSON.parse(JSON.stringify(v.me.plan)); planRound = v.round; }
  if (v.me.ready) return renderLocked();
  renderPlan();
}

function renderWatch() {
  show('#wait');
  const L = view.last;
  $('#wait').innerHTML = `<div class="watch-art">${machineSvg(view.me.dept === 'loco' ? 'engine' : 'module', dc(view.me.dept))}</div>
    <h2 class="title center">Watch the TV</h2>
    <p class="muted center">The ${esc(W.city)} is rolling.</p>
    ${L && L.ev && !view.replaying ? `<div class="recap">${recapLines(L.ev, 6).map(l => `<div>${l}</div>`).join('')}</div>` : ''}`;
}
function renderOver() {
  show('#wait');
  const o = view.outcome || {};
  $('#wait').innerHTML = `<h2 class="title center">${esc(o.win ? THEME.win : (THEME.lose[o.reason] || THEME.lose.caught))}</h2>
    <div class="score-big center"><span>${view.city}</span><small>/ ${view.haven} ${esc(W.strides)}</small></div>
    ${view.last && view.last.ev ? `<div class="recap">${recapLines(view.last.ev, 4).map(l => `<div>${l}</div>`).join('')}</div>` : ''}
    <p class="muted center">Play again from the TV.</p>`;
}
function renderLocked() {
  show('#locked');
  const v = view, d = v.me.dept;
  const waiting = DEPTS.filter(x => !v.depts[x].ready);
  $('#locked').innerHTML = `<div class="grid-box small">${myGrid(false)}</div>
    <h2 class="title center">Locked in</h2>
    <div class="locked-summary">${summary(d).map(s => `<div>${s}</div>`).join('')}</div>
    <p class="muted center">${waiting.length ? 'Waiting for ' + waiting.map(x => tag(x)).join(', ') : 'Everyone is ready.'}</p>
    <button id="changeBtn" class="btn secondary wide">Change my plan</button>`;
  $('#changeBtn').onclick = () => act({ type: 'unready' });
}
function summary(d) {
  const out = [], b = plan.build;
  if (b && b.type) out.push(`Build ${esc(mn(b.type))} at ${cellName(b.cell)}`);
  if (b && b.upgrade != null) out.push(`Upgrade ${cellName(b.upgrade)}`);
  if (b && b.tech) out.push(`Install ${esc(TECHS[b.tech].name)} at ${cellName(b.cell)}`);
  if (plan.moves.length) out.push(`${plan.moves.length} move${plan.moves.length > 1 ? 's' : ''}`);
  if (d !== 'power' && plan.asks.power) out.push(`Asking ${plan.asks.power} ${W.power} (pledged ${view.me.pledgedToMe.power - view.me.aux})`);
  if (plan.asks.plates) out.push(`Asking ${plan.asks.plates} ${W.plates} (pledged ${view.me.pledgedToMe.plates})`);
  if (d === 'loco' && view.projection) out.push(`Planned: <b class="c-stride">${view.projection.dist} ${W.strides}</b> vs ${W.storm} +${view.speedNow}`);
  return out;
}

// ---------------- planning ----------------
function edit(fn) {
  fn(plan);
  lastEdit = Date.now();
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => act({ type: 'draft', plan }), 120);
  renderPlan();
}
const startGrid = () => view.depts[view.me.dept].grid;
const curGrid = () => gridAfterMoves(startGrid(), plan.moves);

function myGrid(tap = true) {
  const d = view.me.dept, g = curGrid();
  const ghost = plan.build && plan.build.type ? { cell: plan.build.cell, type: plan.build.type } : plan.build && plan.build.tech ? { cell: plan.build.cell, type: 'module' } : null;
  const lanes = {};
  for (const c of plan.covReq || []) lanes[c] = 'req';
  if (d === 'shield') for (const s of view.me.strikes || []) if (s.dept === 'shield' && s.at >= 0) lanes[s.at] = 'warn';
  const sg = startGrid(), moved = new Set(); g.forEach((m, i) => { if (m && (!sg[i] || sg[i].id !== m.id)) moved.add(i); });
  const cells = g.map((m, i) => { const sc = (view.me.cells || [])[i] || {}; return m ? { ...sc, moved: moved.has(i) } : null; });
  const hl = new Set();
  if (mode && mode.kind === 'move') for (let i = 0; i < NCELLS; i++) if (i !== mode.from) hl.add(i);
  if (mode && mode.kind === 'tech') for (let i = 0; i < NCELLS; i++) if (!g[i]) hl.add(i);
  return gridSvg(g, dc(d), { letters: true, tap, sel, ghost, dials: plan.dials, cells, heatCap: view.me.heatCap, lanes, hl, upgrade: plan.build && plan.build.upgrade != null ? plan.build.upgrade : null });
}

function renderPlan() {
  show('#plan');
  const v = view, d = v.me.dept;
  $('#asks').innerHTML = asksStrip(d);
  $('#gridBox').innerHTML = myGrid(true);
  $('#gridBox').querySelectorAll('.tile').forEach(t => t.onclick = () => tapCell(+t.dataset.cell));
  $('#sheet').innerHTML = sheet(d);
  bindSheet();
  $('#role').innerHTML = rolePanel(d);
  bindRole(d);
  $('#readyBtn').onclick = () => { clearTimeout(sendTimer); act({ type: 'ready', plan }); };
  $('#autoBtn').onclick = () => { lastEdit = 0; act({ type: 'autopilot' }); };
}

function tapCell(i) {
  const g = curGrid();
  if (mode && mode.kind === 'move') {
    const from = mode.from; mode = null;
    if (i !== from) {
      edit(p => {
        p.moves.push([from, i]);
        const a = p.dials[from], b = p.dials[i]; delete p.dials[from]; delete p.dials[i];
        if (a != null) p.dials[i] = a; if (b != null) p.dials[from] = b;
        if (p.build && p.build.upgrade === from) p.build.upgrade = i; else if (p.build && p.build.upgrade === i) p.build.upgrade = from;
      });
      sel = i; renderPlan(); return;
    }
  }
  if (mode && mode.kind === 'tech') {
    const t = mode.tech; mode = null;
    if (!g[i]) { sel = i; edit(p => { p.build = { tech: t, cell: i }; }); return; }
  }
  sel = sel === i ? null : i;
  renderPlan();
}

// The panel under the grid for the selected cell.
function sheet(d) {
  if (mode && mode.kind === 'move') return `<div class="sh"><b>Moving ${esc(mn(curGrid()[mode.from].type))}</b><span class="muted"> Tap where it should go.</span> <button class="mini" data-x="cancel">Cancel</button></div>`;
  if (mode && mode.kind === 'tech') return `<div class="sh"><b>Install ${esc(TECHS[mode.tech].name)}</b><span class="muted"> Tap an empty cell next to a ${esc(mn('uplink'))}.</span> <button class="mini" data-x="cancel">Cancel</button></div>`;
  if (sel == null) {
    const free = view.me.freeMoves;
    return `<div class="sh muted">Tap an empty cell to build, or a machine to set it. First ${free > 1 ? free + ' moves are' : 'move is'} free; more moved machines sit idle a round.${plan.moves.length ? ` <button class="mini" data-x="undo-moves">Undo moves</button>` : ''}</div>`;
  }
  const g = curGrid(), m = g[sel], me = view.me, left = me.left || {};
  const b = plan.build;
  if (!m) {
    if (b && (b.type || b.tech) && b.cell === sel) return `<div class="sh"><b>${b.tech ? esc(TECHS[b.tech].name) : esc(mn(b.type))}</b> will be built here. <button class="mini" data-x="unbuild">Cancel</button></div>`;
    const plates = (left.plates || 0) + (b && b.type ? me.buildable.find(x => x.type === b.type).cost : 0);
    return `<div class="sh"><div class="sh-h">Build at ${cellName(sel)} <span class="muted">(${b ? 'replaces your current build' : 'one build or upgrade a round'})</span></div>
      <div class="builds">${me.buildable.map(x => {
        const can = x.cost <= plates;
        const isNext = plan.next && plan.next.type === x.type;
        return `<div class="bld ${can ? '' : 'poor'}"><div class="bld-ico">${machineSvg(x.type, dc(d))}</div>
          <div class="bld-main"><b>${esc(mn(x.type))}</b> <span class="cost">${resIcon('plates', 14)}${x.cost}</span><span class="bld-t">${esc(MACHINES[x.type].text)}</span></div>
          ${can ? `<button class="mini go" data-build="${x.type}">Build</button>` : `<button class="mini ${isNext ? 'on' : ''}" data-next="${x.type}">${isNext ? 'Asking' : 'Ask for ' + W.plates}</button>`}</div>`;
      }).join('')}</div></div>`;
  }
  const def = MACHINES[m.type], c = (me.cells || [])[sel] || {};
  const rows = [];
  if (m.type === 'reactor' || m.type === 'turbine') {
    const [lo, hi] = c.range || [0, 0], v = plan.dials[sel] || 0;
    rows.push(`<div class="dial">${resIcon('power', 18)} Output <button class="step" data-dial="-1">−</button><b>${v}</b><button class="step" data-dial="1">+</button>
      <span class="muted">${m.type === 'reactor' ? `${lo}–${hi} this round, or 0` : `max ${hi}${v > Math.floor(MACHINES.turbine.max[m.lvl - 1] / 2) ? ' · will run Hot' : ''}`}</span></div>`);
  }
  if (m.type === 'engine') {
    const v = plan.dials[sel] || 0, maxT = c.maxT != null ? c.maxT : 3;
    rows.push(`<div class="dial">Throttle ${[0, 1, 2, 3].map(t => `<button class="tbtn ${t === v ? 'on' : ''}" data-thr="${t}" ${t > maxT ? 'disabled' : ''}>T${t}</button>`).join('')}</div>
      <div class="muted small">T${v}: ${THROTTLE.draw[v]} ${W.power}, +${THROTTLE.heat[v]} heat${v === 3 ? ', burns a gear' : ''} · ${MACHINES.engine.strides[m.lvl - 1][v]} ${W.strides} · heat ${c.startHeat || 0}/${me.heatCap}</div>`);
  }
  const btns = [];
  if (b && b.upgrade === sel) btns.push(`<button class="mini on" data-x="unbuild">Cancel upgrade</button>`);
  else if (c.upgradeCost != null) btns.push(`<button class="mini go" data-x="upgrade" ${c.upgradeCost > (left.plates || 0) + (b && b.upgrade != null ? 0 : 0) ? 'disabled' : ''}>Upgrade ${resIcon('plates', 14)}${c.upgradeCost}</button>`);
  else if (c.lockedUpgrade) btns.push(`<button class="mini ${plan.next && plan.next.upgrade === sel ? 'on' : ''}" data-x="want-up">Need a ${esc(W.blueprint)} from ${esc(dn('research'))}</button>`);
  if (c.upgradeCost != null && c.upgradeCost > (left.plates || 0) && !(b && b.upgrade === sel)) btns.push(`<button class="mini ${plan.next && plan.next.upgrade === sel ? 'on' : ''}" data-x="next-up">${plan.next && plan.next.upgrade === sel ? 'Asking' : 'Ask for ' + W.plates}</button>`);
  if (m.jam) btns.push(`<button class="mini ${plan.repairs.includes(sel) ? 'on' : ''}" data-x="repair">Repair ${resIcon('plates', 14)}${CONFIG.repairCost}</button>`);
  btns.push(`<button class="mini" data-x="move">Move</button>`);
  return `<div class="sh"><div class="sh-h"><b>${esc(mn(m.type))}</b> ${def.levels > 1 ? `<span class="muted">level ${m.lvl}/${def.levels}</span>` : ''} <span class="muted">${cellName(sel)}</span></div>
    <div class="muted small">${esc(m.type === 'module' && m.tech ? TECHS[m.tech].name + ': ' + TECHS[m.tech].text : def.text)}</div>${rows.join('')}<div class="btns">${btns.join('')}</div></div>`;
}
function bindSheet() {
  const S = $('#sheet');
  S.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
    const x = b.dataset.x;
    if (x === 'cancel') { mode = null; return renderPlan(); }
    if (x === 'undo-moves') return edit(p => { p.moves = []; sel = null; });
    if (x === 'unbuild') return edit(p => { p.build = null; });
    if (x === 'upgrade') return edit(p => { p.build = { upgrade: sel }; if (p.next && p.next.upgrade === sel) p.next = null; });
    if (x === 'want-up' || x === 'next-up') return edit(p => { p.next = p.next && p.next.upgrade === sel ? null : { upgrade: sel }; });
    if (x === 'repair') return edit(p => { p.repairs = p.repairs.includes(sel) ? p.repairs.filter(r => r !== sel) : [...p.repairs, sel]; });
    if (x === 'move') { mode = { kind: 'move', from: sel }; return renderPlan(); }
  });
  S.querySelectorAll('[data-build]').forEach(b => b.onclick = () => edit(p => { p.build = { type: b.dataset.build, cell: sel }; if (p.next && p.next.type === b.dataset.build) p.next = null; }));
  S.querySelectorAll('[data-next]').forEach(b => b.onclick = () => edit(p => { p.next = p.next && p.next.type === b.dataset.next ? null : { type: b.dataset.next }; }));
  S.querySelectorAll('[data-dial]').forEach(b => b.onclick = () => {
    const c = (view.me.cells || [])[sel] || {}, [lo, hi] = c.range || [0, 0];
    const m = curGrid()[sel];
    let v = (plan.dials[sel] || 0) + Number(b.dataset.dial);
    if (m.type === 'reactor') { if (v > 0 && v < lo) v = Number(b.dataset.dial) > 0 ? lo : 0; }
    v = Math.max(0, Math.min(hi, v));
    edit(p => { p.dials[sel] = v; });
  });
  S.querySelectorAll('[data-thr]').forEach(b => b.onclick = () => edit(p => { p.dials[sel] = Number(b.dataset.thr); }));
}

// What you're asking for and what's pledged to you (everyone sees this at the top).
function asksStrip(d) {
  const me = view.me, a = plan.asks || {}, got = me.pledgedToMe;
  const parts = [];
  const want = (res, ask, have, who) => `<span class="ask ${have < ask ? 'short' : 'ok'}">${resIcon(res, 16)} ${have}<small>/${ask}</small> <span class="muted">from ${esc(DEPT_INFO[who].short)}</span></span>`;
  if (d !== 'power' && a.power) parts.push(want('power', a.power, got.power - me.aux, 'power'));
  if (a.plates) parts.push(want('plates', a.plates, got.plates, 'fab'));
  if (d === 'loco' && a.gears) parts.push(want('gears', a.gears, got.gears, 'fab'));
  if (d === 'research' && a.cores) parts.push(want('cores', a.cores, got.cores, 'fab'));
  const p = view.projection;
  const race = p ? `<span class="race">${esc(W.City)} <b class="c-stride">+${p.dist}</b> vs ${esc(W.storm)} <b class="c-storm">+${view.speedNow}</b></span>` : '';
  return `${race}${parts.length ? parts.join('') : '<span class="muted">You need nothing from others this round.</span>'}`;
}

// ---------------- role panels ----------------
const stepper = (key, v, label, ask, color) => `<div class="srow" style="--c:${color || 'var(--text)'}"><span class="sname">${label}</span>
  ${ask != null ? `<span class="sask ${v < ask ? 'short' : ''}">asks ${ask}</span>` : '<span></span>'}
  <button class="step" data-k="${key}" data-s="-1">−</button><b class="sval">${v}</b><button class="step" data-k="${key}" data-s="1">+</button></div>`;

function rolePanel(d) {
  const me = view.me, p = view.projection;
  if (d === 'power') {
    const make = Object.entries(plan.dials).reduce((s, [i, v]) => s + v, 0);
    const store = curGrid().reduce((s, m) => s + (m && m.type === 'capacitor' ? m.store || 0 : 0), 0);
    const pledged = plan.order.reduce((s, x) => s + ((plan.outbox[x] || {}).power || 0), 0);
    return `<div class="rp"><div class="rp-h">${resIcon('power', 20)} Making <b>${make}</b> <span class="muted">+ ${store} stored</span> · pledged <b class="${pledged > make + store ? 'c-bad' : ''}">${pledged}</b>
</div>
      <div class="btns"><button class="mini go" data-fill="power">Pledge what's asked</button><button class="mini go" data-x2="fit">Raise output to cover pledges</button></div>
      <div class="muted small">Delivered in this order when short. Leftover ≥ ${CONFIG.surgeAt} after tanks trips your biggest generator.</div>
      ${plan.order.map((x, k) => stepper('pw:' + x, (plan.outbox[x] || {}).power || 0, `${k ? `<button class="up" data-up="${x}">▲</button>` : '<span class="up"></span>'}${esc(dn(x))}${x === 'loco' && me.asksOfMe.loco.sprint ? ' <span class="sprint">sprint</span>' : ''}`, me.asksOfMe[x].power, dc(x))).join('')}</div>`;
  }
  if (d === 'fab') {
    const fc = me.fabCaps || {};
    return `<div class="rp"><div class="rp-h">Line: ${resIcon('ore', 18)}${fc.ore} → smelt ${fc.smelt} → ${resIcon('plates', 18)}<b>${p ? p.plates : fc.plates}</b>${p && p.ore ? '' : ''} · press ${fc.press} · assemble ${fc.asm}</div>
      ${stepper('rc:gears', plan.recipe.gears, `${resIcon('gears', 16)} ${esc(W.gears)} to make <span class="muted">(2 ${W.plates} each)</span>`, me.asksOfMe.loco.gears, dc('loco'))}
      ${stepper('rc:cores', plan.recipe.cores, `${resIcon('cores', 16)} ${esc(W.cores)} to make <span class="muted">(gear + ${W.plate || 'plate'})</span>`, me.asksOfMe.research.cores, dc('research'))}
      <div class="rp-h">${resIcon('plates', 18)} ${esc(W.plates)} to send <button class="mini go" data-fill="plates">Match asks</button></div>
      ${plan.order.filter(x => x !== 'fab').map(x => stepper('pl:' + x, (plan.outbox[x] || {}).plates || 0, esc(dn(x)), me.asksOfMe[x].plates, dc(x))).join('')}
      <div class="muted small">Whatever isn't sent stays with you.</div></div>`;
  }
  if (d === 'loco') {
    const fork = me.forkInfo || [];
    return `<div class="rp"><div class="rp-h">${esc(W.route)} this round</div>
      <div class="routes">${fork.map((f, k) => `<button class="route ${plan.route === k ? 'on' : ''}" data-route="${k}"><b>${esc(TERRAIN[f.id].name)}</b><span>${esc(TERRAIN[f.id].text)}</span></button>`).join('')}</div>
      <label class="tog"><input type="checkbox" id="sprint" ${plan.sprint ? 'checked' : ''}> Tell ${esc(dn('power'))} to ramp up for next round</label>
      ${p ? `<div class="rp-h">Planned: <b class="c-stride">${p.strides} × ${p.grade} = ${p.dist} ${esc(W.strides)}</b></div>` : ''}
      ${covReqRow()}</div>`;
  }
  if (d === 'shield') return shieldPanel();
  if (d === 'research') return researchPanel();
  return '';
}
function covReqRow() {
  return `<div class="rp-h small">Ask ${esc(dn('shield'))} to ${esc(W.cover)}: ${[...COLS].map((_, c) => `<button class="tbtn ${plan.covReq.includes(c) ? 'on' : ''}" data-req="${c}">${COLS[c]}</button>`).join('')}</div>`;
}

function shieldPanel() {
  const me = view.me, cap = me.capacity || { projectors: [], armory: 0, oc: 0 };
  const strikes = me.strikes || [];
  const used = {}; for (const c of plan.covers) used[c.src] = (used[c.src] || 0) + 1;
  const srcFor = (x, col) => {
    const opts = [];
    for (const pj of cap.projectors) if (pj.cols.includes(col) && (used[pj.cell] || 0) < pj.covers && !plan.covers.some(c => c.src === pj.cell && c.dept === x)) opts.push(pj.cell);
    if ((used.oc || 0) < cap.oc) opts.push('oc');
    if ((used.armory || 0) < cap.armory && (me.left.plates || 0) >= 2) opts.push('armory');
    return opts;
  };
  const rows = DEPTS.map(x => {
    const lanes = me.lanes[x];
    return `<div class="sm-row"><span class="sm-name" style="color:${dc(x)}">${esc(DEPT_INFO[x].short)}</span>${[...COLS].map((_, c) => {
      const st = strikes.find(s => s.dept === x && s.at === c);
      const nx = (me.strikesNext || []).some(s => s.dept === x && s.col === c);
      const cov = plan.covers.find(k => k.dept === x && k.col === c);
      const req = (me.covReqs[x] || []).includes(c);
      const n = lanes[c].filter(Boolean).length;
      const can = st && !cov && srcFor(x, c).length;
      return `<button class="sm-cell ${st ? 'strike' : ''} ${cov ? 'cov' : ''} ${req ? 'req' : ''} ${nx ? 'next' : ''}" data-cov="${x}:${c}" ${st || cov ? '' : 'disabled'}>
        <span class="sm-n">${n ? n : ''}</span>${st ? `<span class="sm-b">${cov ? '✓' : can ? '⚡' : '⚡'}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }).join('');
  const projLeft = cap.projectors.reduce((s, pj) => s + pj.covers - (used[pj.cell] || 0), 0);
  return `<div class="rp"><div class="rp-h">${esc(W.Lightning)} map: <b>${strikes.length}</b> this round <span class="muted">(numbers = machines in that column)</span></div>
    <div class="sm"><div class="sm-row"><span class="sm-name"></span>${[...COLS].map((_, c) => `<span class="sm-col">${COLS[c]}</span>`).join('')}</div>${rows}</div>
    <div class="muted small">Tap a struck column to ${esc(W.cover)} it. ${esc(mn('projector'))}s left: ${projLeft}${cap.armory ? ` · ${esc(mn('armory'))}: ${cap.armory - (used.armory || 0)} (2 ${W.plates} each)` : ''}${cap.oc ? ` · boost: ${cap.oc - (used.oc || 0)}` : ''}. Gold = someone asked. ${me.strikesNext ? 'Dotted = next round.' : ''}</div></div>`;
}

function researchPanel() {
  const me = view.me, left = me.left || {};
  const ins = left.insight != null ? left.insight : me.hold.insight;
  const nf = me.nextFork;
  const bp = DEPTS.map(x => {
    const u = me.unlocks[x];
    const on = plan.unlock === x;
    return `<button class="bp ${on ? 'on' : ''} ${u.wants ? 'wants' : ''}" data-unlock="${x}" ${u.cost == null || (!on && u.cost > ins) ? 'disabled' : ''} style="--c:${dc(x)}">
      <b>${esc(DEPT_INFO[x].short)}</b><span>LV ${u.level}${u.cost != null ? ` → ${u.level + 1}` : ' max'}</span>${u.cost != null ? `<span>${resIcon('insight', 12)}${u.cost}</span>` : ''}${u.wants ? '<i>asked</i>' : ''}</button>`;
  }).join('');
  const shelf = (me.shelf || []).map(t => {
    const on = plan.build && plan.build.tech === t.id;
    return `<div class="tech-c ${on ? 'on' : ''}"><b>${esc(TECHS[t.id].name)}</b> <span class="cost">${resIcon('insight', 12)}${t.cost}</span><span class="muted small">${esc(TECHS[t.id].text)}</span>
      <button class="mini ${on ? 'on' : 'go'}" data-tech="${t.id}" ${!on && t.cost > ins ? 'disabled' : ''}>${on ? 'Cancel' : 'Install'}</button></div>`;
  }).join('');
  const oc = ['power', 'fab', 'loco', 'shield'].map(x => `<button class="tbtn ${plan.overclock.includes(x) ? 'on' : ''}" data-oc="${x}" title="${esc(OVERCLOCK[x].text)}" style="--c:${dc(x)}">${esc(DEPT_INFO[x].short)}</button>`).join('');
  return `<div class="rp">
    ${nf ? `<div class="rp-h">Next round's ${esc(W.route)}: ${nf.map(t => `<b>${esc(TERRAIN[t].name)}</b>`).join(' or ')} <span class="muted">(only you see this)</span></div>` : ''}
    <div class="rp-h">${esc(W.blueprint)}s <span class="muted">(one a round, unlocks the next level for a car)</span></div><div class="bps">${bp}</div>
    <div class="rp-h">Boost <span class="muted">(${OVERCLOCK.cost} ${esc(W.insight)} each, up to ${me.ocCap})</span> ${oc}</div>
    <div class="muted small">${['power', 'fab', 'loco', 'shield'].map(x => `${esc(DEPT_INFO[x].short)}: ${esc(OVERCLOCK[x].text)}`).join(' · ')}</div>
    ${shelf ? `<div class="rp-h">Upgrades on offer <span class="muted">(install on an empty cell next to a ${esc(mn('uplink'))})</span></div>${shelf}` : ''}
    ${covReqRow()}</div>`;
}

function bindRole(d) {
  const R = $('#role');
  R.querySelectorAll('.step[data-k]').forEach(b => b.onclick = () => {
    const [kind, x] = b.dataset.k.split(':'), s = Number(b.dataset.s);
    edit(p => {
      if (kind === 'pw') { p.outbox[x] = { power: Math.max(0, ((p.outbox[x] || {}).power || 0) + s) }; }
      if (kind === 'pl') { p.outbox[x] = { plates: Math.max(0, ((p.outbox[x] || {}).plates || 0) + s) }; }
      if (kind === 'rc') p.recipe[x] = Math.max(0, (p.recipe[x] || 0) + s);
    });
  });
  R.querySelectorAll('[data-up]').forEach(b => b.onclick = () => edit(p => { const i = p.order.indexOf(b.dataset.up); if (i > 0) { p.order.splice(i, 1); p.order.splice(i - 1, 0, b.dataset.up); } }));
  R.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => edit(p => {
    const res = b.dataset.fill;
    for (const x of p.order) if (x !== 'fab' || res === 'power') p.outbox[x] = { [res]: (view.me.asksOfMe[x] || {})[res] || 0 };
    if (res === 'plates') { p.recipe.gears = view.me.asksOfMe.loco.gears || 0; p.recipe.cores = view.me.asksOfMe.research.cores || 0; }
  }));
  R.querySelectorAll('[data-x2="fit"]').forEach(b => b.onclick = () => edit(p => {
    const g = curGrid(), cells = view.me.cells || [];
    const store = g.reduce((s, m) => s + (m && m.type === 'capacitor' ? m.store || 0 : 0), 0);
    const want = p.order.reduce((s, x) => s + ((p.outbox[x] || {}).power || 0), 0) - store;
    let have = Object.values(p.dials).reduce((s, v) => s + v, 0);
    for (const type of ['reactor', 'turbine']) g.forEach((m, i) => {
      if (!m || m.type !== type || have >= want) return;
      const hi = ((cells[i] || {}).range || [0, 0])[1], cur = p.dials[i] || 0;
      let nv = Math.min(hi, cur + (want - have));
      if (type === 'reactor' && nv > 0) nv = Math.max(nv, ((cells[i] || {}).range || [0])[0]);
      have += nv - cur; p.dials[i] = nv;
    });
    if (have < want) toast(`Your machines can make ${have} this round (plus ${store} stored). Lower a pledge or build more.`);
  }));
  R.querySelectorAll('[data-route]').forEach(b => b.onclick = () => edit(p => { p.route = Number(b.dataset.route); }));
  const sp = R.querySelector('#sprint'); if (sp) sp.onchange = () => edit(p => { p.sprint = sp.checked; });
  R.querySelectorAll('[data-req]').forEach(b => b.onclick = () => edit(p => { const c = Number(b.dataset.req); p.covReq = p.covReq.includes(c) ? p.covReq.filter(x => x !== c) : [...p.covReq, c]; }));
  R.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => edit(p => { p.unlock = p.unlock === b.dataset.unlock ? null : b.dataset.unlock; }));
  R.querySelectorAll('[data-oc]').forEach(b => b.onclick = () => edit(p => { const x = b.dataset.oc; p.overclock = p.overclock.includes(x) ? p.overclock.filter(o => o !== x) : [...p.overclock, x]; }));
  R.querySelectorAll('[data-tech]').forEach(b => b.onclick = () => {
    const t = b.dataset.tech;
    if (plan.build && plan.build.tech === t) return edit(p => { p.build = null; });
    mode = { kind: 'tech', tech: t }; sel = null; renderPlan(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  R.querySelectorAll('[data-cov]').forEach(b => b.onclick = () => {
    const [x, cs] = b.dataset.cov.split(':'), col = Number(cs);
    edit(p => {
      const k = p.covers.findIndex(c => c.dept === x && c.col === col);
      if (k >= 0) { p.covers.splice(k, 1); return; }
      const cap = view.me.capacity || { projectors: [], armory: 0, oc: 0 };
      const used = {}; for (const c of p.covers) used[c.src] = (used[c.src] || 0) + 1;
      const pj = cap.projectors.find(q => q.cols.includes(col) && (used[q.cell] || 0) < q.covers && !p.covers.some(c => c.src === q.cell && c.dept === x));
      if (pj) return p.covers.push({ dept: x, col, src: pj.cell });
      if ((used.oc || 0) < cap.oc) return p.covers.push({ dept: x, col, src: 'oc' });
      if ((used.armory || 0) < cap.armory) return p.covers.push({ dept: x, col, src: 'armory' });
      toast(`Nothing can ${W.cover} column ${COLS[col]} right now. A ${mn('projector')} covers its own column.`);
    });
  });
}

// ---------------- toast ----------------
let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}
