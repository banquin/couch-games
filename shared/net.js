// Networking: a dumb pipe between the TV (host) and phones.
// Three interchangeable transports with the same API:
//   relay — our tiny node server (server.js), best on home Wi-Fi
//   peer  — PeerJS/WebRTC via the free public broker, works from any static host
//   local — BroadcastChannel, for testing with several tabs on one computer
// The host API:   hostRoom(code, {onJoin, onLeave, onMessage}) -> {send(pid,msg), broadcast(msg)}
//                  (optional handlers: onReplaced — another TV tab took over this room)
// The phone API:  joinRoom(code, pid, {onOpen, onClose, onMessage, onNoHost}) -> {send(msg), reconnect()}
//   Call reconnect() when the phone wakes up; it is cheap and safe to call any time.

const PEER_PREFIX = 'couchgames-v1-';
// Relay endpoints live at the site root next to server.js (works even if the site is in a subfolder).
const RELAY = path => new URL('../relay/' + path, import.meta.url).toString();

export async function pickTransport() {
  const forced = new URLSearchParams(location.search).get('net');
  if (forced) return forced;
  // Our relay server only speaks plain http, so an https page is a static host: go straight to PeerJS.
  if (location.protocol === 'https:') return 'peer';
  try {
    const r = await fetch(RELAY('ping'), { cache: 'no-store' });
    if (r.ok && (await r.json()).ok) return 'relay';
  } catch (e) {}
  return 'peer';
}

// STUN finds a direct route; TURN relays through PeerJS's free servers when a network blocks
// direct links (the TCP variants help on networks that block UDP).
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478',
           'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp'],
    username: 'peerjs', credential: 'peerjsp' },
];
function peerOptions() {
  // ?peerhost=localhost:9000 lets us test against a local PeerServer.
  const q = new URLSearchParams(location.search).get('peerhost');
  if (!q) return { debug: 1, config: { iceServers: ICE } };
  const [host, port] = q.split(':');
  return { host, port: Number(port || 9000), path: '/', secure: false, debug: 1, config: { iceServers: ICE } };
}

// ---------- HOST ----------
export async function hostRoom(code, h, kind) {
  kind = kind || await pickTransport();
  if (kind === 'relay') return hostRelay(code, h);
  if (kind === 'local') return hostLocal(code, h);
  if (kind === 'mqtt') return hostMqtt(code, h);
  return hostHybrid(code, h);
}

function hostRelay(code, h) {
  const es = new EventSource(RELAY('events?role=host&room=' + code));
  es.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'relay:replaced') { es.close(); h.onReplaced && h.onReplaced(); }
    else if (m.type === 'relay:join') h.onJoin && h.onJoin(m.from);
    else if (m.type === 'relay:leave') h.onLeave && h.onLeave(m.from);
    else if (m.type === 'msg') h.onMessage(m.from, m.msg);
  };
  const post = (to, msg) => fetch(RELAY('send'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: code, role: 'host', to, msg }) }).catch(() => {});
  return { kind: 'relay', send: (pid, msg) => post(pid, msg), broadcast: msg => post('*', msg) };
}

function hostLocal(code, h) {
  const bc = new BroadcastChannel('oc-' + code);
  bc.onmessage = e => {
    const m = e.data;
    if (m.dir !== 'up') return;
    if (m.type === 'join') h.onJoin && h.onJoin(m.from);
    else if (m.type === 'msg') h.onMessage(m.from, m.msg);
  };
  bc.postMessage({ dir: 'down', type: 'hostup' });
  return { kind: 'local', send: (pid, msg) => bc.postMessage({ dir: 'down', to: pid, msg }),
    broadcast: msg => bc.postMessage({ dir: 'down', to: '*', msg }) };
}

async function hostPeer(code, h) {
  // After a TV refresh the broker may still hold our old id for a few seconds: retry.
  for (let attempt = 0; ; attempt++) {
    try { return await hostPeerOnce(code, h); }
    catch (err) {
      const limit = err && err.type === 'unavailable-id' ? (h.idRetries ?? 5) : 5;
      if (attempt >= limit || (err && err.type !== 'unavailable-id' && err.type !== 'network' && err.type !== 'server-error')) throw err;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

function hostPeerOnce(code, h) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(PEER_PREFIX + code, peerOptions());
    const conns = new Map(); // pid -> conn
    peer.on('open', () => resolve({
      kind: 'peer',
      send: (pid, msg) => { const c = conns.get(pid); if (c && c.open) c.send(msg); },
      broadcast: msg => { for (const c of conns.values()) if (c.open) c.send(msg); },
    }));
    peer.on('error', err => { console.warn('peer error', err); if (!peer.open) { peer.destroy(); reject(err); } });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
    peer.on('connection', conn => {
      const pid = conn.metadata && conn.metadata.pid;
      if (!pid) return conn.close();
      conn.on('open', () => {
        const old = conns.get(pid);
        if (old && old !== conn) { try { old.close(); } catch (e) {} }
        conns.set(pid, conn);
        h.onJoin && h.onJoin(pid);
      });
      conn.on('data', msg => h.onMessage(pid, msg));
      conn.on('close', () => { if (conns.get(pid) === conn) { conns.delete(pid); h.onLeave && h.onLeave(pid); } });
    });
  });
}

// ---------- PHONE ----------
export async function joinRoom(code, pid, h, kind) {
  kind = kind || await pickTransport();
  if (kind === 'relay') return joinRelay(code, pid, h);
  if (kind === 'local') return joinLocal(code, pid, h);
  if (kind === 'mqtt') return joinMqtt(code, pid, h);
  return joinHybrid(code, pid, h);
}

function joinRelay(code, pid, h) {
  let es = null;
  const open = () => {
    if (es) es.close();
    es = new EventSource(RELAY('events?role=player&room=' + code + '&pid=' + encodeURIComponent(pid)));
    es.onerror = () => h.onClose && h.onClose();
    es.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'relay:open') h.onOpen && h.onOpen();
      else if (m.type === 'relay:nohost') h.onNoHost && h.onNoHost();
      else if (m.type === 'msg') h.onMessage(m.msg);
    };
  };
  open();
  return {
    kind: 'relay',
    send: msg => fetch(RELAY('send'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: code, role: 'player', pid, msg }) }).catch(() => {}),
    reconnect: () => { if (!es || es.readyState !== 1) open(); },
  };
}

function joinLocal(code, pid, h) {
  const bc = new BroadcastChannel('oc-' + code);
  bc.onmessage = e => {
    const m = e.data;
    if (m.dir !== 'down') return;
    if (m.type === 'hostup') return bc.postMessage({ dir: 'up', type: 'join', from: pid });
    if (m.to === '*' || m.to === pid) h.onMessage(m.msg);
  };
  bc.postMessage({ dir: 'up', type: 'join', from: pid });
  setTimeout(() => h.onOpen && h.onOpen(), 0);
  return { kind: 'local', send: msg => bc.postMessage({ dir: 'up', type: 'msg', from: pid, msg }), reconnect: () => {} };
}

function joinPeer(code, pid, h) {
  // One attempt at a time: a link through a relay can take several seconds to open, so we never
  // abandon an attempt younger than ATTEMPT_MS, and we only ever send on the link that opened.
  const ATTEMPT_MS = 15000;
  let peer = null, pending = null, live = null, startedAt = 0, retrying = false;
  const connect = () => {
    if (!peer || peer.destroyed || peer.disconnected) {
      try { peer && peer.destroy(); } catch (e) {}
      const p = peer = new window.Peer(undefined, peerOptions());
      p.on('open', () => { if (p === peer) openConn(); });
      p.on('error', err => {
        console.warn('peer error', err);
        if (err && err.type === 'peer-unavailable') { pending = null; h.onNoHost && h.onNoHost(); }
        h.onClose && h.onClose(String((err && err.type) || err));
        setTimeout(retry, 2000);
      });
    } else if (peer.open) openConn();
  };
  const openConn = () => {
    if (pending && !pending.open) { try { pending.close(); } catch (e) {} }
    const c = pending = peer.connect(PEER_PREFIX + code, { metadata: { pid }, reliable: true });
    startedAt = Date.now();
    c.on('open', () => {
      if (live && live !== c) { try { live.close(); } catch (e) {} }
      live = c; if (pending === c) pending = null;
      h.onOpen && h.onOpen();
    });
    c.on('data', msg => { if (c === live) h.onMessage(msg); });
    c.on('error', err => console.warn('conn error', err));
    c.on('close', () => {
      if (c === live) { live = null; h.onClose && h.onClose('closed'); setTimeout(retry, 1500); }
      if (c === pending) pending = null;
    });
  };
  const retry = () => { if (retrying) return; retrying = true; setTimeout(() => { retrying = false; connect(); }, 500); };
  connect();
  return {
    kind: 'peer',
    isOpen: () => !!(live && live.open),
    send: msg => { if (live && live.open) live.send(msg); },
    reconnect: () => {
      if (live && live.open) return;
      if (pending && Date.now() - startedAt < ATTEMPT_MS) return;   // still opening: give it time
      retry();
    },
  };
}

// ---------- RELAY FALLBACK (public MQTT broker over secure WebSocket, port 443) ----------
// Some networks and managed computers block the direct phone-to-TV link that PeerJS opens.
// Then messages go through a free public message relay over the normal web port instead.
// The host always listens on both; a phone switches to the relay if the direct link hasn't
// opened after FALLBACK_MS. Game messages are visible to anyone watching the relay (nothing personal).
const MQTT_URL = 'wss://public.cloud.shiftr.io';
const MQTT_AUTH = { username: 'public', password: 'public' };
const FALLBACK_MS = 7000;
const topicBase = code => 'couchgames-v1/' + code + '/';
let mqttLib = null;
function loadMqtt() {
  return mqttLib || (mqttLib = new Promise((res, rej) => {
    if (window.mqtt) return res(window.mqtt);
    const s = document.createElement('script');
    s.src = new URL('vendor/mqtt.min.js', import.meta.url).toString();
    s.onload = () => res(window.mqtt); s.onerror = () => { mqttLib = null; rej(new Error('relay script failed to load')); };
    document.head.appendChild(s);
  }));
}
async function mqttClient(extra) {
  const lib = await loadMqtt();
  const connect = lib.connect || (lib.default && lib.default.connect);
  return connect(MQTT_URL, { ...MQTT_AUTH, clientId: 'cg-' + Math.random().toString(36).slice(2, 12),
    keepalive: 30, reconnectPeriod: 2000, connectTimeout: 10000, clean: true, ...extra });
}

function hostMqtt(code, h) {
  return new Promise(async (resolve, reject) => {
    const t = topicBase(code), seen = new Set();
    let c;
    try { c = await mqttClient(); } catch (e) { return reject(e); }
    const pub = (to, msg) => { if (c.connected) c.publish(t + 'down/' + to, JSON.stringify({ t: 'msg', msg })); };
    const api = { kind: 'mqtt', send: (pid, msg) => pub(encodeURIComponent(pid), msg), broadcast: msg => pub('all', msg) };
    const timer = setTimeout(() => reject(Object.assign(new Error('relay timeout'), { type: 'network' })), 12000);
    c.on('connect', () => { c.subscribe(t + 'up/+'); clearTimeout(timer); resolve(api); });
    c.on('error', e => console.warn('relay error', e && e.message));
    c.on('message', (topic, buf) => {
      let pid, m;
      try { pid = decodeURIComponent(topic.slice((t + 'up/').length)); m = JSON.parse(buf.toString()); } catch (e) { return; }
      if (!pid || !m) return;
      if (m.t === 'leave') { seen.delete(pid); h.onLeave && h.onLeave(pid); return; }
      if (!seen.has(pid)) { seen.add(pid); h.onJoin && h.onJoin(pid); }
      if (m.t === 'msg') h.onMessage(pid, m.msg);
    });
  });
}

async function joinMqtt(code, pid, h) {
  const t = topicBase(code), me = encodeURIComponent(pid);
  const c = await mqttClient({ will: { topic: t + 'up/' + me, payload: JSON.stringify({ t: 'leave' }), qos: 0 } });
  c.on('connect', () => {
    c.subscribe([t + 'down/' + me, t + 'down/all']);
    c.publish(t + 'up/' + me, JSON.stringify({ t: 'join' }));
    h.onOpen && h.onOpen();
  });
  c.on('error', e => console.warn('relay error', e && e.message));
  c.on('offline', () => h.onClose && h.onClose('offline'));
  c.on('message', (topic, buf) => { try { const m = JSON.parse(buf.toString()); if (m.t === 'msg') h.onMessage(m.msg); } catch (e) {} });
  return {
    kind: 'mqtt',
    isOpen: () => c.connected,
    send: msg => { if (c.connected) c.publish(t + 'up/' + me, JSON.stringify({ t: 'msg', msg })); },
    reconnect: () => { if (!c.connected && !c.reconnecting) c.reconnect(); },
  };
}

// Host on both at once; answer each phone on the route it last spoke through.
async function hostHybrid(code, h) {
  const via = new Map(); // pid -> 'peer' | 'mqtt'
  const wrap = tag => ({ ...h,
    onJoin: pid => { via.set(pid, tag); h.onJoin && h.onJoin(pid); },
    onMessage: (pid, msg) => { via.set(pid, tag); h.onMessage(pid, msg); },
    onLeave: pid => { if (via.get(pid) === tag) { via.delete(pid); h.onLeave && h.onLeave(pid); } },
  });
  let p = null, m = null;
  const pp = hostPeer(code, wrap('peer')).then(x => (p = x));
  const mp = hostMqtt(code, wrap('mqtt')).then(x => (m = x));
  // Ready once the direct route is up (it also reserves the room code); if that fails, the relay alone will do.
  try { await pp; } catch (err) {
    if (err && err.type === 'unavailable-id') throw err;   // code taken: let the caller pick another
    try { await mp; } catch (e) { throw err; }
  }
  mp.catch(e => console.warn('relay fallback unavailable:', e && e.message));
  return {
    kind: 'peer',
    send: (pid, msg) => { if (via.get(pid) === 'mqtt') { m && m.send(pid, msg); } else if (p) p.send(pid, msg); },
    broadcast: msg => { if (p) p.broadcast(msg); if (m && [...via.values()].includes('mqtt')) m.broadcast(msg); },
  };
}

// Phone: try the direct link first; if it hasn't opened after FALLBACK_MS, add the relay.
function joinHybrid(code, pid, h) {
  const direct = joinPeer(code, pid, h);
  let relay = null, starting = false;
  const startRelay = () => {
    if (relay || starting || direct.isOpen()) return;
    starting = true;
    console.warn('direct link not open after ' + FALLBACK_MS + 'ms: using the relay');
    joinMqtt(code, pid, h).then(r => (relay = r)).catch(e => { starting = false; console.warn('relay failed', e && e.message); });
  };
  if (new URLSearchParams(location.search).get('relay') === 'now') startRelay();
  setTimeout(startRelay, FALLBACK_MS);
  return {
    kind: 'peer',
    send: msg => { if (direct.isOpen()) direct.send(msg); else if (relay) relay.send(msg); },
    reconnect: () => { direct.reconnect(); if (relay) relay.reconnect(); else startRelay(); },
  };
}
