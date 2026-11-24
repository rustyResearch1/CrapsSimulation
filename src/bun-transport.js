// Bun transport for the single-file Railway Function build (see scripts/build-function.mjs).
// Mirrors src/server.js; the build inlines engine.js, table.js and the client HTML above it,
// so `Table` and `HTML` are in scope here.

const MAX_TABLES = 500;
const TABLE_TTL_MS = 6 * 60 * 60 * 1000;
const SEAT_TTL_MS = 15 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

const tables = new Map();
const sockets = new Set();
let lastSweep = 0;

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!tables.has(code)) return code;
  }
}

const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

function broadcast(table) {
  const state = table.snapshot();
  for (const ws of sockets) if (ws.data.table === table) send(ws, { t: 'state', you: ws.data.playerId, state });
}

function seat(ws, table, player) {
  for (const other of sockets) {
    if (other !== ws && other.data.table === table && other.data.playerId === player.id) {
      other.data.table = null; other.data.playerId = null;
      try { other.close(4000, 'replaced'); } catch {}
    }
  }
  ws.data.table = table;
  ws.data.playerId = player.id;
  player.connected = true;
  player.seenAt = Date.now();
  send(ws, { t: 'joined', code: table.code, id: player.id, token: player.token });
  broadcast(table);
}

// Housekeeping runs on traffic rather than on a timer.
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 30_000) return;
  lastSweep = now;
  for (const table of tables.values()) {
    let changed = false;
    for (const p of [...table.players]) {
      if (!p.connected && now - p.seenAt > SEAT_TTL_MS) { table.clear(p); table.removePlayer(p.id); changed = true; }
    }
    if (table.players.length === 0 || now - table.touched > TABLE_TTL_MS) tables.delete(table.code);
    else if (changed) broadcast(table);
  }
}

function handle(ws, msg) {
  if (msg.t === 'ping') return send(ws, { t: 'pong' });

  if (msg.t === 'create') {
    if (ws.data.table) return;
    sweep();
    if (tables.size >= MAX_TABLES) return send(ws, { t: 'error', msg: 'Server is full - try again later' });
    const table = new Table(newCode());
    tables.set(table.code, table);
    return seat(ws, table, table.addPlayer(msg.name).player);
  }

  if (msg.t === 'join') {
    if (ws.data.table) return;
    const table = tables.get(String(msg.code || '').toUpperCase().trim());
    if (!table) return send(ws, { t: 'error', msg: 'No table with that code', fatal: true });
    const back = msg.id && table.player(msg.id);
    if (back && back.token === msg.token) return seat(ws, table, back);
    const r = table.addPlayer(msg.name);
    if (r.error) return send(ws, { t: 'error', msg: r.error, fatal: true });
    return seat(ws, table, r.player);
  }

  const table = ws.data.table;
  const player = table && table.player(ws.data.playerId);
  if (!player) return send(ws, { t: 'error', msg: 'Not seated at a table', fatal: true });

  if (msg.t === 'leave') {
    table.clear(player);
    table.removePlayer(player.id);
    ws.data.table = null; ws.data.playerId = null;
    send(ws, { t: 'left' });
    if (table.players.length === 0) tables.delete(table.code); else broadcast(table);
    return;
  }

  const err = table.act(player, msg);
  if (err) send(ws, { t: 'error', msg: err });
  broadcast(table);
}

Bun.serve({
  port: Number(Bun.env.PORT) || 3000,
  hostname: '0.0.0.0',
  fetch(req, server) {
    const path = new URL(req.url).pathname;
    if (path === '/ws') {
      if (server.upgrade(req, { data: { table: null, playerId: null, budget: 40, stamp: Date.now() } })) return undefined;
      return new Response('expected a WebSocket', { status: 400 });
    }
    if (path === '/health') return new Response('ok');
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    return new Response('not found', { status: 404 });
  },
  websocket: {
    maxPayloadLength: 2048,
    idleTimeout: 120,
    sendPings: true,
    open(ws) { sockets.add(ws); sweep(); },
    message(ws, raw) {
      const now = Date.now();
      if (now - ws.data.stamp >= 1000) { ws.data.stamp = now; ws.data.budget = 40; }
      if (--ws.data.budget < 0) return;
      let msg;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      try { handle(ws, msg); } catch (e) { console.error('handler error', e); send(ws, { t: 'error', msg: 'Server error' }); }
    },
    close(ws) {
      sockets.delete(ws);
      const table = ws.data.table;
      const player = table && table.player(ws.data.playerId);
      if (!player) return;
      player.connected = false;
      player.seenAt = Date.now();
      if (table.shooterId === player.id && table.point === 0 && table.players.some((p) => p.connected)) table.passDice();
      broadcast(table);
    },
  },
});

console.log('craps table listening on :' + (Number(Bun.env.PORT) || 3000));
