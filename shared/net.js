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

function peerOptions() {
  // ?peerhost=localhost:9000 lets us test against a local PeerServer.
  const q = new URLSearchParams(location.search).get('peerhost');
  if (!q) return { debug: 1 };
  const [host, port] = q.split(':');
  return { host, port: Number(port || 9000), path: '/', secure: false, debug: 1 };
}

// ---------- HOST ----------
export async function hostRoom(code, h, kind) {
  kind = kind || await pickTransport();
  if (kind === 'relay') return hostRelay(code, h);
  if (kind === 'local') return hostLocal(code, h);
  return hostPeer(code, h);
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
      if (attempt >= 5 || (err && err.type !== 'unavailable-id' && err.type !== 'network' && err.type !== 'server-error')) throw err;
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
  return joinPeer(code, pid, h);
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
  let api = { kind: 'peer', send: () => {} };
  let peer = null, conn = null, dead = false;
  const connect = () => {
    if (dead) return;
    if (!peer || peer.destroyed || peer.disconnected) {
      try { peer && peer.destroy(); } catch (e) {}
      peer = new window.Peer(undefined, peerOptions());
      peer.on('error', err => { console.warn('peer error', err); h.onClose && h.onClose(String(err.type || err)); setTimeout(retry, 2000); });
      peer.on('open', openConn);
    } else openConn();
  };
  const openConn = () => {
    conn = peer.connect(PEER_PREFIX + code, { metadata: { pid }, reliable: true });
    conn.on('open', () => { api.send = msg => conn.open && conn.send(msg); h.onOpen && h.onOpen(); });
    conn.on('data', msg => h.onMessage(msg));
    conn.on('close', () => { h.onClose && h.onClose('closed'); setTimeout(retry, 1500); });
  };
  let retrying = false;
  const retry = () => { if (retrying || dead) return; retrying = true; setTimeout(() => { retrying = false; connect(); }, 500); };
  connect();
  return { kind: 'peer', send: msg => api.send(msg), reconnect: () => { if (!conn || !conn.open) retry(); } };
}
