// HTTP + WebSocket transport, with a Server-Sent-Events fallback for networks that block
// WebSockets. All game truth lives in Table; this file only routes messages, tracks
// connections, and broadcasts snapshots.
//
// A connection (`conn`) is { send(obj), close(), table, playerId } whichever way it arrived.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomInt, randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Table } from './table.js';
import { RouletteTable } from './roulette-table.js';
import { BlackjackTable } from './blackjack-table.js';
import { BaccaratTable } from './baccarat-table.js';
import { createStats } from './stats.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stats = createStats(process.env.DATA_DIR || join(ROOT, 'data'));
const JS = 'text/javascript; charset=utf-8';
const LONG = 'public, max-age=604800';
// Every file the client may fetch. Nothing outside this list is served.
const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/index.html': ['public/index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/roulette': ['public/roulette.html', 'text/html; charset=utf-8', 'no-cache'],
  '/blackjack': ['public/cards.html', 'text/html; charset=utf-8', 'no-cache'],
  '/baccarat': ['public/cards.html', 'text/html; charset=utf-8', 'no-cache'],
  '/lab': ['public/lab.html', 'text/html; charset=utf-8', 'no-cache'],
  '/house': ['public/house.html', 'text/html; charset=utf-8', 'no-cache'],
  '/house.js': ['public/house.js', JS, 'no-cache'],
  '/charts.js': ['public/charts.js', JS, 'no-cache'],
  '/lab.css': ['public/lab.css', 'text/css; charset=utf-8', 'no-cache'],
  '/shared/theory.js': ['shared/theory.js', JS, 'no-cache'],
  '/shared/fair.js': ['shared/fair.js', JS, 'no-cache'],
  '/shared/cards.js': ['shared/cards.js', JS, 'no-cache'],
  '/shared/blackjack.js': ['shared/blackjack.js', JS, 'no-cache'],
  '/shared/baccarat.js': ['shared/baccarat.js', JS, 'no-cache'],
  '/cardgame.js': ['public/cardgame.js', JS, 'no-cache'],
  '/blackjack.js': ['public/blackjack.js', JS, 'no-cache'],
  '/baccarat.js': ['public/baccarat.js', JS, 'no-cache'],
  '/cards.css': ['public/cards.css', 'text/css; charset=utf-8', 'no-cache'],
  '/fair-ui.js': ['public/fair-ui.js', JS, 'no-cache'],
  '/roll3d.js': ['public/roll3d.js', JS, 'no-cache'],
  '/common.js': ['public/common.js', JS, 'no-cache'],
  '/roulette.js': ['public/roulette.js', JS, 'no-cache'],
  '/lab.js': ['public/lab.js', JS, 'no-cache'],
  '/base.css': ['public/base.css', 'text/css; charset=utf-8', 'no-cache'],
  '/shared/craps.js': ['shared/craps.js', JS, 'no-cache'],
  '/shared/roulette.js': ['shared/roulette.js', JS, 'no-cache'],
  '/shared/sim.js': ['shared/sim.js', JS, 'no-cache'],
  '/vendor/three.module.js': ['node_modules/three/build/three.module.js', JS, LONG],
  '/vendor/three.core.js': ['node_modules/three/build/three.core.js', JS, LONG],
};
const fileCache = new Map(); // path -> { raw, gz }

async function serveStatic(req, res, [file, type, cache]) {
  try {
    let hit = fileCache.get(file);
    if (!hit) {
      const raw = await readFile(join(ROOT, file));
      hit = { raw, gz: gzipSync(raw) };
      fileCache.set(file, hit);
    }
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'content-type': type, 'cache-control': cache, vary: 'accept-encoding', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
    res.end(gz ? hit.gz : hit.raw);
  } catch { res.writeHead(500).end('missing file'); }
}
const MAX_TABLES = 500;
const TABLE_TTL_MS = 6 * 60 * 60 * 1000;   // drop tables untouched for 6 hours
const SEAT_TTL_MS = 15 * 60 * 1000;        // free a seat after 15 minutes offline
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O

const tables = new Map();
const conns = new Set();       // every live connection, WebSocket or SSE
const sse = new Map();         // sid -> conn, for the fallback's POST /send

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
  if (path === '/api/house') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(stats.report())); return; }
  if (path === '/api/fair') {
    const q = new URL(req.url, 'http://x').searchParams, table = tables.get(String(q.get('code') || '').toUpperCase());
    const data = table && table.fair ? table.fair.epochData(Number(q.get('epoch'))) : null;
    res.writeHead(data ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data || { error: 'not found' }));
    return;
  }
  if (STATIC[path]) return serveStatic(req, res, STATIC[path]);
  if (path === '/sse' && req.method === 'GET') return openSse(req, res);
  if (path === '/send' && req.method === 'POST') return sseSend(req, res);
  res.writeHead(404).end('not found');
});

function openSse(req, res) {
  const sid = randomBytes(16).toString('hex');
  res.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive', 'x-accel-buffering': 'no',
  });
  const conn = {
    table: null, playerId: null, budget: 40, sse: res,
    send(obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); },
    close() { sse.delete(sid); conns.delete(conn); res.end(); },
  };
  sse.set(sid, conn);
  conns.add(conn);
  conn.send({ t: 'hello', sid });
  req.on('close', () => { sse.delete(sid); onClose(conn); });
}

function sseSend(req, res) {
  const conn = sse.get(new URL(req.url, 'http://x').searchParams.get('sid'));
  if (!conn) { res.writeHead(410).end(); return; }
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 2048) req.destroy(); });
  req.on('end', () => { onRaw(conn, body); res.writeHead(204).end(); });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

const send = (conn, obj) => { try { conn.send(obj); } catch {} };

function broadcast(table) {
  const state = table.snapshot();
  for (const conn of conns) {
    if (conn.table === table) send(conn, { t: 'state', you: conn.playerId, state });
  }
}

function seat(conn, table, player) {
  // One live connection per seat: a reconnect replaces the old one.
  for (const other of conns) {
    if (other !== conn && other.table === table && other.playerId === player.id) {
      other.table = null; other.playerId = null; other.close();
    }
  }
  conn.table = table;
  conn.playerId = player.id;
  player.connected = true;
  player.seenAt = Date.now();
  send(conn, { t: 'joined', game: table.game, code: table.code, id: player.id, token: player.token });
  broadcast(table);
}

function handle(conn, msg) {
  if (msg.t === 'ping') return send(conn, { t: 'pong' });

  if (msg.t === 'create') {
    if (conn.table) return;
    if (tables.size >= MAX_TABLES) return send(conn, { t: 'error', msg: 'Server is full - try again later' });
    const code = newCode();
    const table = msg.game === 'roulette' ? new RouletteTable(code, { wheel: msg.wheel, stats })
      : msg.game === 'blackjack' ? new BlackjackTable(code, { stats })
      : msg.game === 'baccarat' ? new BaccaratTable(code, { stats })
      : new Table(code, { stats });
    stats.tableOpened(table.game);
    tables.set(table.code, table);
    return seat(conn, table, table.addPlayer(msg.name).player);
  }

  if (msg.t === 'join') {
    if (conn.table) return;
    const table = tables.get(String(msg.code || '').toUpperCase().trim());
    if (!table) return send(conn, { t: 'error', msg: 'No table with that code', fatal: true });
    const back = msg.id && table.player(msg.id);
    if (back && back.token === msg.token) return seat(conn, table, back);
    const r = table.addPlayer(msg.name);
    if (r.error) return send(conn, { t: 'error', msg: r.error, fatal: true });
    return seat(conn, table, r.player);
  }

  const table = conn.table;
  const player = table && table.player(conn.playerId);
  if (!player) return send(conn, { t: 'error', msg: 'Not seated at a table', fatal: true });

  if (msg.t === 'leave') {
    table.clear(player);
    table.removePlayer(player.id);
    conn.table = null; conn.playerId = null;
    send(conn, { t: 'left' });
    if (table.players.length === 0) tables.delete(table.code); else broadcast(table);
    return;
  }

  const err = table.act(player, msg);
  if (err) send(conn, { t: 'error', msg: err });
  broadcast(table);
}

function onRaw(conn, raw) {
  if (--conn.budget < 0) return; // refilled every second below
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  try { handle(conn, msg); } catch (e) { console.error('handler error', e); send(conn, { t: 'error', msg: 'Server error' }); }
}

function onClose(conn) {
  conns.delete(conn);
  const table = conn.table;
  const player = table && table.player(conn.playerId);
  if (!player) return;
  player.connected = false;
  player.seenAt = Date.now();
  table.onDisconnect(player);
  broadcast(table);
}

wss.on('connection', (ws) => {
  const conn = {
    table: null, playerId: null, budget: 40,
    send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { conns.delete(conn); ws.close(4000, 'replaced'); },
  };
  conns.add(conn);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => onRaw(conn, raw));
  ws.on('close', () => onClose(conn));
});

setInterval(() => { for (const conn of conns) conn.budget = 40; }, 1000).unref();
setInterval(() => { for (const conn of sse.values()) conn.sse.write(': keep-alive\n\n'); }, 15_000).unref();

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

server.listen(PORT, () => console.log(`casino tables listening on :${PORT}; telemetry in ${stats.dir}${stats.persistent ? '' : ' (not writable, in memory only)'}`));
// Railway stops the old container with SIGTERM on every deploy: write the totals first.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stats.flush(); process.exit(0); });
