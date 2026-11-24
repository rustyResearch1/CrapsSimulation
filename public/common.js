// Shared by every game page: DOM helpers, storage, sound, and the server connection.
'use strict';

const $ = (s) => document.querySelector(s);
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const signed = (n) => (n > 0 ? '+' : '') + money(n);

/** Tiny DOM builder: text always goes through textContent. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'disabled') el.disabled = !!v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- sound (synthesised, no assets) ----------
let actx = null, muted = !!store.get('craps.mute');
function audio() {
  if (muted) return null;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { return null; }
  return actx;
}
function tone(a, t, f, g, len, type) {
  const o = a.createOscillator(), v = a.createGain();
  o.type = type || 'square'; o.frequency.value = f;
  v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(v).connect(a.destination); o.start(t); o.stop(t + len + 0.02);
}
document.addEventListener('pointerdown', audio, { once: true });

/**
 * Connection to the game server. WebSocket first; if it cannot open (some networks block
 * it), falls back to Server-Sent Events for the stream plus POSTs for actions.
 *   onMessage(msg)   every server message
 *   onStatus(open)   connection came up or went down
 *   hello()          first message to send once connected (create / join), or null
 *   wanted()         whether to keep reconnecting
 */
function createNet({ onMessage, onStatus, hello, wanted }) {
  let ws = null, open = false, retry = 0, mode = 'ws', es = null, sid = null, wsFails = 0, postQ = Promise.resolve();
  function up() {
    open = true; retry = 0; onStatus(true);
    const first = hello();
    if (first) send(first);
  }
  function down() {
    open = false; onStatus(false);
    if (wanted()) setTimeout(connect, Math.min(5000, 400 * 2 ** retry++));
  }
  function connect() {
    if (mode === 'sse') return connectSse();
    if (ws && ws.readyState <= 1) return;
    let opened = false;
    const sock = ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    const giveUp = setTimeout(() => { if (!opened) try { sock.close(); } catch {} }, 3500);
    sock.onopen = () => { opened = true; clearTimeout(giveUp); wsFails = 0; up(); };
    sock.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
    sock.onclose = () => {
      clearTimeout(giveUp);
      if (ws !== sock) return;
      ws = null;
      if (!opened && ++wsFails >= 2) mode = 'sse';
      down();
    };
  }
  function connectSse() {
    if (es) return;
    const src = es = new EventSource('/sse');
    src.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello') { sid = m.sid; up(); } else onMessage(m);
    };
    src.onerror = () => { if (es !== src) return; src.close(); es = null; sid = null; down(); };
  }
  function raw(text) {
    if (mode === 'sse') {
      const to = sid;
      postQ = postQ.then(() => fetch('/send?sid=' + to, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text })).catch(() => {});
    } else ws.send(text);
  }
  function send(obj) { if (open) raw(JSON.stringify(obj)); }
  setInterval(() => { if (open) raw('{"t":"ping"}'); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !open && wanted()) connect(); });
  return { connect, send, get open() { return open; }, get mode() { return mode; } };
}
