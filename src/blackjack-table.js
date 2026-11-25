// One blackjack table: up to 8 players against the dealer.
// Phases: 'bet' -> (dealer shows an ace: 'insurance') -> 'play' -> settled, back to 'bet'.
// The last round's cards stay on the felt until the next deal.
import { CardTable } from './card-table.js';
import { DECKS, value, isBust, isBlackjack, dealerHits, canSplit, canDouble, cardValue, settleHand } from '../shared/blackjack.js';

export const TURN_IDLE_MS = 25_000;      // after this, anyone may stand a stalled player's hand
export const INSURANCE_IDLE_MS = 15_000; // after this, anyone may close insurance
const hiLo = (c) => ('23456'.includes(c[0]) ? 1 : 'TJQKA'.includes(c[0]) ? -1 : 0);

export class BlackjackTable extends CardTable {
  constructor(code, opts = {}) {
    super('blackjack', code, { decks: DECKS, ...opts });
    this.phase = 'bet'; this.dealer = []; this.hole = false; this.turn = null; this.turnAt = 0; this.last = null; this.shoe = null; this.running = 0;
  }
  newSeat() { return { bet: 0, lastBet: 0, hands: [], insurance: null }; }
  get inRound() { return this.phase !== 'bet'; }
  card() { const c = this.shoe.next(); this.running += hiLo(c); return { c, q: ++this.seq }; }
  faces(cards) { return cards.map((x) => x.c); }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    this.fair?.dropPlayer(id);
    this.say(`${gone.name} left the table`);
    if (this.phase === 'insurance') this.afterInsurance();
    else if (this.phase === 'play' && this.turn && this.turn.id === id) this.advance();
  }
  /** Chips not yet in play come back; a hand in progress stays where it is. */
  clear(player) { if (!this.inRound) { player.bank += player.bet; player.bet = 0; } return null; }

  act(player, msg) {
    this.touched = Date.now(); player.seenAt = Date.now();
    const c = this.common(player, msg);
    if (c !== undefined) return c;
    switch (msg.t) {
      case 'bet': {
        if (this.inRound) return 'Bets open after this hand';
        if (!Number.isInteger(msg.amt) || msg.amt <= 0) return 'Bad amount';
        if (msg.amt > player.bank) return 'Not enough chips';
        if (player.bet + msg.amt > this.max) return `Table maximum is $${this.max}`;
        player.bet += msg.amt; player.bank -= msg.amt;
        return null;
      }
      case 'remove': case 'clear': {
        if (this.inRound) return 'Bets are locked during the hand';
        const take = msg.t === 'clear' || msg.amt === undefined ? player.bet : Math.min(player.bet, msg.amt);
        if (!Number.isInteger(take) || take <= 0) return 'No bet there';
        player.bet -= take; player.bank += take;
        return null;
      }
      case 'repeat': {
        if (this.inRound) return 'Bets open after this hand';
        if (!player.lastBet || player.bet) return 'No bet to repeat';
        if (player.lastBet > player.bank) return 'Not enough chips';
        player.bet = player.lastBet; player.bank -= player.lastBet;
        return null;
      }
      case 'deal': return this.deal();
      case 'insure': return this.insure(player, !!msg.on);
      case 'skipins': {
        if (this.phase !== 'insurance') return null;
        if (Date.now() - this.turnAt < INSURANCE_IDLE_MS) return 'Waiting for insurance decisions';
        for (const p of this.players) if (p.hands.length && p.insurance === null) p.insurance = 0;
        return this.afterInsurance();
      }
      case 'hit': case 'stand': case 'double': case 'split': return this.move(player, msg.t);
      case 'rebuy': return this.rebuy(player, player.bet + player.hands.reduce((s, h) => s + (this.inRound ? h.bet : 0), 0));
      default: return 'Unknown action';
    }
  }

  deal() {
    if (this.inRound) return 'A hand is in progress';
    const active = this.players.filter((p) => p.bet > 0);
    if (!active.length) return 'Place a bet before dealing';
    const low = active.find((p) => p.bet < this.min);
    if (low) return `${low.name}'s bet is under the $${this.min} minimum`;
    const shoeNo = this.shoeNo;
    this.shoe = this.openShoe();
    if (this.shoeNo !== shoeNo) this.running = 0;
    this.seq = 0; this.last = null;
    for (const p of this.players) { p.hands = []; p.insurance = null; p.lastNet = 0; }
    for (const p of active) { p.hands = [{ cards: [], bet: p.bet }]; p.lastBet = p.bet; p.bet = 0; }
    this.dealer = [];
    for (let round = 0; round < 2; round++) { for (const p of active) p.hands[0].cards.push(this.card()); this.dealer.push(this.card()); }
    this.hole = true;
    const up = this.dealer[0].c;
    if (up[0] === 'A') { this.phase = 'insurance'; this.turnAt = Date.now(); return null; }
    if (cardValue(up) === 10 && value(this.faces(this.dealer)).total === 21) return this.settle();   // dealer peeks
    return this.startPlay();
  }

  insure(player, on) {
    if (this.phase !== 'insurance') return 'Insurance is not open';
    if (!player.hands.length || player.insurance !== null) return null;
    const cost = Math.floor(player.hands[0].bet / 2);
    if (on && cost > player.bank) return 'Not enough chips for insurance';
    player.insurance = on ? cost : 0;
    if (on) player.bank -= cost;
    return this.afterInsurance();
  }
  afterInsurance() {
    if (this.phase !== 'insurance' || this.players.some((p) => p.hands.length && p.insurance === null)) return null;
    if (value(this.faces(this.dealer)).total === 21) return this.settle();
    return this.startPlay();
  }

  startPlay() {
    this.phase = 'play';
    for (const p of this.players) for (const h of p.hands) if (isBlackjack({ cards: this.faces(h.cards) })) h.done = true;
    this.turn = null;
    return this.advance();
  }
  /** Move to the next unfinished hand in seat order, or to the dealer. */
  advance() {
    for (const p of this.players) {
      const i = p.hands.findIndex((h) => !h.done);
      if (i >= 0) { this.turn = { id: p.id, hand: i }; this.turnAt = Date.now(); return null; }
    }
    return this.settle();
  }

  move(player, kind) {
    if (this.phase !== 'play' || !this.turn) return 'It is not time to act';
    const owner = this.player(this.turn.id);
    if (player.id !== owner.id) {
      const stalled = !owner.connected || Date.now() - this.turnAt > TURN_IDLE_MS;
      if (!stalled || kind !== 'stand') return `It is ${owner.name}'s turn`;
    }
    const hand = owner.hands[this.turn.hand], faces = this.faces(hand.cards);
    const shape = { cards: faces, split: hand.split, splitAces: hand.splitAces };
    if (kind === 'stand') hand.done = true;
    else if (kind === 'hit') {
      if (hand.splitAces) return 'Split aces get one card each';
      hand.cards.push(this.card());
      if (value(this.faces(hand.cards)).total >= 21) hand.done = true;
    } else if (kind === 'double') {
      if (!canDouble(shape)) return 'Double is only on your first two cards';
      if (hand.bet > owner.bank) return 'Not enough chips to double';
      owner.bank -= hand.bet; hand.bet *= 2; hand.doubled = true;
      hand.cards.push(this.card()); hand.done = true;
    } else if (kind === 'split') {
      if (!canSplit(shape, owner.hands.length)) return 'That hand cannot be split';
      if (hand.bet > owner.bank) return 'Not enough chips to split';
      owner.bank -= hand.bet;
      const aces = faces[0][0] === 'A', second = { cards: [hand.cards.pop()], bet: hand.bet, split: true, splitAces: aces };
      hand.split = true; hand.splitAces = aces;
      hand.cards.push(this.card()); second.cards.push(this.card());
      owner.hands.splice(this.turn.hand + 1, 0, second);
      for (const h of [hand, second]) if (aces || value(this.faces(h.cards)).total === 21) h.done = true;
    }
    this.turnAt = Date.now();
    return hand.done ? this.advance() : null;
  }

  settle() {
    this.hole = false; this.turn = null;
    const live = this.players.some((p) => p.hands.some((h) => !isBust(this.faces(h.cards)) && !isBlackjack({ cards: this.faces(h.cards), split: h.split })));
    if (live) while (dealerHits(this.faces(this.dealer))) this.dealer.push(this.card());
    const dealerFaces = this.faces(this.dealer), d = value(dealerFaces).total, dealerBj = dealerFaces.length === 2 && d === 21;
    this.shoe.close();
    this.n++;

    const results = {}, hands = { n: 0, handle: 0, hold: 0, expected: 0, variance: 0 }, ins = { n: 0, handle: 0, hold: 0, expected: 0, variance: 0 };
    for (const p of this.players) {
      if (!p.hands.length) continue;
      const events = [];
      let net = 0;
      p.hands.forEach((h, i) => {
        const r = settleHand({ cards: this.faces(h.cards), bet: h.bet, split: h.split }, dealerFaces);
        h.result = r.result; h.net = r.profit;
        net += r.profit; p.bank += h.bet + r.profit;
        events.push({ label: p.hands.length > 1 ? `Hand ${i + 1}` : 'Hand', result: r.profit > 0 ? 'win' : r.profit < 0 ? 'lose' : 'push', amount: Math.abs(r.profit), how: r.result });
        // Theory assumes basic strategy: about 0.5% edge and a standard deviation near 1.15 bets per hand.
        hands.n++; hands.handle += h.bet; hands.hold -= r.profit; hands.expected += h.bet * 0.005; hands.variance += h.bet * h.bet * 1.33;
      });
      if (p.insurance) {
        const profit = dealerBj ? p.insurance * 2 : -p.insurance;
        net += profit; if (dealerBj) p.bank += p.insurance * 3;
        events.push({ label: 'Insurance', result: dealerBj ? 'win' : 'lose', amount: Math.abs(profit) });
        ins.n++; ins.handle += p.insurance; ins.hold -= profit; ins.expected += p.insurance * 0.074; ins.variance += p.insurance ** 2 * 1.92;
      }
      p.lastNet = net;
      results[p.id] = { net, events };
    }
    const families = { 'Hands (basic-strategy theory)': hands };
    if (ins.n) families.Insurance = ins;
    this.stats?.round('blackjack', {}, { handle: hands.handle + ins.handle, hold: hands.hold + ins.hold, expected: hands.expected + ins.expected, variance: hands.variance + ins.variance, families });

    const call = dealerBj ? 'Dealer has blackjack' : d > 21 ? `Dealer busts with ${d}` : `Dealer has ${d}`;
    this.say(call);
    this.last = { n: this.n, call, dealerTotal: d, results };
    this.phase = 'bet';
    this.maybeRotate(8);
    return null;
  }

  snapshot() {
    const show = (cards) => cards.map((x) => ({ c: x.c, q: x.q }));
    return {
      ...this.base(), phase: this.phase, turn: this.turn, turnAt: this.turnAt, idleMs: TURN_IDLE_MS, insIdleMs: INSURANCE_IDLE_MS, last: this.last,
      // Hi-Lo running count of the cards everyone has seen this shoe (the face-down hole card is left out)
      count: this.mode === 'shoe' ? this.running - (this.hole && this.dealer[1] ? hiLo(this.dealer[1].c) : 0) : null,
      // The hole card stays face down, and off the wire, until the dealer plays.
      dealer: this.dealer.map((x, i) => (this.hole && i === 1 ? { c: null, q: x.q } : { c: x.c, q: x.q })),
      players: this.players.map((p) => ({
        id: p.id, name: p.name, bank: p.bank, bet: p.bet, connected: p.connected, rebuys: p.rebuys, lastNet: p.lastNet, canRepeat: p.lastBet > 0, insurance: p.insurance,
        hands: p.hands.map((h) => ({ cards: show(h.cards), bet: h.bet, done: !!h.done, doubled: !!h.doubled, split: !!h.split, splitAces: !!h.splitAces, result: h.result || null, net: h.net ?? null })),
      })),
    };
  }
}
