// Yatzy client: a two-column score card and five 3D dice that tumble to the server's result.
// Helpers ($, h, store, toast, createNet, audio, tone) come from common.js; Fair from fair-ui.js.
import { UPPER, LOWER, NAMES, HINT, BONUS_AT, BONUS, ROLLS, score, totals } from '/shared/yatzy.js';

const SPIN_MS = 900;
let session = store.get('craps.session');
const urlCode = (new URLSearchParams(location.search).get('t') || '').toUpperCase().slice(0, 4);
if (!session || (urlCode && session.code !== urlCode)) location.replace('/' + (urlCode ? '?t=' + urlCode : ''));

let state = null, myId = null, open = false, sheet = null, pick = null, first = true;
let seenRoll = 0, seenScore = 0, landAt = 0, justKey = '', justUntil = 0;
const me = () => state && state.players.find((p) => p.id === myId);
const mine = () => !!state && state.phase === 'play' && state.turn === myId;
const rolling = () => Date.now() < landAt;

const snd = {
  rattle() { const a = audio(); if (!a) return; for (let i = 0; i < 7; i++) tone(a, a.currentTime + i * 0.085 + Math.random() * 0.03, 500 + Math.random() * 900, 0.05, 0.03, 'square'); },
  land() { const a = audio(); if (a) tone(a, a.currentTime, 240, 0.09, 0.08, 'triangle'); },
  tick() { const a = audio(); if (a) tone(a, a.currentTime, 1800, 0.04, 0.03); },
  good() { const a = audio(); if (!a) return; [660, 880, 1320].forEach((f, i) => tone(a, a.currentTime + i * 0.09, f, 0.12, 0.25, 'sine')); },
  low() { const a = audio(); if (a) tone(a, a.currentTime, 196, 0.08, 0.25, 'triangle'); },
};

// ---------- dice (built once, so the cubes can keep turning between renders) ----------
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] };   // cube turn that brings each face to the front
const dice = [0, 1, 2, 3, 4].map((i) => {
  const cube = h('div', { class: 'ycube' }, [1, 2, 3, 4, 5, 6].map((v) => h('div', { class: 'df f' + v }, Array.from({ length: 9 }, (_, k) => h('i', { class: PIPS[v].includes(k) ? 'o' : '' })))));
  const el = h('button', { class: 'dw blank', 'aria-label': `Die ${i + 1}`, on: { click: () => hold(i) } }, cube);
  return { el, cube, sx: 0, sy: 0, v: 0 };
});
$('#tray').append(...dice.map((d) => d.el));
function face(d, v, spin, delay) {
  if (spin) { d.sx += 360 * (1 + Math.floor(Math.random() * 2)); d.sy += 360 * (1 + Math.floor(Math.random() * 2)); }
  d.v = v;
  const [x, y] = FACE[v] || [0, 0];
  d.cube.style.transitionDelay = (delay || 0) + 'ms';
  d.cube.style.transitionDuration = spin ? '' : '0s';
  d.cube.style.transform = `translateZ(-26px) rotateX(${x + d.sx}deg) rotateY(${y + d.sy}deg)`;
}
function hold(i) {
  if (!mine()) return toast(state && state.phase === 'play' ? 'Not your turn' : 'No game in progress');
  if (!state.used) return toast('Roll first');
  if (rolling()) return;
  send({ t: 'hold', i }); snd.tick();
}

// ---------- connection ----------
const net = createNet({
  onMessage(m) {
    if (m.t === 'joined') {
      if (m.game !== 'yatzy') { location.replace('/?t=' + m.code); return; }
      session = { code: m.code, id: m.id, token: m.token }; store.set('craps.session', session);
    } else if (m.t === 'state') apply(m);
    else if (m.t === 'error') { if (m.fatal) leave(); else toast(m.msg); }
    else if (m.t === 'left') leave();
  },
  onStatus(up) { open = up; $('#conn').classList.toggle('off', !up); },
  hello: () => (session ? { t: 'join', code: session.code, id: session.id, token: session.token, name: store.get('craps.name') || '' } : null),
  wanted: () => !!session,
});
function send(obj) { if (open) net.send(obj); else toast('Reconnecting…'); }
function leave() { session = null; store.del('craps.session'); location.replace('/'); }

function apply(m) {
  const prevTurn = state && state.turn;
  state = m.state; myId = m.you;
  Fair.onState(state, send);
  const L = state.last, S = state.scored;
  if (L && L.seq !== seenRoll) {
    seenRoll = L.seq;
    if (first) dice.forEach((d, i) => face(d, state.dice[i], false));
    else {
      L.idx.forEach((i, k) => face(dice[i], state.dice[i], true, k * 70));
      landAt = Date.now() + SPIN_MS + (L.idx.length - 1) * 70;
      snd.rattle(); setTimeout(() => { snd.land(); render(); }, landAt - Date.now() + 20);
      if (L.lucky) setTimeout(() => { toast(L.by === myId ? 'Lucky! You banked a bonus roll' : 'Lucky roll: bonus roll banked'); snd.good(); }, SPIN_MS);
      if (navigator.vibrate && L.by === myId) try { navigator.vibrate(20); } catch {}
    }
  }
  if (first && state.used) dice.forEach((d, i) => { if (state.dice[i]) face(d, state.dice[i], false); });
  if (S && S.seq !== seenScore) {
    seenScore = S.seq;
    if (!first) { justKey = S.by + ':' + S.cat; justUntil = Date.now() + 1400; if (S.pts >= 25 || S.again) snd.good(); else if (!S.pts) snd.low(); else snd.tick(); if (S.again) toast('Second Yatzy: +100 bonus'); }
  }
  if (state.turn !== prevTurn || !mine()) pick = null;
  if (!first && state.phase === 'over' && prevTurn) { if (state.winner === myId) snd.good(); }
  first = false;
  render();
}

// ---------- render ----------
function render() {
  const p = me();
  if (!state || !p) return;
  const turnP = state.players.find((x) => x.id === state.turn), my = mine(), busy = rolling(), solo = state.players.length === 1;
  $('#code').textContent = state.code;
  const left = Math.max(0, state.rolls - state.used);
  let phase, call;
  if (state.phase === 'wait') { phase = 'Waiting'; call = 'Invite a friend, or practice solo'; }
  else if (state.phase === 'over') { phase = 'Game over'; call = solo ? `Final score ${totals(p.card, p.extra).total}` : state.winner === 'tie' ? 'Tie game' : state.winner === myId ? 'You win!' : `${state.players.find((x) => x.id === state.winner)?.name || 'Opponent'} wins`; }
  else if (my) { phase = solo ? 'Solo practice' : 'Your turn'; call = !state.used ? 'Roll the dice' : left ? `Tap dice to hold · ${left} roll${left === 1 ? '' : 's'} left` : p.bank ? 'Pick a box, or spend a bonus roll' : 'Pick a box to score'; }
  else { phase = `${turnP.name}'s turn`; call = state.used ? `Roll ${Math.min(state.used, state.rolls)} of ${state.rolls}${state.used > state.rolls ? ' + bonus' : ''}` : 'Waiting for the roll'; }
  $('#phase').replaceChildren(h('b', null, phase)); $('#call').textContent = call;

  // dice
  dice.forEach((d, i) => {
    d.el.classList.toggle('blank', !state.used || state.phase !== 'play');
    d.el.classList.toggle('held', !!state.used && state.held[i] && state.phase === 'play');
  });

  // board
  const cols = [p, ...state.players.filter((x) => x.id !== myId)], canPick = my && state.used > 0 && !busy;
  const out = [];
  if (state.phase === 'wait') out.push(h('div', { class: 'ybanner' }, h('h3', null, '1 v 1 Yatzy'), h('p', null, `Share code ${state.code} with a friend. The game starts when they sit down.`),
    h('button', { class: 'btn gold', style: 'margin-top:0', on: { click: share } }, 'Invite a friend'), h('button', { class: 'btn ghost', on: { click: () => send({ t: 'start' }) } }, 'Practice solo')));
  if (state.phase === 'over') {
    const t = cols.map((x) => totals(x.card, x.extra).total);
    out.push(h('div', { class: 'ybanner' }, h('h3', null, call), h('p', null, solo ? 'A good solo score is 200 or more.' : `${t[0]} to ${t[1]} · games won ${cols[0].wins}–${cols[1].wins}`),
      h('button', { class: 'btn gold', style: 'margin-top:0', on: { click: () => send({ t: 'rematch' }) } }, solo ? 'Play again' : 'Rematch')));
  }
  const tbl = h('table', { class: 'card13' });
  tbl.append(h('tr', null, h('th', null, ''), cols.map((x) => h('th', { class: state.turn === x.id ? 'on' : '' },
    h('span', { class: 'who' }, x.id === myId ? 'You' : x.name, x.connected ? '' : ' (away)'),
    h('span', { class: 'meta' }, h('span', { class: 'star' }, '★'.repeat(x.bank) || '–'), ' bonus roll', x.bank === 1 ? '' : 's')))));
  const row = (cat) => h('tr', null, h('td', null, NAMES[cat], h('small', null, HINT[cat])), cols.map((x) => {
    const v = x.card[cat], just = justKey === x.id + ':' + cat && Date.now() < justUntil;
    if (v !== undefined) return h('td', { class: 'sc' + (v ? '' : ' zero') + (just ? ' just' : '') }, v);
    if (x.id === myId && canPick) { const pts = score(cat, state.dice); return h('td', { class: 'sc open' }, h('button', { class: 'pick' + (pts ? '' : ' z') + (pick === cat ? ' sel' : ''), 'aria-label': `Score ${pts} in ${NAMES[cat]}`, on: { click: () => { pick = pick === cat ? null : cat; snd.tick(); render(); } } }, pts)); }
    return h('td', { class: 'sc' }, '');
  }));
  for (const c of UPPER) tbl.append(row(c));
  tbl.append(h('tr', { class: 'sumrow' }, h('td', null, `Bonus +${BONUS}`, h('small', null, `top six reach ${BONUS_AT}`)), cols.map((x) => { const t = totals(x.card, x.extra); return h('td', { class: 'sc' + (t.bonus ? ' got' : '') }, t.bonus ? `+${BONUS}` : `${t.upper}/${BONUS_AT}`); })));
  for (const c of LOWER) tbl.append(row(c));
  if (cols.some((x) => x.extra)) tbl.append(h('tr', { class: 'sumrow' }, h('td', null, 'Extra Yatzy', h('small', null, '+100 each')), cols.map((x) => h('td', { class: 'sc' + (x.extra ? ' got' : '') }, x.extra ? `+${x.extra * 100}` : ''))));
  tbl.append(h('tr', { class: 'tot' }, h('td', null, 'Total'), cols.map((x) => h('td', { class: 'sc' }, totals(x.card, x.extra).total))));
  out.push(tbl);
  $('#board').replaceChildren(...out);

  // actions
  const acts = [];
  if (state.phase === 'play') {
    const bonus = state.used >= state.rolls, canRoll = my && !busy && (!bonus || p.bank > 0) && !(state.used && state.held.every(Boolean));
    const label = !my ? `${turnP.name} is playing` : busy ? 'Rolling…' : !state.used ? 'ROLL' : bonus ? (p.bank ? `Bonus roll ★${p.bank}` : 'No rolls left') : state.held.every(Boolean) ? 'All dice held' : `ROLL · ${left} left`;
    acts.push(h('button', { class: 'act primary', disabled: !canRoll, on: { click: () => send({ t: 'roll' }) } }, label));
    if (my && state.used) acts.push(h('button', { class: 'act score', disabled: !pick || busy, on: { click: () => { send({ t: 'score', cat: pick }); pick = null; } } }, pick ? `Score ${score(pick, state.dice)} · ${NAMES[pick]}` : 'Tap a box to score'));
  }
  $('#acts').replaceChildren(...acts);
  $('#dock').hidden = state.phase === 'wait';
  document.documentElement.style.setProperty('--dock-h', (state.phase === 'wait' ? 0 : $('#dock').offsetHeight) + 'px');
  if (sheet) renderSheet();
}

// ---------- sheets ----------
function openSheet(s) { sheet = s; render(); }
function closeSheet() { sheet = null; $('#sheet').hidden = true; $('#scrim').hidden = true; }
$('#scrim').addEventListener('click', closeSheet);
const sheetHead = (title) => h('div', { class: 'sh-h' }, h('h2', null, title), h('button', { class: 'x', 'aria-label': 'Close', on: { click: closeSheet } }, '×'));
function guide(tab) {
  const T = (rows) => h('table', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))), P = (t) => h('p', null, t), H = (t) => h('h3', null, t);
  const Q = (q, a) => [h('p', { class: 'q' }, q), h('p', null, a)], UL = (items) => h('ul', null, items.map((t) => h('li', null, t)));
  const d = h('div', { class: 'guide' });
  if (tab === 'basics') d.append(P('Two players take turns filling a 13-box score card. Highest total wins.'),
    H('Your turn'), UL(['Roll all five dice.', 'Tap the dice you want to keep, then roll the rest. You get three rolls.', 'Tap a box on your card, then Score. Each box can be used once.', 'If nothing fits, you must put a zero somewhere.']),
    H('Bonus rolls'), UL(['Everyone starts with one bonus roll (★).', 'On the first roll of each turn there is a 1 in 6 chance of banking another. You can hold up to three.', 'After your third roll, a bonus roll gives you one more roll that turn.']));
  else if (tab === 'boxes') d.append(T([['Ones to Sixes', 'Sum of that number'], ['Bonus', '+35 when the top six reach 63'], ['3 of a kind', 'Sum of all five dice'], ['4 of a kind', 'Sum of all five dice'], ['Full house', '25 (three of one, two of another)'], ['Small straight', '30 (four in a row)'], ['Large straight', '40 (five in a row)'], ['Chance', 'Sum of all five dice'], ['Yatzy', '50 (five of a kind)'], ['Extra Yatzy', '+100 for each Yatzy after the first']]),
    P('63 in the top six is three of each number. Four of a kind in one number covers a miss in another.'));
  else d.append(Q('Can a third person join?', 'No. Yatzy tables are 1v1. Open a second table for another pair.'),
    Q('What if my friend joins while I am playing solo?', 'The solo game ends and a fresh 1v1 starts.'),
    Q('Who goes first?', 'The table opener in game one, then you alternate each rematch.'),
    Q('Are the dice fair?', 'Menu → Provably fair. Each roll is five dice plus the lucky die, all from a seed locked in before the roll.'));
  return d;
}
function renderSheet() {
  const el = $('#sheet'), p = me();
  if (!sheet || !state || !p) return;
  const keep = el.scrollTop, wrap = h('div', { class: 'wrap' });
  $('#scrim').hidden = false; el.hidden = false;
  if (sheet.type === 'log') wrap.append(sheetHead('Game log'), h('div', { class: 'list' }, state.log.map((t) => h('div', null, t))));
  else if (sheet.type === 'fair') wrap.append(sheetHead('Provably fair'), Fair.sheet(state, myId, send, renderSheet));
  else if (sheet.type === 'menu') wrap.append(sheetHead('Menu'), h('div', { class: 'menu' },
    h('div', { class: 'tog' }, h('span', null, 'Sound effects'), h('button', { class: 'sw' + (muted ? '' : ' on'), 'aria-label': 'Toggle sound', on: { click: () => { muted = !muted; store.set('craps.mute', muted); renderSheet(); } } })),
    h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'log' }) } }, 'Game log'),
    h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'fair' }) } }, 'Provably fair: verify the dice'),
    h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'guide', tab: 'basics' }) } }, 'Guide: rules & scoring'),
    h('button', { class: 'btn ghost', style: 'color:var(--lose)', on: { click: () => send({ t: 'leave' }) } }, 'Leave table')));
  else if (sheet.type === 'guide') wrap.append(sheetHead('Yatzy guide'),
    h('div', { class: 'tabs' }, [['basics', 'How to play'], ['boxes', 'Scoring'], ['faq', 'FAQ']].map(([id, name]) => h('button', { class: sheet.tab === id ? 'on' : '', on: { click: () => { sheet.tab = id; renderSheet(); el.scrollTop = 0; } } }, name))), guide(sheet.tab));
  el.replaceChildren(wrap);
  el.scrollTop = keep;
}
async function share() {
  const url = location.origin + '/?t=' + state.code;
  try {
    if (navigator.share) await navigator.share({ title: 'Yatzy', text: `Play me at Yatzy (code ${state.code})`, url });
    else { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
  } catch { toast(`Share code ${state.code}`); }
}
$('#menuBtn').addEventListener('click', () => openSheet({ type: 'menu' }));
$('#guideBtn').addEventListener('click', () => openSheet({ type: 'guide', tab: 'basics' }));
$('#ystatus').addEventListener('click', () => openSheet({ type: 'log' }));
$('#share').addEventListener('click', share);
window.addEventListener('resize', () => state && render());
window.yatzy = { get state() { return state; }, get myId() { return myId; }, rolling, tops: () => dice.map((d) => d.v), send };   // test hook
if (session) net.connect();
