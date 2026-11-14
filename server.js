// Couch games — tiny zero-dependency server (shared by every game in this folder).
// 1) Serves the game files.  2) Relays messages between the TV (host) and phones
// using Server-Sent Events (server -> browser) and POST (browser -> server).
// The game rules run in the TV browser; this server never looks inside messages.
// Run:  node server.js        then open the address it prints on the TV.
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import dgram from 'dgram';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.md': 'text/markdown', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// rooms: code -> { host: res|null, players: Map(pid -> res), queue: [] }
const rooms = new Map();
function room(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, players: new Map() });
  return rooms.get(code);
}
function sse(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} }

function handleEvents(req, res, q) {
  const code = (q.get('room') || '').toUpperCase();
  const role = q.get('role');
  const pid = q.get('pid') || '';
  if (!code || (role !== 'host' && !pid)) { res.writeHead(400); return res.end('bad'); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': hi\n\n');
  const r = room(code);
  if (role === 'host') {
    // Only one TV per room: an older TV tab is told to stand down.
    if (r.host && r.host !== res) { sse(r.host, { type: 'relay:replaced' }); try { r.host.end(); } catch (e) {} }
    r.host = res;
    sse(res, { type: 'relay:open' });
    for (const p of r.players.keys()) sse(res, { type: 'relay:join', from: p });
  } else {
    const old = r.players.get(pid);
    if (old && old !== res) { try { old.end(); } catch (e) {} }
    r.players.set(pid, res);
    sse(res, { type: 'relay:open' });
    if (r.host) sse(r.host, { type: 'relay:join', from: pid }); else sse(res, { type: 'relay:nohost' });
  }
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    if (role === 'host') { if (r.host === res) r.host = null; }
    else if (r.players.get(pid) === res) {
      r.players.delete(pid);
      if (r.host) sse(r.host, { type: 'relay:leave', from: pid });
    }
    if (!r.host && r.players.size === 0) rooms.delete(code);
  });
}

function handleSend(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let m; try { m = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('bad json'); }
    const r = rooms.get(String(m.room || '').toUpperCase());
    if (!r) { res.writeHead(204); return res.end(); }
    if (m.role === 'host') {
      const targets = m.to === '*' ? [...r.players.values()] : [r.players.get(m.to)].filter(Boolean);
      for (const t of targets) sse(t, { type: 'msg', msg: m.msg });
    } else {
      const ev = { type: 'msg', from: m.pid, msg: m.msg };
      if (r.host) sse(r.host, ev); // phones retry until the TV answers, so nothing is queued
    }
    res.writeHead(204); res.end();
  });
}

function serveFile(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT) || file.includes('node_modules')) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// LAN addresses, best guess first: the one the computer actually uses to reach the internet,
// then ordinary home-network ranges. Virtual adapters (Docker, VPNs) tend to sort last.
let routeIp = null;
function findRouteIp() {
  try {
    const s = dgram.createSocket('udp4');
    s.on('error', () => {});
    s.connect(53, '8.8.8.8', () => { try { routeIp = s.address().address; } catch (e) {} s.close(); }); // sends nothing
  } catch (e) {}
}
findRouteIp();
function lanIps() {
  const all = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map(i => i.address);
  const score = ip => (ip === routeIp ? 0 : ip.startsWith('192.168.') ? 1 : ip.startsWith('10.') ? 2 : ip.startsWith('172.') ? 3 : 4);
  return [...new Set(all)].sort((a, b) => score(a) - score(b));
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/relay/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (u.pathname === '/relay/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ips: lanIps(), port: PORT }));
  }
  if (u.pathname === '/relay/events') return handleEvents(req, res, u.searchParams);
  if (u.pathname === '/relay/send' && req.method === 'POST') return handleSend(req, res);
  serveFile(req, res, u.pathname);
}).listen(PORT, () => setTimeout(() => {
  const ips = lanIps();
  console.log('\n  Couch games server is running.');
  console.log('  On the TV/laptop, open:   http://localhost:' + PORT);
  for (const ip of ips) console.log('  Phones on the same Wi-Fi: http://' + ip + ':' + PORT);
  console.log('\n  (Leave this window open while you play. Ctrl+C to stop.)\n');
  if (!process.env.NO_OPEN) {
    const url = 'http://localhost:' + PORT + '/';
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
}, 300));
