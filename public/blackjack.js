// Blackjack client: semi-circular felt, dealer and shoe at the top, seats along the rail.
import { start, G, shoeBits } from '/cardgame.js';
import { value, basicStrategy, canSplit, canDouble } from '/shared/blackjack.js';

const rid = (s) => (s.phase === 'bet' ? s.n : s.n + 1);           // the round the cards on the felt belong to
const keyed = (s, cards) => cards.map((x) => ({ ...x, key: `${s.code}:${rid(s)}:${x.q}` }));
const inPlay = (p, s) => (s.phase === 'bet' ? 0 : p.hands.reduce((t, x) => t + x.bet, 0) + (p.insurance || 0));
const short = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(n));
const RES = { blackjack: ['Blackjack!', 'win'], win: ['Win', 'win'], push: ['Push', 'push'], lose: ['Lose', 'lose'], bust: ['Bust', 'lose'] };
const MOVE = { H: 'Hit', S: 'Stand', D: 'Double', Ds: 'Double', P: 'Split' };
let coach = store.get('bj.coach') !== false, counter = store.get('bj.count') === true;
let turnKey = '', turnSeen = 0;                                    // when this device first saw the current turn

function total(cards, hand, final) {
  const faces = cards.filter((x) => x.c).map((x) => x.c);
  if (!faces.length) return null;
  const v = value(faces);
  const bj = hand && faces.length === 2 && cards.length === 2 && v.total === 21 && !hand.split;
  return { n: v.total, text: bj ? 'BJ' : v.soft && v.total < 21 && !final ? `${v.total - 10}/${v.total}` : String(v.total), cls: v.total > 21 ? ' bust' : bj ? ' good' : '' };
}
function advice(c, hand, me) {
  const up = c.state.dealer[0] && c.state.dealer[0].c;
  if (!up) return null;
  const shape = { cards: hand.cards.map((x) => x.c), split: hand.split, splitAces: hand.splitAces };
  let m = basicStrategy(shape, up, me.hands.length);
  if ((m === 'D' || m === 'Ds' || m === 'P') && hand.bet > me.bank) m = m === 'Ds' ? 'S' : 'H';
  return MOVE[m];
}
function stalled(s) {
  const k = s.phase + ':' + (s.turn ? s.turn.id + s.turn.hand : '') + ':' + s.turnAt;
  if (k !== turnKey) { turnKey = k; turnSeen = Date.now(); }
  return Date.now() - turnSeen > (s.phase === 'insurance' ? s.insIdleMs : s.idleMs) + 1000;
}

function felt(c) {
  const s = c.state, n = c.view.players.length, settled = s.phase === 'bet' && c.revealed;
  const dealer = keyed(s, s.dealer), dt = total(dealer.filter(c.landed), null, s.phase === 'bet');
  const arc = h('div', { class: 'arcText' });
  arc.innerHTML = '<svg viewBox="0 0 360 120"><defs><path id="a1" d="M70 14 Q180 92 290 14"/><path id="a2" d="M84 40 Q180 108 276 40"/></defs>' +
    '<text font-size="13" font-weight="700"><textPath href="#a1" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>' +
    '<text font-size="8.5"><textPath href="#a2" startOffset="50%" text-anchor="middle">Dealer stands on all 17s · Insurance pays 2 to 1</textPath></text></svg>';
  const out = [...shoeBits(s), counter && s.count !== null && s.count !== undefined ? h('div', { class: 'countPill' }, `Count ${s.count > 0 ? '+' : ''}${s.count} · true ${(s.count / Math.max(0.5, s.shoe.left / 52)).toFixed(1)}`) : null,
    h('div', { class: 'bjDealer zone' }, h('div', { class: 'dealerTag' }, 'DEALER'),
      h('div', { class: 'cardsRow', style: '--cw:44px;--ch:62px' }, dealer.map((x) => c.cardEl(x))),
      h('div', { class: 'total' + (dt ? dt.cls : ''), style: dt ? '' : 'visibility:hidden' }, dt ? dt.text : '0')), arc];
  const H = document.getElementById('felt').clientHeight || 374;
  c.view.players.forEach((p, i) => {
    const live = s.players.find((x) => x.id === p.id), t = (i + 0.5) / n, x = 50 - 41 * Math.cos(Math.PI * t), R = H * 0.46, y = H - R + R * Math.sin(Math.PI * t) - 10;
    const myTurn = s.phase === 'play' && s.turn && s.turn.id === p.id;
    const amt = s.phase === 'bet' ? p.bet : live.hands.reduce((a, b) => a + b.bet, 0);
    const seat = h('div', { class: 'seat' + (p.id === c.myId ? ' me' : '') + (myTurn ? ' turn' : ''), style: `left:${x}%;top:${y}px` });
    const hands = h('div', { class: 'hands' }, live.hands.flatMap((hd) => {
      const cards = keyed(s, hd.cards), tt = total(cards.filter(c.landed), hd, hd.done), r = settled && hd.result && RES[hd.result];
      return [h('div', { class: 'cardsRow' }, cards.map((k) => c.cardEl(k, { small: true }))),
        r ? h('div', { class: 'res ' + r[1] }, r[0]) : tt && h('div', { class: 'tot' + tt.cls }, tt.text)];
    }));
    seat.append(hands, h('button', { class: 'bspot' + (amt ? ' has' : ''), 'aria-label': `${p.name} bet`, on: { click: () => { if (p.id === c.myId && s.phase === 'bet') c.bet(); } } }, amt ? short(amt) : ''),
      h('div', { class: 'nm' }, p.name));
    out.push(seat);
  });
  return out;
}

function hand(c) {
  const s = c.state, me = c.me;
  if (s.phase === 'bet' || !me.hands.length) {
    const sitting = s.phase !== 'bet';
    return [h('div', { class: 'betPad' },
      h('button', { class: 'betCircle' + (me.bet ? ' has' : ''), disabled: sitting, on: { click: () => c.bet() } }, me.bet ? money(me.bet) : sitting ? 'Next hand' : 'Tap to bet'),
      h('div', { class: 'note' }, sitting ? 'You are sitting this hand out.' : `Pick a chip, tap the circle, then Deal · $${s.min}–$${s.max.toLocaleString('en-US')}`))];
  }
  const mine = s.turn && s.turn.id === c.myId;
  const els = [h('div', { class: 'myHands' }, me.hands.map((hd, i) => {
    const cards = keyed(s, hd.cards), tt = total(cards.filter(c.landed), hd, hd.done);
    return h('div', { class: 'myHand' + (mine && s.turn.hand === i ? ' on' : '') },
      h('div', { class: 'cardsRow' }, cards.map((k) => c.cardEl(k))),
      h('div', { class: 'total' + (tt ? tt.cls : '') }, tt ? tt.text : '…'),
      h('div', { class: 'meta' }, `Bet ${money(hd.bet)}${hd.doubled ? ' · doubled' : ''}`));
  }))];
  let tip = '';
  if (s.phase === 'insurance') tip = me.insurance === null ? (coach ? 'Coach: skip insurance. It carries a 7.4% house edge.' : '') : me.insurance ? `Insured for ${money(me.insurance)}` : 'No insurance';
  else if (mine && coach) { const a = advice(c, me.hands[s.turn.hand], me); if (a) tip = `Coach: basic strategy says ${a}`; }
  els.push(h('div', { class: 'hintLine' }, tip));
  return els;
}

function actions(c) {
  const s = c.state, me = c.me, send = c.send, B = (text, msg, o = {}) => ({ text, do: () => send(msg), ...o });
  if (s.phase === 'bet') {
    const any = s.players.some((p) => p.bet > 0);
    return { chips: true, buttons: [
      B('Clear', { t: 'clear' }, { disabled: !me.bet }),
      B(me.canRepeat ? 'Rebet' : 'Rebet', { t: 'repeat' }, { disabled: !me.canRepeat || !!me.bet }),
      B(!c.revealed ? 'Dealer playing…' : any ? 'DEAL' : 'Bet to deal', { t: 'deal' }, { cls: 'primary', disabled: !any || !c.revealed })] };
  }
  const late = stalled(s);
  if (s.phase === 'insurance') {
    if (me.hands.length && me.insurance === null) {
      const cost = Math.floor(me.hands[0].bet / 2);
      return { chips: false, buttons: [B('No insurance', { t: 'insure', on: false }, { cls: 'big' }), B(`Insure ${money(cost)}`, { t: 'insure', on: true }, { cls: 'big', disabled: cost > me.bank || !cost })] };
    }
    return { chips: false, buttons: [late ? B('Close insurance', { t: 'skipins' }, { cls: 'big' }) : B('Waiting on insurance…', null, { disabled: true, cls: 'big' })] };
  }
  const owner = s.turn && s.players.find((p) => p.id === s.turn.id);
  if (owner && owner.id === c.myId) {
    const hd = me.hands[s.turn.hand], shape = { cards: hd.cards.map((x) => x.c), split: hd.split, splitAces: hd.splitAces }, afford = hd.bet <= me.bank;
    return { chips: false, buttons: [
      B('Hit', { t: 'hit' }, { cls: 'big', disabled: !!hd.splitAces }), B('Stand', { t: 'stand' }, { cls: 'big' }),
      B('Double', { t: 'double' }, { cls: 'big', disabled: !canDouble(shape) || !afford }),
      B('Split', { t: 'split' }, { cls: 'big', disabled: !canSplit(shape, me.hands.length) || !afford })] };
  }
  if (owner && (late || !owner.connected)) return { chips: false, buttons: [B(`Stand for ${owner.name}`, { t: 'stand' }, { cls: 'big' })] };
  return { chips: false, buttons: [B(owner ? `${owner.name} to act…` : 'Dealer playing…', null, { disabled: true, cls: 'big' })] };
}

function header(c) {
  const s = c.state, res = c.revealed && s.phase === 'bet' ? s.last && s.last.results[c.myId] : null;
  const owner = s.turn && s.players.find((p) => p.id === s.turn.id);
  if (s.phase === 'insurance') return { phase: [h('b', null, 'Insurance?')], call: 'Dealer shows an ace' };
  if (s.phase === 'play') return { phase: [h('b', null, owner && owner.id === c.myId ? 'Your turn' : owner ? `${owner.name}'s turn` : 'Dealer')], call: owner && owner.id === c.myId ? 'Hit, stand, double or split' : '' };
  if (!c.revealed) return { phase: [h('b', null, 'Dealer plays')], call: '' };
  return { phase: [h('b', null, 'Place your bets'), ` · hand ${s.n + 1}`], call: s.last ? s.last.call : 'Welcome to the table',
    mine: res ? (res.net > 0 ? `You won ${money(res.net)}` : res.net < 0 ? `You lost ${money(-res.net)}` : 'Push: your bet comes back') : '', mineClass: res ? (res.net > 0 ? 'pos' : res.net < 0 ? 'neg' : '') : '' };
}

function guide(tab, state) {
  const { T, P, H, UL, Q } = G, d = h('div', { class: 'guide' });
  if (tab === 'basics') d.append(
    P('Get closer to 21 than the dealer without going over. Face cards count 10, aces count 1 or 11.'),
    H('A hand, step by step'), UL(['Everyone bets, then anyone taps Deal.', 'You get two cards face up. The dealer gets one up and one face down.', 'Each player acts in seat order: hit, stand, double or split.', 'The dealer turns the hole card and draws to 17 or more.', 'Beat the dealer and you are paid 1 to 1. A two-card 21 pays 3 to 2.']),
    H('Table rules'), T([['Decks', state.shoe.mode === 'shoe' ? '6, dealt down to the cut card at 75%' : '6, a fresh shuffle every hand'], ['Dealer', 'Stands on all 17s'], ['Blackjack', 'Pays 3 to 2'], ['Double', 'Any first two cards, also after a split'], ['Split', 'Up to 4 hands; split aces get one card each'], ['Insurance', 'Half your bet, pays 2 to 1'], ['Surrender', 'Not offered']]),
    P('With perfect basic strategy the house edge is about 0.5%.'));
  else if (tab === 'plays') d.append(
    H('Your four moves'), T([['Hit', 'Take another card'], ['Stand', 'Keep what you have'], ['Double', 'Double the bet, take exactly one card'], ['Split', 'A pair becomes two hands, each with its own bet']]),
    H('Basic strategy in one screen'), T([['17 or more', 'Stand'], ['13 to 16', 'Stand vs dealer 2–6, else hit'], ['12', 'Stand vs 4–6, else hit'], ['11', 'Double (hit vs an ace)'], ['10', 'Double vs 2–9'], ['9', 'Double vs 3–6'], ['8 or less', 'Hit'], ['Soft 19+', 'Stand'], ['Soft 18', 'Double vs 3–6, stand vs 2, 7, 8, hit vs 9–A'], ['Soft 13–17', 'Double vs 5–6 (17: 3–6), else hit'], ['A-A, 8-8', 'Always split'], ['10-10, 5-5', 'Never split'], ['2s, 3s, 7s', 'Split vs 2–7'], ['6s', 'Split vs 2–6'], ['9s', 'Split vs 2–9 except 7'], ['4s', 'Split vs 5–6']]),
    P('Turn on the Coach in the menu and the table shows this advice on your turn.'));
  else d.append(
    Q('Is insurance worth it?', 'No. It is a side bet that the hole card is a ten, with a 7.4% house edge.'),
    Q('Why did my 21 after a split only pay 1 to 1?', 'Only a two-card 21 on your original hand is a blackjack. After a split it is a normal 21.'),
    Q('What if someone walks away mid-hand?', 'After 25 seconds anyone can stand that hand so the table keeps moving.'),
    state.shoe.mode === 'shoe' ? Q('Can I count cards here?', 'Yes. This table deals one six-deck shoe down to the cut card (about 75%). Turn on the count trainer in the menu to see the Hi-Lo running and true count.') : Q('Can I count cards here?', 'Not at this table: the shoe is reshuffled every hand. Open a table with “Shoe plays out” to practise counting.'),
    Q('How do I know the shuffle is honest?', 'Menu → Provably fair. The shoe comes from a seed committed before the deal, and you can re-check every card.'));
  return d;
}

start({
  game: 'blackjack', title: 'Blackjack', noun: 'hand', feltClass: 'bj', gap: 330,
  cardsOf: (s) => keyed(s, [...s.dealer, ...s.players.flatMap((p) => p.hands.flatMap((x) => x.cards))]),
  resultFor: (s, id) => (s.phase === 'bet' && s.last ? s.last.results[id] || null : null),
  onTable: (p, s) => p.bet + inPlay(p, s),
  isTurn: (s, id) => s.phase === 'play' && !!s.turn && s.turn.id === id,
  ticks: (s) => s.phase !== 'bet',
  betLines: (p, s) => (s.phase === 'bet' ? (p.bet ? [`Bet ${money(p.bet)}`] : ['No bet yet']) : p.hands.map((x, i) => `Hand ${i + 1}: ${money(x.bet)}`).concat(p.insurance ? [`Insurance ${money(p.insurance)}`] : [])),
  menu: (c, rerender) => [h('div', { class: 'tog' }, h('span', null, 'Coach: show basic strategy on my turn'),
    h('button', { class: 'sw' + (coach ? ' on' : ''), 'aria-label': 'Toggle coach', on: { click: () => { coach = !coach; store.set('bj.coach', coach); c.rerender(); } } })),
    c.state.shoe.mode === 'shoe' ? h('div', { class: 'tog' }, h('span', null, 'Count trainer: show the Hi-Lo count'),
      h('button', { class: 'sw' + (counter ? ' on' : ''), 'aria-label': 'Toggle count trainer', on: { click: () => { counter = !counter; store.set('bj.count', counter); c.rerender(); } } })) : null],
  header, felt, hand, actions, guide, guideTabs: [['basics', 'The game'], ['plays', 'Moves & strategy'], ['faq', 'FAQ']],
});
