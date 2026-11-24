// HTTP + WebSocket transport. All game truth lives in Table; this file only
// routes messages, tracks sockets, and broadcasts snapshots.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Table } from './table.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_TABLES = 500;
const TABLE_TTL_MS = 6 * 60 * 60 * 1000;   // drop tables untouched for 6 hours
const SEAT_TTL_MS = 15 * 60 * 1000;        // free a seat after 15 minutes offline
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O

const tables = new Map();

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!tables.has(code)) return code;
  }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/health') { res.writeHead(200).end('ok'); return; }
  if (path === '/' || path === '/index.html') {
    try {
      const html = await readFile(join(PUBLIC, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }).end(html);
    } catch { res.writeHead(500).end('missing client'); }
    return;
  }
  res.writeHead(404).end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function broadcast(table) {
  const state = table.snapshot();
  for (const ws of wss.clients) {
    if (ws.table === table) send(ws, { t: 'state', you: ws.playerId, state });
  }
}

function seat(ws, table, player) {
  // One live socket per seat: a reconnect replaces the old connection.
  for (const other of wss.clients) {
    if (other !== ws && other.table === table && other.playerId === player.id) {
      other.table = null; other.playerId = null; other.close(4000, 'replaced');
    }
  }
  ws.table = table;
  ws.playerId = player.id;
  player.connected = true;
  player.seenAt = Date.now();
  send(ws, { t: 'joined', code: table.code, id: player.id, token: player.token });
  broadcast(table);
}

function handle(ws, msg) {
  if (msg.t === 'ping') return send(ws, { t: 'pong' });

  if (msg.t === 'create') {
    if (ws.table) return;
    if (tables.size >= MAX_TABLES) return send(ws, { t: 'error', msg: 'Server is full - try again later' });
    const table = new Table(newCode());
    tables.set(table.code, table);
    return seat(ws, table, table.addPlayer(msg.name).player);
  }

  if (msg.t === 'join') {
    if (ws.table) return;
    const table = tables.get(String(msg.code || '').toUpperCase().trim());
    if (!table) return send(ws, { t: 'error', msg: 'No table with that code', fatal: true });
    const back = msg.id && table.player(msg.id);
    if (back && back.token === msg.token) return seat(ws, table, back);
    const r = table.addPlayer(msg.name);
    if (r.error) return send(ws, { t: 'error', msg: r.error, fatal: true });
    return seat(ws, table, r.player);
  }

  const table = ws.table;
  const player = table && table.player(ws.playerId);
  if (!player) return send(ws, { t: 'error', msg: 'Not seated at a table', fatal: true });

  if (msg.t === 'leave') {
    table.clear(player);
    table.removePlayer(player.id);
    ws.table = null; ws.playerId = null;
    send(ws, { t: 'left' });
    if (table.players.length === 0) tables.delete(table.code); else broadcast(table);
    return;
  }

  const err = table.act(player, msg);
  if (err) send(ws, { t: 'error', msg: err });
  broadcast(table);
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.budget = 40;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    if (--ws.budget < 0) return; // refilled every second below
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error('handler error', e); send(ws, { t: 'error', msg: 'Server error' }); }
  });
  ws.on('close', () => {
    const table = ws.table;
    const player = table && table.player(ws.playerId);
    if (!player) return;
    player.connected = false;
    player.seenAt = Date.now();
    // Don't strand the table on a shooter who vanished between hands.
    if (table.shooterId === player.id && table.point === 0 && table.players.some((p) => p.connected)) table.passDice();
    broadcast(table);
  });
});

setInterval(() => { for (const ws of wss.clients) ws.budget = 40; }, 1000).unref();

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const table of tables.values()) {
    let changed = false;
    for (const p of [...table.players]) {
      if (!p.connected && now - p.seenAt > SEAT_TTL_MS) { table.clear(p); table.removePlayer(p.id); changed = true; }
    }
    if (table.players.length === 0 || now - table.touched > TABLE_TTL_MS) tables.delete(table.code);
    else if (changed) broadcast(table);
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`craps table listening on :${PORT}`));
