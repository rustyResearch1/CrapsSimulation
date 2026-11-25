import test from 'node:test';
import assert from 'node:assert/strict';
import { freshShoe, cardsFromBytes } from '../shared/cards.js';
import * as bj from '../shared/blackjack.js';
import * as bac from '../shared/baccarat.js';
import { verifyEpoch } from '../shared/fair.js';
import { WHEELS } from '../shared/roulette.js';
import { sha256hex, hmac } from '../src/fair.js';
import { BlackjackTable } from '../src/blackjack-table.js';
import { BaccaratTable } from '../src/baccarat-table.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A draw() over freshly shuffled shoes, for simulations. */
function shuffler(decks, rng) {
  let shoe = [];
  return { fresh() { shoe = freshShoe(decks); }, draw() { return shoe.splice(Math.floor(rng() * shoe.length), 1)[0]; } };
}

test('shoe: right size, no card dealt twice, later bytes never change earlier cards', () => {
  assert.equal(freshShoe(6).length, 312);
  const bytes = Uint8Array.from({ length: 4 * 320 }, (_, i) => (i * 97 + 13) % 256);
  const all = cardsFromBytes(bytes, 6, 312);
  const count = {}; for (const c of all) count[c] = (count[c] || 0) + 1;
  assert.ok(Object.values(count).every((n) => n <= 6));
  assert.deepEqual(cardsFromBytes(bytes.slice(0, 40), 6, 5), all.slice(0, 5));
});

test('blackjack: hand values and settlement', () => {
  assert.deepEqual(bj.value(['AS', '6H']), { total: 17, soft: true });
  assert.deepEqual(bj.value(['AS', '6H', 'TD']), { total: 17, soft: false });
  assert.deepEqual(bj.value(['AS', 'AH', '9D']), { total: 21, soft: true });
  assert.equal(bj.dealerHits(['AS', '6H']), false);                                  // stands on soft 17
  assert.deepEqual(bj.settleHand({ cards: ['AS', 'KH'], bet: 10 }, ['TD', '9C']), { result: 'blackjack', profit: 15 });
  assert.deepEqual(bj.settleHand({ cards: ['AS', 'KH'], bet: 5 }, ['TD', '9C']), { result: 'blackjack', profit: 7 });
  assert.equal(bj.settleHand({ cards: ['AS', 'KH'], bet: 10 }, ['AD', 'QC']).result, 'push');
  assert.equal(bj.settleHand({ cards: ['AS', 'KH'], bet: 10, split: true }, ['TD', '9C']).profit, 10);   // 21 after a split is not a natural
  assert.equal(bj.settleHand({ cards: ['TS', '9H'], bet: 10 }, ['AD', 'QC']).profit, -10);
  assert.equal(bj.settleHand({ cards: ['TS', '6H', '8D'], bet: 10 }, ['TD', '6C', '9S']).result, 'bust');   // player busts first
  assert.equal(bj.settleHand({ cards: ['TS', '8H'], bet: 10 }, ['TD', '6C', '9S']).profit, 10);
  assert.equal(bj.settleHand({ cards: ['TS', '8H'], bet: 10 }, ['TD', '8C']).result, 'push');
  assert.equal(bj.basicStrategy({ cards: ['8S', '8H'] }, 'TD'), 'P');
  assert.equal(bj.basicStrategy({ cards: ['TS', '6H'] }, 'TD'), 'H');
  assert.equal(bj.basicStrategy({ cards: ['6S', '5H'] }, '6D'), 'D');
  assert.equal(bj.basicStrategy({ cards: ['TS', '2H'] }, '5D'), 'S');
});

test('blackjack: basic strategy costs about half a percent', () => {
  const rng = seeded(7), sh = shuffler(6, rng), N = 250000;
  let wagered = 0, net = 0;
  for (let i = 0; i < N; i++) {
    sh.fresh();
    const hands = [{ cards: [sh.draw(), sh.draw()], bet: 10 }], dealer = [sh.draw(), sh.draw()];
    if (bj.value(dealer).total === 21) { const r = bj.settleHand(hands[0], dealer); wagered += 10; net += r.profit; continue; }
    for (let k = 0; k < hands.length; k++) {
      const h = hands[k];
      while (!h.done) {
        if (bj.value(h.cards).total >= 21 || h.splitAces) break;
        const m = bj.basicStrategy(h, dealer[0], hands.length);
        if (m === 'P') {
          const aces = h.cards[0][0] === 'A', other = { cards: [h.cards.pop(), sh.draw()], bet: h.bet, split: true, splitAces: aces };
          h.split = true; h.splitAces = aces; h.cards.push(sh.draw()); hands.splice(k + 1, 0, other);
        } else if (m === 'D') { h.bet *= 2; h.cards.push(sh.draw()); h.done = true; }
        else if (m === 'H') h.cards.push(sh.draw());
        else h.done = true;
      }
    }
    if (hands.some((h) => !bj.isBust(h.cards) && !bj.isBlackjack(h))) while (bj.dealerHits(dealer)) dealer.push(sh.draw());
    wagered += 10;
    for (const h of hands) net += bj.settleHand(h, dealer).profit;
  }
  near((-net / wagered) * 100, 0.5, 0.75, 'house edge per initial bet, %');
});

test('baccarat: third-card rules', () => {
  const deal = (list) => { const q = [...list]; return bac.playOut(() => q.shift()); };
  assert.equal(deal(['4S', '5H', '4D', '2C', 'KS']).player.length, 2);                   // natural 8 stops everything
  let r = deal(['2S', '3H', '3D', 'KC', '8S', '9H']);                                    // player 5 draws an 8; banker 3 stands against an 8
  assert.equal(r.player.length, 3); assert.equal(r.banker.length, 2);
  r = deal(['2S', '3H', '3D', 'KC', '7S', '9H']);                                        // banker 3 draws against a 7
  assert.equal(r.banker.length, 3);
  r = deal(['3S', '2H', '4D', '3C', '9H']);                                              // player 7 stands; banker 5 draws
  assert.equal(r.player.length, 2); assert.equal(r.banker.length, 3);
  r = deal(['2S', '6H', '2D', 'KC', '5S', '9H']);                                        // banker 6 stands against a 5
  assert.equal(r.banker.length, 2);
  assert.deepEqual(bac.outcome(['9S', '9H'], ['KD', '7C']), { winner: 'player', pTotal: 8, bTotal: 7, pPair: true, bPair: false });
  const res = bac.resolve({ banker: 100, tie: 10, ppair: 5 }, { winner: 'banker', pPair: true, bPair: false });
  assert.equal(res.net, 95 - 10 + 55);
  assert.equal(bac.resolve({ player: 50, banker: 20 }, { winner: 'tie' }).net, 0);
  assert.equal(bac.resolve({ banker: 5 }, { winner: 'banker' }).net, 4);                 // 4.75 rounds down
});

test('baccarat: outcome frequencies and edges match the published 8-deck figures', () => {
  const rng = seeded(11), sh = shuffler(8, rng), N = 400000, n = { player: 0, banker: 0, tie: 0, pair: 0 };
  for (let i = 0; i < N; i++) { sh.fresh(); const d = bac.playOut(() => sh.draw()), o = bac.outcome(d.player, d.banker); n[o.winner]++; if (o.pPair) n.pair++; }
  near(n.banker / N, bac.PROB.banker, 0.004, 'banker'); near(n.player / N, bac.PROB.player, 0.004, 'player');
  near(n.tie / N, bac.PROB.tie, 0.003, 'tie'); near(n.pair / N, bac.PROB.pair, 0.003, 'pair');
  near(bac.PROB.player - bac.PROB.banker * 0.95, bac.EDGE.banker, 1e-4, 'banker edge');
  near(bac.PROB.banker - bac.PROB.player, bac.EDGE.player, 1e-4, 'player edge');
  near(1 - 9 * bac.PROB.tie, bac.EDGE.tie, 1e-4, 'tie edge');
});

test('blackjack table: full hand with split, double, insurance and turn order', () => {
  // deal order: Ann, Bob, dealer up, Ann, Bob, dealer hole, then draws
  const t = new BlackjackTable('BJ', { cards: ['8S', 'TH', '6D', '8H', '9C', 'TD', '3S', 'TC', 'KS', '5H'] });
  const a = t.addPlayer('Ann').player, b = t.addPlayer('Bob').player;
  assert.match(t.act(a, { t: 'deal' }), /Place a bet/);
  t.act(a, { t: 'bet', amt: 10 }); t.act(b, { t: 'bet', amt: 20 });
  assert.equal(t.act(b, { t: 'deal' }), null);
  assert.equal(t.phase, 'play');
  assert.equal(t.snapshot().dealer[1].c, null);                         // hole card hidden
  assert.match(t.act(b, { t: 'hit' }), /Ann's turn/);
  assert.equal(t.act(a, { t: 'split' }), null);                         // 8,8 -> [8,3] and [8,T]
  assert.equal(a.hands.length, 2); assert.equal(a.bank, 980);
  assert.equal(t.act(a, { t: 'double' }), null);                        // 11 doubles, draws K -> 21
  assert.equal(a.hands[0].bet, 20); assert.equal(a.bank, 970);
  assert.deepEqual(t.turn, { id: a.id, hand: 1 });
  assert.equal(t.act(a, { t: 'stand' }), null);                         // 18
  assert.equal(t.turn.id, b.id);
  assert.equal(t.act(b, { t: 'stand' }), null);                         // 19; dealer 16 draws 5 -> 21
  assert.equal(t.phase, 'bet');
  assert.equal(t.last.dealerTotal, 21);
  assert.equal(a.bank, 970 + 20);                                       // doubled 21 pushes, 18 loses
  assert.equal(b.bank, 980);
  assert.equal(t.snapshot().dealer[1].c, 'TD');
  assert.equal(t.act(b, { t: 'repeat' }), null); assert.equal(b.bet, 20);

  const u = new BlackjackTable('BJ', { cards: ['TS', 'AD', '9H', 'KC'] });  // dealer shows an ace and has blackjack
  const c = u.addPlayer('Cy').player;
  u.act(c, { t: 'bet', amt: 20 }); u.act(c, { t: 'deal' });
  assert.equal(u.phase, 'insurance');
  assert.match(u.act(c, { t: 'hit' }), /not time/);
  assert.equal(u.act(c, { t: 'insure', on: true }), null);
  assert.equal(u.phase, 'bet');
  assert.equal(c.bank, 1000);                                            // lost 20, insurance of 10 paid 20
  assert.equal(u.last.results[c.id].net, 0);
});

test('card tables: fair shoes verify, the hole card never leaks, chips are conserved', async () => {
  const t = new BlackjackTable('BJ');
  const a = t.addPlayer('Ann').player, b = t.addPlayer('Bob').player;
  for (let i = 0; i < 40; i++) {
    for (const p of [a, b]) { if (p.bank < 100) p.bank += 1000; t.act(p, { t: 'bet', amt: 10 }); }
    assert.equal(t.act(a, { t: 'deal' }), null);
    let guard = 0;
    while (t.phase !== 'bet' && guard++ < 60) {
      if (t.phase === 'insurance') { t.act(a, { t: 'insure', on: false }); t.act(b, { t: 'insure', on: i % 2 === 0 }); continue; }
      const owner = t.player(t.turn.id), hand = owner.hands[t.turn.hand];
      assert.equal(t.snapshot().dealer[1].c, null, 'hole card is off the wire');
      assert.equal(t.fair.epochData(t.fair.id).rolls.length, t.fair.rolls.length - 1, 'the live round is not in the public roll log');
      const m = { H: 'hit', S: 'stand', D: 'double', P: 'split' }[require_move(hand, t)];
      if (t.act(owner, { t: m })) t.act(owner, { t: 'stand' });
    }
    assert.equal(t.phase, 'bet');
  }
  assert.ok(t.fair.past.length >= 4);
  for (const e of t.fair.past) { const v = await verifyEpoch(e, { sha256hex, hmac }, WHEELS); assert.ok(v.hashOk && v.seedsOk && v.bad.length === 0, 'blackjack shoe verifies'); }

  const c = new BaccaratTable('BA');
  const p = c.addPlayer('Pat').player;
  let net = 0;
  for (let i = 0; i < 25; i++) { c.dealAt = 0; c.act(p, { t: 'bet', key: 'banker', amt: 20 }); c.act(p, { t: 'bet', key: 'tie', amt: 2 }); assert.equal(c.act(p, { t: 'deal' }), null); net += p.lastNet; }
  assert.equal(p.bank, 1000 + net);
  assert.equal(c.history.length, 25);
  const v = await verifyEpoch(c.fair.past[0], { sha256hex, hmac }, WHEELS);
  assert.ok(v.hashOk && v.bad.length === 0 && v.checked === 10, 'baccarat shoe verifies');
  assert.match(c.act(p, { t: 'bet', key: 'dragon', amt: 5 }), /Unknown/);
});
function require_move(hand, t) { return bj.basicStrategy({ cards: hand.cards.map((x) => x.c), split: hand.split, splitAces: hand.splitAces }, t.dealer[0].c, t.player(t.turn.id).hands.length); }
