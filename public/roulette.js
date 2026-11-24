// Roulette table client. Helpers ($, h, store, money, toast, createNet, audio, tone) come from common.js.
// The rules come from the same module the server uses, so the page never disagrees with it.
import { WHEELS, colorOf, covers, payout, label, isOutside } from '/shared/roulette.js';

const CHIPS = [1, 5, 25, 100, 500];
const total = (bets) => Object.values(bets).reduce((s, v) => s + v, 0);

let session = store.get('craps.session');
const urlCode = (new URLSearchParams(location.search).get('t') || '').toUpperCase().slice(0, 4);
if (!session || (urlCode && session.code !== urlCode)) location.replace('/' + (urlCode ? '?t=' + urlCode : ''));

let state = null, myId = null, wsOpen = false;
let chip = 5, removeMode = false, undo = [], seenSpin = -1, spinning = false, queued = null, sheet = null, builtFor = null;
const me = () => state && state.players.find((p) => p.id === myId);

// ---------- connection ----------
const net = createNet({
  onMessage(m) {
    if (m.t === 'joined') {
      if (m.game !== 'roulette') { location.replace('/?t=' + m.code); return; }
      session = { code: m.code, id: m.id, token: m.token };
      store.set('craps.session', session);
    } else if (m.t === 'state') {
      Fair.onState(m.state, send);
      if (spinning) { queued = m; return; }
      applyState(m);
    } else if (m.t === 'error') {
      if (m.fatal) leave(); else toast(m.msg);
    } else if (m.t === 'left') leave();
  },
  onStatus(open) { wsOpen = open; $('#conn').classList.toggle('off', !open); },
  hello: () => (session ? { t: 'join', code: session.code, id: session.id, token: session.token, name: store.get('craps.name') || '' } : null),
  wanted: () => !!session,
});
function send(obj) { if (wsOpen) net.send(obj); else toast('Reconnecting…'); }
function leave() { session = null; store.del('craps.session'); location.replace('/'); }

function applyState(m) {
  const ls = m.state.lastSpin;
  if (ls && seenSpin >= 0 && ls.n > seenSpin) {
    spinning = true; seenSpin = ls.n; undo = [];
    renderSpinButton();
    const res = ls.results[m.you];
    playSpin(m.state.wheel, ls, res ? res.net : null).then(() => {
      spinning = false;
      const latest = queued || m; queued = null;
      if (latest.state.lastSpin.n > seenSpin) return applyState(latest);
      state = latest.state; myId = latest.you;
      Fair.onState(state, send);
      render();
      flash(state.lastSpin.pocket);
    });
    return;
  }
  state = m.state; myId = m.you;
  Fair.onState(state, send);
  if (seenSpin < 0) seenSpin = ls ? ls.n : 0;
  render();
}

// ---------- sound ----------
const snd = {
  chip() { const a = audio(); if (a) tone(a, a.currentTime, 2600, 0.05, 0.04); },
  ball(ms) { // clicks that slow down as the ball loses speed
    const a = audio(); if (!a) return;
    for (let t = 0, gap = 0.05; t < ms / 1000; t += gap, gap *= 1.09) tone(a, a.currentTime + t, 1500 + Math.random() * 500, 0.06, 0.03);
  },
  land() { const a = audio(); if (a) tone(a, a.currentTime, 320, 0.14, 0.09, 'triangle'); },
  win() { const a = audio(); if (!a) return; [660, 880, 1320].forEach((f, i) => tone(a, a.currentTime + i * 0.09, f, 0.12, 0.25, 'sine')); },
  lose() { const a = audio(); if (!a) return; tone(a, a.currentTime, 196, 0.1, 0.3, 'triangle'); tone(a, a.currentTime + 0.12, 147, 0.1, 0.35, 'triangle'); },
};

// ---------- board ----------
const CELLS = {};  // bet key -> element showing my chips on it
function cell(key, cls, text, style) {
  const el = h('button', { class: 'cell ' + cls, style, on: { click: () => tap(key) } },
    cls.includes('out') ? h('span', null, text) : text, h('span', { class: 'badge', hidden: '' }), h('span', { class: 'oth' }));
  CELLS[key] = el;
  return el;
}
function spot(key, x, y) {
  const el = h('button', { class: 'hs', style: `left:${x * 100}%;top:${y * 100}%`, 'aria-label': label(key), on: { click: () => tap(key) } });
  CELLS[key] = el;
  return el;
}
function buildBoard(wheel) {
  for (const k of Object.keys(CELLS)) delete CELLS[k];
  const board = $('#board'), kids = [];
  const zeros = h('div', { id: 'zeros' }, cell('n:0', 'zero', '0'), wheel === 'american' && cell('n:00', 'zero', '00'));
  kids.push(zeros);
  [['low', '1 to 18', ''], ['even', 'EVEN', ''], ['red', 'RED', 'cr'], ['black', 'BLACK', 'cb'], ['odd', 'ODD', ''], ['high', '19 to 36', '']]
    .forEach(([key, text, c], i) => kids.push(cell(key, 'out ' + c, text, `grid-column:1;grid-row:${2 + i * 2}/span 2`)));
  ['1st 12', '2nd 12', '3rd 12'].forEach((text, i) => kids.push(cell(`dz:${i + 1}`, 'out', text, `grid-column:2;grid-row:${2 + i * 4}/span 4`)));
  for (let n = 1; n <= 36; n++) {
    kids.push(cell(`n:${n}`, 'num ' + colorOf(String(n)), String(n), `grid-column:${3 + ((n - 1) % 3)};grid-row:${2 + Math.floor((n - 1) / 3)}`));
  }
  for (let c = 1; c <= 3; c++) kids.push(cell(`col:${c}`, 'col', '2 to 1', `grid-column:${2 + c};grid-row:14`));

  // Inside bets that sit on the lines between numbers.
  const spots = h('div', { id: 'spots' });
  for (let r = 0; r < 12; r++) {
    const first = 3 * r + 1;
    spots.append(spot(`st:${r + 1}`, 0, (r + 0.5) / 12));
    for (let c = 0; c < 2; c++) spots.append(spot(`sp:${first + c}-${first + c + 1}`, (c + 1) / 3, (r + 0.5) / 12));
    if (r < 11) {
      spots.append(spot(`sl:${r + 1}`, 0, (r + 1) / 12));
      for (let c = 0; c < 3; c++) spots.append(spot(`sp:${first + c}-${first + c + 3}`, (c + 0.5) / 3, (r + 1) / 12));
      for (let c = 0; c < 2; c++) spots.append(spot(`co:${first + c}`, (c + 1) / 3, (r + 1) / 12));
    }
  }
  if (wheel === 'european') {
    spots.append(spot('first4', 0, 0), spot('sp:0-1', 1 / 6, 0), spot('trio:0-1-2', 1 / 3, 0), spot('sp:0-2', 1 / 2, 0), spot('trio:0-2-3', 2 / 3, 0), spot('sp:0-3', 5 / 6, 0));
  } else {
    spots.append(spot('top5', 0, 0), spot('sp:0-1', 1 / 6, 0), spot('trio:0-1-2', 1 / 3, 0), spot('sp:0-2', 0.41, 0), spot('trio:0-00-2', 1 / 2, 0),
      spot('sp:00-2', 0.59, 0), spot('trio:00-2-3', 2 / 3, 0), spot('sp:00-3', 5 / 6, 0), spot('sp:0-00', 1 / 2, -0.5 / 12));
  }
  kids.push(spots);
  board.replaceChildren(...kids);
  builtFor = wheel;
}

function tap(key) {
  const p = me(); if (!p || spinning) return;
  if (removeMode) {
    if (!p.bets[key]) return toast('No bet there');
    send({ t: 'remove', key });
    undo = undo.filter((u) => u.key !== key);
    return;
  }
  if (chip > p.bank) return toast('Not enough chips');
  send({ t: 'bet', key, amt: chip });
  snd.chip();
  undo.push({ key, amt: chip, n: state.n });
}

function flash(pocket) {
  const el = CELLS['n:' + pocket];
  if (!el) return;
  el.classList.remove('won'); void el.offsetWidth; el.classList.add('won');
}

// ---------- render ----------
function render() {
  const p = me();
  if (!state || !p) return;
  if (builtFor !== state.wheel) { buildBoard(state.wheel); buildWheel(state.wheel); }
  $('#code').textContent = state.code;
  $('#wheelName').textContent = state.wheel === 'american' ? 'Double zero' : 'Single zero';

  $('#players').replaceChildren(...state.players.map((x) => {
    const net = x.bank + total(x.bets) - state.buyIn * (1 + x.rebuys);
    return h('button', { class: 'pl' + (x.id === myId ? ' me' : '') + (x.connected ? '' : ' away'), on: { click: () => openSheet({ type: 'player', id: x.id }) } },
      h('div', { class: 'nm' }, x.name, x.id === myId ? ' (you)' : ''),
      h('div', { class: 'bk' }, money(x.bank)),
      h('div', { class: 'nt ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : '') }, signed(net)));
  }));

  const ls = state.lastSpin;
  const lp = $('#lastPocket');
  lp.textContent = ls ? ls.pocket : '–';
  lp.className = 'pocket ' + (ls ? ls.color : 'green');
  $('#call').textContent = ls ? `${ls.pocket} ${ls.color[0].toUpperCase() + ls.color.slice(1)}${describe(ls.pocket)}` : 'Anyone can spin once a bet is down';
  const res = ls && ls.results[myId];
  const mineEl = $('#mine');
  mineEl.className = res ? (res.net > 0 ? 'pos' : res.net < 0 ? 'neg' : '') : '';
  mineEl.textContent = res ? `Your spin: ${signed(res.net)}` : '';
  $('#rhist').replaceChildren(...state.history.map((r) => h('span', { class: 'h ' + r.color }, r.pocket)));

  const others = state.players.filter((x) => x.id !== myId);
  for (const [key, el] of Object.entries(CELLS)) {
    const mine = p.bets[key] || 0;
    if (el.classList.contains('hs')) {
      el.classList.toggle('mine', !!mine);
      el.replaceChildren(...(mine ? [h('b', null, money(mine))] : []));
      continue;
    }
    const b = el.querySelector('.badge'), o = el.querySelector('.oth');
    b.hidden = !mine;
    if (mine) { b.textContent = money(mine); b.className = 'badge b' + (mine >= 500 ? 500 : mine >= 100 ? 100 : mine >= 25 ? 25 : mine >= 5 ? 5 : 1); }
    let sum = 0, count = 0;
    for (const x of others) if (x.bets[key]) { sum += x.bets[key]; count++; }
    o.textContent = sum ? `${count}× ${money(sum)}` : '';
  }

  const onTable = total(p.bets), net = p.bank + onTable - state.buyIn * (1 + p.rebuys);
  $('#bank').textContent = money(p.bank);
  $('#onTable').textContent = money(onTable);
  const netEl = $('#net'); netEl.textContent = signed(net); netEl.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
  undo = undo.filter((u) => u.n === state.n);
  $('#undo').disabled = !undo.length;
  $('#rep').disabled = !p.canRepeat || onTable > 0;
  $('#rem').classList.toggle('on', removeMode);
  $('#rem').textContent = removeMode ? 'Tap a bet…' : 'Take down';
  renderSpinButton();
  if (sheet) renderSheet();
}
function renderSpinButton() {
  const btn = $('#spin');
  const any = state && state.players.some((x) => total(x.bets) > 0);
  btn.disabled = spinning || !any;
  btn.textContent = spinning ? 'Spinning…' : any ? 'SPIN' : 'Place a bet to spin';
}
function describe(pocket) {
  if (pocket === '0' || pocket === '00') return '';
  const n = +pocket;
  return ` · ${n % 2 ? 'odd' : 'even'} · ${n <= 18 ? 'low' : 'high'}`;
}

// ---------- wheel animation ----------
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); el.append(...kids); return el; };
const polar = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
let wheelG = null, ballEl = null, markEl = null, wheelOrder = [], raf = 0;

function buildWheel(wheel) {
  wheelOrder = WHEELS[wheel];
  const n = wheelOrder.length, step = 360 / n;
  const fill = { red: '#b8261f', black: '#161616', green: '#12843f' };
  wheelG = svg('g');
  wheelOrder.forEach((p, i) => {
    const [x1, y1] = polar(168, (i - 0.5) * step), [x2, y2] = polar(168, (i + 0.5) * step);
    const [x3, y3] = polar(104, (i + 0.5) * step), [x4, y4] = polar(104, (i - 0.5) * step);
    wheelG.append(svg('path', { d: `M${x1} ${y1}A168 168 0 0 1 ${x2} ${y2}L${x3} ${y3}A104 104 0 0 0 ${x4} ${y4}Z`, fill: fill[colorOf(p)], stroke: '#d8c98f', 'stroke-width': 0.8 }));
    const [tx, ty] = polar(153, i * step);
    const t = svg('text', { x: tx, y: ty, fill: '#fff', 'font-size': 13, 'font-weight': 700, 'font-family': 'Georgia, serif', 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${i * step} ${tx} ${ty})` });
    t.textContent = p;
    wheelG.append(t);
  });
  wheelG.append(svg('circle', { r: 136, fill: 'none', stroke: '#d8c98f', 'stroke-width': 1.2 }),
    svg('circle', { r: 104, fill: 'url(#cone)', stroke: '#d8c98f', 'stroke-width': 1.5 }));
  for (let k = 0; k < 4; k++) { const [x, y] = polar(60, k * 90 + 45); wheelG.append(svg('line', { x1: 0, y1: 0, x2: x, y2: y, stroke: '#e9d9a0', 'stroke-width': 5, 'stroke-linecap': 'round' })); }
  wheelG.append(svg('circle', { r: 16, fill: '#f0c75e', stroke: '#8c6b1c', 'stroke-width': 2 }));
  markEl = svg('path', { fill: 'none', stroke: '#f0c75e', 'stroke-width': 4, opacity: 0 });
  wheelG.append(markEl);
  ballEl = svg('circle', { r: 6.5, fill: 'url(#ball)' });
  const defs = svg('defs', null,
    svg('radialGradient', { id: 'cone' }, svg('stop', { offset: '0', 'stop-color': '#7a4a22' }), svg('stop', { offset: '1', 'stop-color': '#3a2110' })),
    svg('radialGradient', { id: 'ball', cx: '35%', cy: '35%' }, svg('stop', { offset: '0', 'stop-color': '#fff' }), svg('stop', { offset: '1', 'stop-color': '#b9b9b9' })),
    svg('radialGradient', { id: 'bowl' }, svg('stop', { offset: '.8', 'stop-color': '#3a2110' }), svg('stop', { offset: '.93', 'stop-color': '#6b3f1e' }), svg('stop', { offset: '1', 'stop-color': '#2a1509' })));
  const root = svg('svg', { viewBox: '-205 -205 410 410' }, defs, svg('circle', { r: 203, fill: 'url(#bowl)' }), svg('circle', { r: 170, fill: '#1c0f07' }), wheelG, ballEl);
  $('#wheelBox').replaceChildren(root);
}

const SPIN_MS = 4400;
/** Ball's angle is tracked relative to the wheel, so it always comes to rest in the server's pocket. */
function playSpin(wheel, ls, net) {
  return new Promise((done) => {
    if (builtFor !== wheel) { buildBoard(wheel); buildWheel(wheel); }
    const el = $('#spinner'), banner = $('#rbanner');
    const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const T = calm ? 1 : SPIN_MS;
    const idx = wheelOrder.indexOf(ls.pocket), step = 360 / wheelOrder.length;
    const bp = $('#bPocket'); bp.textContent = ls.pocket; bp.className = 'pocket ' + ls.color;
    $('#bCall').textContent = `${ls.pocket} ${ls.color[0].toUpperCase() + ls.color.slice(1)}${describe(ls.pocket)}`;
    const nt = $('#bNet');
    nt.textContent = net == null ? '' : net === 0 ? 'No change' : (net > 0 ? 'You win ' : 'You lose ') + money(Math.abs(net));
    nt.className = 'nt ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : '');
    banner.classList.remove('show'); markEl.setAttribute('opacity', 0);
    el.hidden = false; void el.offsetWidth; el.classList.add('in');
    if (!calm) snd.ball(T * 0.8);

    const w0 = Math.random() * 360, laps = 360 * 6 + Math.random() * 360, t0 = performance.now();
    cancelAnimationFrame(raf);
    const draw = (t) => {
      const u = Math.min(1, t / T);
      const wheelDeg = w0 - t * 0.045;                                   // wheel turns slowly one way
      const rel = idx * step + laps * (1 - u) ** 3;                      // ball circles the other way and slows into its pocket
      let r = 182;
      if (u > 0.55) { const k = Math.min(1, (u - 0.55) / 0.3); r = 182 - 60 * k * k * (3 - 2 * k) + (u < 1 ? 7 * Math.abs(Math.sin(k * 9)) * (1 - k) : 0); }
      const [x, y] = polar(r, wheelDeg + rel);
      wheelG.setAttribute('transform', `rotate(${wheelDeg})`);
      ballEl.setAttribute('cx', x); ballEl.setAttribute('cy', y);
    };
    const frame = () => { draw(performance.now() - t0); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);

    let finished = false;
    const timers = [];
    const finish = () => {
      if (finished) return; finished = true;
      timers.forEach(clearTimeout); el.removeEventListener('click', finish);
      el.classList.remove('in');
      setTimeout(() => { el.hidden = true; banner.classList.remove('show'); cancelAnimationFrame(raf); done(); }, 260);
    };
    timers.push(setTimeout(() => {
      draw(performance.now() - t0);   // settle the ball even if the browser skipped frames
      const [x1, y1] = polar(168, (idx - 0.5) * step), [x2, y2] = polar(168, (idx + 0.5) * step), [x3, y3] = polar(104, (idx + 0.5) * step), [x4, y4] = polar(104, (idx - 0.5) * step);
      markEl.setAttribute('d', `M${x1} ${y1}A168 168 0 0 1 ${x2} ${y2}L${x3} ${y3}A104 104 0 0 0 ${x4} ${y4}Z`);
      markEl.setAttribute('opacity', 1);
      banner.classList.add('show'); snd.land();
      if (net > 0) snd.win(); else if (net < 0) snd.lose();
      if (navigator.vibrate) try { navigator.vibrate(net > 0 ? [30, 40, 30] : 25); } catch {}
    }, T + 80));
    timers.push(setTimeout(finish, T + (calm ? 1400 : 1900)));
    el.addEventListener('click', finish);
  });
}
/** Test hook: the pocket the ball is resting in, read back from the drawing. */
window.ballPocket = () => {
  const rot = +(/rotate\(([-\d.]+)/.exec(wheelG.getAttribute('transform')) || [0, 0])[1];
  const a = (Math.atan2(+ballEl.getAttribute('cx'), -ballEl.getAttribute('cy')) * 180) / Math.PI - rot;
  const n = wheelOrder.length;
  return wheelOrder[((Math.round(a / (360 / n)) % n) + n) % n];
};

// ---------- sheets ----------
function openSheet(s) { sheet = s; removeMode = false; if (state) render(); else renderSheet(); }
function closeSheet() { sheet = null; $('#sheet').hidden = true; $('#scrim').hidden = true; }
$('#scrim').addEventListener('click', closeSheet);
const head = (title) => h('div', { class: 'sh-h' }, h('h2', null, title), h('button', { class: 'x', 'aria-label': 'Close', on: { click: closeSheet } }, '×'));

function renderSheet() {
  const el = $('#sheet'), p = me();
  if (!sheet || !state || !p) return;
  const wrap = h('div', { class: 'wrap' });
  $('#scrim').hidden = false; el.hidden = false;
  if (sheet.type === 'player') {
    const x = state.players.find((q) => q.id === sheet.id);
    if (!x) return closeSheet();
    const net = x.bank + total(x.bets) - state.buyIn * (1 + x.rebuys);
    const list = h('div', { class: 'list' },
      h('div', null, `Chips ${money(x.bank)} · on table ${money(total(x.bets))} · session ${signed(net)}${x.rebuys ? ` · ${x.rebuys} rebuy${x.rebuys > 1 ? 's' : ''}` : ''}`),
      !x.connected && h('div', null, 'Away from the table'));
    const keys = Object.keys(x.bets);
    if (!keys.length) list.append(h('div', null, 'No bets on the table'));
    for (const k of keys) list.append(h('div', null, `${label(k)} — ${money(x.bets[k])} (pays ${payout(k, state.wheel)}:1)`));
    wrap.append(head(x.name + (x.id === myId ? ' (you)' : '')), list);
  } else if (sheet.type === 'log') {
    wrap.append(head('Table log'));
    const res = state.lastSpin && state.lastSpin.results[myId];
    if (res) {
      wrap.append(h('div', { class: 'sect', style: 'text-align:left;margin:4px 0' }, 'Your last spin'),
        h('div', { class: 'list' }, res.events.map((e) => h('div', { class: e.result === 'win' ? 'pos' : 'neg' }, `${e.label} ${e.result === 'win' ? 'won' : 'lost'} ${money(e.amount)}`))),
        h('div', { class: 'sect', style: 'text-align:left;margin:14px 0 4px' }, 'Table'));
    }
    wrap.append(h('div', { class: 'list' }, state.log.map((t) => h('div', null, t))));
  } else if (sheet.type === 'menu') {
    wrap.append(head('Menu'), h('div', { class: 'menu' },
      h('div', { class: 'tog' }, h('span', null, 'Sound effects'),
        h('button', { class: 'sw' + (muted ? '' : ' on'), 'aria-label': 'Toggle sound', on: { click: () => { muted = !muted; store.set('craps.mute', muted); renderSheet(); } } })),
      h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'log' }) } }, 'Table log & my last spin'),
      h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'fair' }) } }, 'Provably fair: verify the wheel'),
      h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'guide', tab: 'bets' }) } }, 'Guide: bets, payouts & FAQ'),
      h('a', { class: 'btn ghost', href: '/lab?game=roulette&wheel=' + state.wheel, style: 'text-decoration:none;margin-top:9px' }, 'Strategy Lab: simulate a strategy'),
      h('button', { class: 'btn ghost', on: { click: () => { send({ t: 'clear' }); undo = []; closeSheet(); } } }, 'Take down all my bets'),
      h('button', { class: 'btn ghost', on: { click: () => { send({ t: 'rebuy' }); closeSheet(); } } }, `Rebuy ${money(state.buyIn)} (when under ${money(state.buyIn / 2)})`),
      h('button', { class: 'btn ghost', style: 'color:var(--lose)', on: { click: () => send({ t: 'leave' }) } }, 'Leave table')));
  } else if (sheet.type === 'fair') {
    wrap.append(head('Provably fair'), Fair.sheet(state, myId, send, renderSheet));
  } else if (sheet.type === 'guide') {
    const tabs = [['basics', 'The game'], ['bets', 'Bets'], ['faq', 'FAQ']];
    wrap.append(head('Roulette guide'),
      h('div', { class: 'tabs' }, tabs.map(([id, name]) => h('button', { class: sheet.tab === id ? 'on' : '', on: { click: () => { sheet.tab = id; renderSheet(); el.scrollTop = 0; } } }, name))),
      guideNode(sheet.tab));
  }
  el.replaceChildren(wrap);
}

function guideNode(tab) {
  const T = (rows) => h('table', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))));
  const P = (...t) => h('p', null, ...t), H = (t) => h('h3', null, t), UL = (items) => h('ul', null, items.map((t) => h('li', null, t)));
  const Q = (q, a) => [h('p', { class: 'q' }, q), P(a)];
  const g = h('div', { class: 'guide' });
  const dbl = state.wheel === 'american', pockets = dbl ? 38 : 37, edge = dbl ? '5.26%' : '2.70%';
  if (tab === 'basics') g.append(
    H('How a spin works'),
    UL(['Everyone puts chips on the layout. Any player can press SPIN once at least one bet is down.',
      `The ball lands in one of ${pockets} pockets: 1 to 36, half red and half black, plus ${dbl ? 'green 0 and 00' : 'a green 0'}.`,
      'Every bet is settled on every spin. Winners come back to your chips with their winnings, losers are collected. Press Rebet to put the same bets up again.']),
    H('This wheel'),
    P(dbl ? 'Double zero (American). Two green pockets give the house 5.26% on every bet, and 7.89% on the five-number top line.'
      : 'Single zero (European). One green pocket gives the house 2.70% on every bet, about half the double-zero wheel.'),
    H('Playing at this table'),
    UL(['Pick a chip at the bottom, then tap a number or an outside box. Tap again to add more.',
      'The small dots on the lines are the inside bets that cover several numbers: tap the dot between two numbers for a split, at a four-way crossing for a corner, on the left edge beside a row for a street, and on the left edge between two rows for a six line.',
      'Undo takes back your last chip. Take down, then a bet, removes it.',
      `Inside bets start at ${money(state.minInside)}, outside bets at ${money(state.minOutside)}. Table maximum ${money(state.max)} per bet.`]),
    H('The wheel'),
    P('Each result comes from a secret seed the server locks in before you bet, mixed with a seed from each player\'s device. Every 10 spins the seed is revealed and you can recompute the results: Menu, then Provably fair. Every pocket is equally likely on every spin.'));
  else if (tab === 'bets') g.append(
    H('Inside bets'),
    T([[h('b', null, 'Bet'), h('b', null, 'Covers'), h('b', null, 'Pays')],
      ['Straight up', '1 number', '35:1'], ['Split', '2 neighbours', '17:1'], ['Street', 'a row of 3', '11:1'], ['Trio', 'zero + 2', '11:1'],
      ['Corner', '4 numbers', '8:1'], dbl ? ['Top line', '0, 00, 1, 2, 3', '6:1'] : ['First four', '0, 1, 2, 3', '8:1'], ['Six line', '2 rows, 6 numbers', '5:1']]),
    H('Outside bets'),
    T([[h('b', null, 'Bet'), h('b', null, 'Covers'), h('b', null, 'Pays')],
      ['Dozen', '12 numbers', '2:1'], ['Column', '12 numbers', '2:1'], ['Red / Black', '18 numbers', '1:1'], ['Even / Odd', '18 numbers', '1:1'], ['1 to 18 / 19 to 36', '18 numbers', '1:1']]),
    P(`Zero${dbl ? ' and double zero lose' : ' loses'} every outside bet. That is the whole house edge: a bet on n numbers pays as if there were 36 pockets, and there are ${pockets}.`),
    P(`Every bet on this wheel costs the same ${edge} of what you stake${dbl ? ', except the top line at 7.89%' : ''}. No combination of bets changes that.`));
  else g.append(
    ...Q('Single zero or double zero?', 'Single zero, always, if you have the choice. Same payouts, half the house edge: 2.70% against 5.26%.'),
    ...Q('Do bets stay up after a spin?', 'No. Every bet is decided by every spin, so the layout is cleared. Winning stakes come back to your chips with the winnings. Rebet puts your last layout back.'),
    ...Q('Red came up five times. Is black due?', 'No. Each spin is independent. The wheel has no memory, here or in a casino.'),
    ...Q('Does covering more numbers improve my odds?', 'It makes you win more often and win less each time. Red plus two columns wins on most spins, but the expected loss is still the house edge times everything you staked.'),
    ...Q('Does doubling after a loss work?', 'A Martingale wins small most sessions and occasionally loses everything it has won and more. The average result is the same house edge. The Strategy Lab in the menu shows the full spread.'),
    ...Q('Who spins?', 'Anyone seated. The wheel will not start a new spin until the last one has landed.'),
    ...Q('Is this real money?', 'No. Chips are play money, start fresh at every table, and cannot be bought, sold or cashed out.'));
  return g;
}

// ---------- chrome ----------
function measureDock() { document.documentElement.style.setProperty('--dock-h', $('#dock').offsetHeight + 'px'); }
window.addEventListener('resize', measureDock);
function buildChips() {
  $('#chips').replaceChildren(...CHIPS.map((c) => h('button', { class: `chip c${c}` + (c === chip ? ' sel' : ''), 'aria-label': `$${c} chip`,
    on: { click: () => { chip = c; buildChips(); } } }, c)));
}
$('#undo').addEventListener('click', () => { const u = undo.pop(); if (u) send({ t: 'remove', key: u.key, amt: u.amt }); });
$('#rem').addEventListener('click', () => { removeMode = !removeMode; render(); });
$('#rep').addEventListener('click', () => send({ t: 'repeat' }));
$('#spin').addEventListener('click', () => { removeMode = false; send({ t: 'spin' }); });
$('#menuBtn').addEventListener('click', () => openSheet({ type: 'menu' }));
$('#guideBtn').addEventListener('click', () => openSheet({ type: 'guide', tab: 'basics' }));
$('#last').addEventListener('click', () => openSheet({ type: 'log' }));
$('#share').addEventListener('click', async () => {
  const url = location.origin + '/?t=' + state.code;
  try {
    if (navigator.share) await navigator.share({ title: 'Roulette table', text: `Join my roulette table (code ${state.code})`, url });
    else { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
  } catch { toast(`Share code ${state.code}`); }
});

buildChips(); measureDock();
if (session) net.connect();
