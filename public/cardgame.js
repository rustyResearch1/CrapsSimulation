// Shared chrome for the card tables: connection, seats strip, chip rack, sheets, and the
// card-dealing animation clock. Each game supplies its felt, hand panel, actions and guide.
// Helpers ($, h, store, money, signed, toast, createNet, audio, tone) come from common.js; Fair from fair-ui.js.

const CHIPS = [1, 5, 25, 100, 500];
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const GAP = 330, DUR = 450;       // ms between cards, and for one card to land

export function start(def) {
  let session = store.get('craps.session');
  const urlCode = (new URLSearchParams(location.search).get('t') || '').toUpperCase().slice(0, 4);
  if (!session || (urlCode && session.code !== urlCode)) { location.replace('/' + (urlCode ? '?t=' + urlCode : '')); return; }

  let state = null, prev = null, myId = null, open = false, chip = 5, sheet = null, first = true;
  let frozen = null;              // { players, until }: last round's bankrolls, shown until the cards have landed
  const times = new Map();        // card key -> time its animation starts
  let lastStart = 0, animEnd = 0;
  const me = () => state && state.players.find((p) => p.id === myId);
  const snd = {
    chip() { const a = audio(); if (a) tone(a, a.currentTime, 2600, 0.05, 0.04); },
    card(at) { const a = audio(); if (a) tone(a, a.currentTime + at / 1000, 900 + Math.random() * 300, 0.07, 0.035, 'triangle'); },
    win() { const a = audio(); if (!a) return; [660, 880, 1320].forEach((f, i) => tone(a, a.currentTime + i * 0.09, f, 0.12, 0.25, 'sine')); },
    lose() { const a = audio(); if (!a) return; tone(a, a.currentTime, 196, 0.1, 0.3, 'triangle'); tone(a, a.currentTime + 0.12, 147, 0.1, 0.35, 'triangle'); },
  };

  // ---------- connection ----------
  const net = createNet({
    onMessage(m) {
      if (m.t === 'joined') {
        if (m.game !== def.game) { location.replace('/?t=' + m.code); return; }
        session = { code: m.code, id: m.id, token: m.token }; store.set('craps.session', session);
      } else if (m.t === 'state') { apply(m); }
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
    prev = state; state = m.state; myId = m.you;
    Fair.onState(state, send);
    plan();
    if (prev && state.n > prev.n && animEnd > Date.now()) {
      frozen = { state: prev, until: animEnd };
      const res = def.resultFor(state, myId);
      setTimeout(() => { if (res && res.net > 0) snd.win(); else if (res && res.net < 0) snd.lose(); if (res && navigator.vibrate) try { navigator.vibrate(res.net > 0 ? [30, 40, 30] : 25); } catch {} }, animEnd - Date.now());
    }
    first = false;
    render();
  }

  /** Give every card that has just appeared (or just turned face up) a slot on the dealing clock. */
  function plan() {
    const now = Date.now(), fresh = [];
    for (const c of def.cardsOf(state).sort((a, b) => a.q - b.q)) {
      const key = c.c ? c.key : c.key + ':back';
      if (times.has(key)) continue;
      if (first) { times.set(key, 0); continue; }                    // joining mid-hand: no replay
      const flip = !!c.c && times.has(c.key + ':back');              // a face-down card turning over
      lastStart = Math.max(now, lastStart + (flip ? 500 : def.gap || GAP));
      times.set(key, lastStart); if (flip) times.set(key + ':flip', lastStart);
      fresh.push(lastStart);
    }
    if (times.size > 600) for (const k of [...times.keys()].slice(0, 300)) times.delete(k);
    for (const t of fresh) { snd.card(t - now); setTimeout(render, t + DUR - now + 25); }
    if (fresh.length) animEnd = Math.max(animEnd, lastStart + DUR + 250);
    if (fresh.length) setTimeout(render, animEnd - now + 30);
  }
  /** Has this card finished arriving? Totals and results only count landed cards. */
  const landed = (card) => { const t = times.get(card.c ? card.key : card.key + ':back'); return t === undefined || Date.now() >= t + DUR; };
  const revealed = () => Date.now() >= animEnd;

  function cardEl(card, opts = {}) {
    const now = Date.now(), key = card.c ? card.key : card.key + ':back', t = times.get(key);
    const red = card.c && (card.c[1] === 'H' || card.c[1] === 'D');
    const el = h('div', { class: 'pc' + (opts.small ? ' sm' : '') + (card.c ? '' : ' back') + (red ? ' red' : '') + (opts.side ? ' side' : '') });
    if (card.c) { const r = card.c[0] === 'T' ? '10' : card.c[0]; el.append(h('span', { class: 'r' }, r), h('span', { class: 's' }, SUIT[card.c[1]]), h('span', { class: 'big' }, SUIT[card.c[1]])); }
    if (t && now < t + DUR) {
      el.classList.add(times.has(key + ':flip') ? 'flip' : 'deal');
      el.style.animationDelay = (t - now) + 'ms';
    }
    return el;
  }

  // ---------- render ----------
  function ctx() {
    const old = frozen && Date.now() < frozen.until ? frozen.state : null;   // chips move only once the cards have landed
    const view = old ? { ...state, players: state.players.map((p) => { const o = old.players.find((x) => x.id === p.id); return o ? { ...p, bank: o.bank, bets: o.bets ?? p.bets, on: def.onTable(o, old) } : p; }) } : state;
    return { state, view, myId, me: me(), meView: view.players.find((p) => p.id === myId), chip, send, cardEl, landed, revealed: revealed(), sinceReveal: Date.now() - animEnd, bet, rerender: render, snd };
  }
  function bet(key) {
    const p = me(); if (!p) return;
    if (chip > p.bank) return toast('Not enough chips');
    send(key ? { t: 'bet', key, amt: chip } : { t: 'bet', amt: chip });
    snd.chip();
  }
  function render() {
    const p = me();
    if (!state || !p) return;
    const c = ctx();
    $('#code').textContent = state.code;
    $('#gameName').textContent = def.title;
    document.title = def.title + ' Table';
    $('#players').replaceChildren(...c.view.players.map((x) => {
      const netv = x.bank + (x.on ?? def.onTable(x, state)) - state.buyIn * (1 + x.rebuys);
      return h('button', { class: 'pl' + (x.id === myId ? ' me' : '') + (def.isTurn(state, x.id) ? ' shooter' : '') + (x.connected ? '' : ' away'), on: { click: () => openSheet({ type: 'player', id: x.id }) } },
        h('div', { class: 'nm' }, x.name, x.id === myId ? ' (you)' : ''), h('div', { class: 'bk' }, money(x.bank)),
        h('div', { class: 'nt ' + (netv > 0 ? 'pos' : netv < 0 ? 'neg' : '') }, signed(netv)));
    }));
    const head = def.header(c);
    $('#phase').replaceChildren(...[].concat(head.phase));
    $('#call').textContent = head.call;
    const mine = $('#mine'); mine.textContent = head.mine || ''; mine.className = head.mineClass || '';
    const felt = $('#felt'); felt.className = def.feltClass; felt.replaceChildren(...[].concat(def.felt(c)));
    $('#hand').replaceChildren(...[].concat(def.hand ? def.hand(c) || [] : []));

    const onTable = c.meView.on ?? def.onTable(c.meView, state), netv = c.meView.bank + onTable - state.buyIn * (1 + p.rebuys);
    $('#bank').textContent = money(c.meView.bank);
    $('#onTable').textContent = money(onTable);
    const netEl = $('#net'); netEl.textContent = signed(netv); netEl.className = netv > 0 ? 'pos' : netv < 0 ? 'neg' : '';
    const acts = def.actions(c);
    $('#chips').hidden = !acts.chips;
    if (acts.chips) $('#chips').replaceChildren(...CHIPS.map((v) => h('button', { class: `chip c${v}` + (v === chip ? ' sel' : ''), 'aria-label': `$${v} chip`, on: { click: () => { chip = v; render(); } } }, v)));
    $('#acts').replaceChildren(...acts.buttons.map((b) => h('button', { class: 'act ' + (b.cls || ''), disabled: b.disabled, on: { click: b.do } }, b.text)));
    document.documentElement.style.setProperty('--dock-h', $('#dock').offsetHeight + 'px');
    if (sheet) renderSheet();
  }
  setInterval(() => { if (state && def.ticks && def.ticks(state)) render(); }, 1000);

  // ---------- sheets ----------
  function openSheet(s) { sheet = s; render(); }
  function closeSheet() { sheet = null; $('#sheet').hidden = true; $('#scrim').hidden = true; }
  $('#scrim').addEventListener('click', closeSheet);
  const sheetHead = (title) => h('div', { class: 'sh-h' }, h('h2', null, title), h('button', { class: 'x', 'aria-label': 'Close', on: { click: closeSheet } }, '×'));
  function renderSheet() {
    const el = $('#sheet'), p = me();
    if (!sheet || !state || !p) return;
    const keep = el.scrollTop, wrap = h('div', { class: 'wrap' });
    $('#scrim').hidden = false; el.hidden = false;
    if (sheet.type === 'player') {
      const x = state.players.find((q) => q.id === sheet.id);
      if (!x) return closeSheet();
      const on = def.onTable(x, state), netv = x.bank + on - state.buyIn * (1 + x.rebuys);
      wrap.append(sheetHead(x.name + (x.id === myId ? ' (you)' : '')), h('div', { class: 'list' },
        h('div', null, `Chips ${money(x.bank)} · on table ${money(on)} · session ${signed(netv)}${x.rebuys ? ` · ${x.rebuys} rebuy${x.rebuys > 1 ? 's' : ''}` : ''}`),
        !x.connected && h('div', null, 'Away from the table'), def.betLines(x, state).map((t) => h('div', null, t))));
    } else if (sheet.type === 'log') {
      wrap.append(sheetHead('Table log'));
      const res = revealed() ? def.resultFor(state, myId) : null;
      if (res) wrap.append(h('div', { class: 'sect', style: 'text-align:left;margin:4px 0' }, `Your last ${def.noun}`),
        h('div', { class: 'list' }, res.events.map((e) => h('div', { class: e.result === 'win' ? 'pos' : e.result === 'lose' ? 'neg' : '' }, `${e.label} ${e.result === 'win' ? 'won' : e.result === 'lose' ? 'lost' : 'pushed'}${e.amount ? ' ' + money(e.amount) : ''}`))),
        h('div', { class: 'sect', style: 'text-align:left;margin:14px 0 4px' }, 'Table'));
      wrap.append(h('div', { class: 'list' }, state.log.map((t) => h('div', null, t))));
    } else if (sheet.type === 'fair') {
      wrap.append(sheetHead('Provably fair'), Fair.sheet(state, myId, send, renderSheet));
    } else if (sheet.type === 'menu') {
      wrap.append(sheetHead('Menu'), h('div', { class: 'menu' },
        h('div', { class: 'tog' }, h('span', null, 'Sound effects'),
          h('button', { class: 'sw' + (muted ? '' : ' on'), 'aria-label': 'Toggle sound', on: { click: () => { muted = !muted; store.set('craps.mute', muted); renderSheet(); } } })),
        (def.menu ? def.menu(ctx(), renderSheet) : []),
        h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'log' }) } }, `Table log & my last ${def.noun}`),
        h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'fair' }) } }, 'Provably fair: verify the shuffle'),
        h('button', { class: 'btn ghost', on: { click: () => openSheet({ type: 'guide', tab: def.guideTabs[0][0] }) } }, 'Guide: rules, payouts & FAQ'),
        h('button', { class: 'btn ghost', on: { click: () => { send({ t: 'rebuy' }); closeSheet(); } } }, `Rebuy ${money(state.buyIn)} (when under ${money(state.buyIn / 2)})`),
        h('button', { class: 'btn ghost', style: 'color:var(--lose)', on: { click: () => send({ t: 'leave' }) } }, 'Leave table')));
    } else if (sheet.type === 'guide') {
      wrap.append(sheetHead(def.title + ' guide'),
        h('div', { class: 'tabs' }, def.guideTabs.map(([id, name]) => h('button', { class: sheet.tab === id ? 'on' : '', on: { click: () => { sheet.tab = id; renderSheet(); el.scrollTop = 0; } } }, name))),
        def.guide(sheet.tab, state));
    }
    el.replaceChildren(wrap);
    el.scrollTop = keep;
  }

  $('#menuBtn').addEventListener('click', () => openSheet({ type: 'menu' }));
  $('#guideBtn').addEventListener('click', () => openSheet({ type: 'guide', tab: def.guideTabs[0][0] }));
  $('#status').addEventListener('click', () => openSheet({ type: 'log' }));
  $('#share').addEventListener('click', async () => {
    const url = location.origin + '/?t=' + state.code;
    try {
      if (navigator.share) await navigator.share({ title: def.title + ' table', text: `Join my ${def.title.toLowerCase()} table (code ${state.code})`, url });
      else { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
    } catch { toast(`Share code ${state.code}`); }
  });
  window.addEventListener('resize', () => state && render());
  window.cardGame = { get state() { return state; }, get myId() { return myId; }, revealed, send };   // test hook
  net.connect();
}

/** Shoe and discard tray, with the cards left when one shoe is dealt hand after hand. */
export function shoeBits(s) {
  const out = [h('div', { class: 'tray' }), h('div', { class: 'shoe' })], sh = s.shoe;
  if (sh && sh.mode === 'shoe') out.push(
    h('div', { class: 'shoeN' + (sh.last ? ' last' : '') }, `${sh.left} left`, h('br'), sh.last ? 'last hand' : `cut at ${sh.cutAt}`),
    h('div', { class: 'trayN' }, `${sh.total - sh.left} used`));
  else if (sh) out.push(h('div', { class: 'shoeN' }, 'shuffled', h('br'), 'every hand'));
  return out;
}

/** Guide building blocks shared by both games. */
export const G = {
  T: (rows) => h('table', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))),
  P: (...t) => h('p', null, ...t), H: (t) => h('h3', null, t), UL: (items) => h('ul', null, items.map((t) => h('li', null, t))),
  Q: (q, a) => [h('p', { class: 'q' }, q), h('p', null, a)],
};
