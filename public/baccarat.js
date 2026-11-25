// Baccarat client: Player and Banker card zones under the dealer, betting boxes, bead road.
import { start, G, shoeBits } from '/cardgame.js';
import { total, BETS } from '/shared/baccarat.js';

const sum = (b) => Object.values(b || {}).reduce((s, v) => s + v, 0);
const BOX = [['player', 'PLAYER', 'pays 1 to 1', 'p'], ['tie', 'TIE', '8 to 1', 't'], ['banker', 'BANKER', '0.95 to 1', 'b']];
const PAIRS = [['ppair', 'P PAIR', '11 to 1', 'p'], ['bpair', 'B PAIR', '11 to 1', 'b']];

function cardsOf(s) {
  const L = s.last; if (!L) return [];
  const out = [], add = (side, i, q) => { const c = L[side][i]; if (c) out.push({ c, q, key: `${s.code}:${L.n}:${side[0]}${i}` }); };
  add('player', 0, 1); add('banker', 0, 2); add('player', 1, 3); add('banker', 1, 4); add('player', 2, 5); add('banker', 2, 6);
  return out;
}

function felt(c) {
  const s = c.state, L = s.last, cards = cardsOf(s), done = c.revealed;
  const zone = (side, cls) => {
    const mine = cards.filter((x) => x.key.split(':')[2][0] === side[0]), down = mine.filter(c.landed);
    return h('div', { class: `bz ${cls}` + (done && L && L.winner === side ? ' winner' : '') }, h('h4', null, side.toUpperCase()),
      h('div', { class: 'zone' }, h('div', { class: 'cardsRow' }, mine.map((x, i) => c.cardEl(x, { side: i === 2 }))),
        h('div', { class: 'total' + (done && L && L.winner === side ? ' good' : ''), style: down.length ? '' : 'visibility:hidden' }, down.length ? String(total(down.map((x) => x.c))) : '0')));
  };
  const flash = done && L && c.sinceReveal < 1800 ? L : null;
  const hit = (key) => flash && (key === flash.winner || (key === 'ppair' && flash.pPair) || (key === 'bpair' && flash.bPair));
  const box = ([key, name, pays, cls]) => {
    const my = (c.meView.bets || {})[key] || 0, others = c.view.players.reduce((t, p) => t + (p.id === c.myId ? 0 : (p.bets || {})[key] || 0), 0);
    return h('button', { class: `bb ${cls}` + (hit(key) ? ' won' : ''), on: { click: () => (done ? c.bet(key) : toast('Wait for the cards')) } },
      h('span', { class: 't' }, name), h('span', { class: 's' }, pays), others ? h('span', { class: 'oth' }, money(others)) : null, my ? h('span', { class: 'badge' }, money(my)) : null);
  };
  const beads = (done ? s.history : s.history.slice(1)).slice(0, 60).reverse();
  return [...shoeBits(s), h('div', { class: 'dealerTag', style: 'margin-top:6px' }, 'DEALER'),
    h('div', { class: 'bacTop' }, zone('player', 'p'), zone('banker', 'b')),
    h('div', { class: 'bacBets' }, BOX.map(box)), h('div', { class: 'bacBets two' }, PAIRS.map(box)),
    h('div', { class: 'road', 'aria-label': 'Results so far' }, beads.map((w) => h('i', { class: w }, w)))];
}

function actions(c) {
  const s = c.state, me = c.me, any = s.players.some((p) => sum(p.bets) > 0);
  return { chips: true, buttons: [
    { text: 'Clear', do: () => c.send({ t: 'clear' }), disabled: !sum(me.bets) },
    { text: 'Rebet', do: () => c.send({ t: 'repeat' }), disabled: !me.canRepeat || !c.revealed },
    { text: !c.revealed ? 'Dealing…' : any ? 'DEAL' : 'Bet to deal', do: () => c.send({ t: 'deal' }), cls: 'primary', disabled: !any || !c.revealed }] };
}

function header(c) {
  const s = c.state, L = s.last, res = c.revealed && L ? L.results[c.myId] : null;
  if (!c.revealed) return { phase: [h('b', null, 'No more bets')], call: 'Dealing…' };
  return { phase: [h('b', null, 'Place your bets'), ` · coup ${s.n + 1}`], call: L ? L.call + (L.pPair || L.bPair ? ` · ${L.pPair && L.bPair ? 'both pairs' : L.pPair ? 'Player pair' : 'Banker pair'}` : '') : 'Welcome to the table',
    mine: res ? (res.net > 0 ? `You won ${money(res.net)}` : res.net < 0 ? `You lost ${money(-res.net)}` : 'Push: your bet comes back') : '', mineClass: res ? (res.net > 0 ? 'pos' : res.net < 0 ? 'neg' : '') : '' };
}

function guide(tab) {
  const { T, P, H, UL, Q } = G, d = h('div', { class: 'guide' });
  if (tab === 'basics') d.append(
    P('Two hands are dealt, Player and Banker. You bet on which one finishes closer to 9. You never choose how the cards are drawn.'),
    H('Counting'), UL(['Aces count 1, tens and face cards count 0, the rest count their number.', 'Only the last digit matters: 7 + 8 = 15 counts as 5.', 'An 8 or 9 on the first two cards is a natural and ends the coup.']),
    H('The third card'), UL(['Player draws on 0–5 and stands on 6–7.', 'If Player stood, Banker draws on 0–5.', 'If Player drew, Banker follows a fixed chart based on the card Player took.']),
    P('The third card is laid sideways, as at a real table.'));
  else if (tab === 'bets') d.append(
    T([['Bet', 'Pays', 'House edge'], ['Banker', '0.95 to 1', '1.06%'], ['Player', '1 to 1', '1.24%'], ['Tie', '8 to 1', '14.36%'], ['Player pair', '11 to 1', '10.36%'], ['Banker pair', '11 to 1', '10.36%']]),
    P('Banker wins a little more often, so wins pay 19 to 20: the 5% commission.'), P('A tie returns Player and Banker bets. Pair bets win when that side’s first two cards match in rank.'),
    P('All bets are one coup only: they are settled and cleared on every deal.'));
  else d.append(
    Q('Which bet is best?', 'Banker, by a hair. Player is close behind. Tie and the pairs cost roughly ten times as much per dollar.'),
    Q('Do the dots predict anything?', 'No. The road is only a record of past coups, and the shuffle is verifiable.'),
    Q('Who deals?', 'Anyone at the table can tap Deal once at least one bet is down.'),
    Q('How do I know the shuffle is honest?', 'Menu → Provably fair. The shoe comes from a seed committed before the deal, and you can re-check every card.'));
  return d;
}

start({
  game: 'baccarat', title: 'Baccarat', noun: 'coup', feltClass: 'bac', gap: 720,
  cardsOf, felt, actions, header, guide, guideTabs: [['basics', 'The game'], ['bets', 'Bets & odds'], ['faq', 'FAQ']],
  resultFor: (s, id) => (s.last ? s.last.results[id] || null : null),
  onTable: (p) => sum(p.bets),
  isTurn: () => false,
  hand: () => [h('div', { class: 'note', style: 'margin-top:10px' }, 'Tap a box to bet the selected chip. Bets ride for one coup.')],
  betLines: (p) => { const e = Object.entries(p.bets || {}); return e.length ? e.map(([k, v]) => `${BETS[k].name}: ${money(v)}`) : ['No bets down']; },
});
