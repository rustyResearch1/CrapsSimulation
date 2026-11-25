import test from 'node:test';
import assert from 'node:assert/strict';
import { score, totals, CATS } from '../shared/yatzy.js';
import { YatzyTable } from '../src/yatzy-table.js';
import { verifyEpoch } from '../shared/fair.js';
import { sha256hex, hmac } from '../src/fair.js';

test('yatzy: box scores', () => {
  assert.equal(score('threes', [3, 3, 3, 2, 1]), 9);
  assert.equal(score('three', [3, 3, 3, 2, 1]), 12);
  assert.equal(score('four', [3, 3, 3, 2, 1]), 0);
  assert.equal(score('four', [6, 6, 6, 6, 1]), 25);
  assert.equal(score('full', [2, 2, 5, 5, 5]), 25);
  assert.equal(score('full', [5, 5, 5, 5, 5]), 0);
  assert.equal(score('small', [1, 2, 3, 4, 4]), 30);
  assert.equal(score('small', [1, 2, 3, 5, 6]), 0);
  assert.equal(score('large', [2, 3, 4, 5, 6]), 40);
  assert.equal(score('large', [1, 2, 3, 4, 6]), 0);
  assert.equal(score('chance', [1, 2, 3, 4, 6]), 16);
  assert.equal(score('yatzy', [4, 4, 4, 4, 4]), 50);
  assert.deepEqual(totals({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, yatzy: 50 }, 1), { upper: 63, bonus: 35, lower: 50, extra: 100, total: 248, filled: 7 });
});

test('yatzy: turn flow, holds, bonus rolls and the end of a game', () => {
  const rolls = [[1, 2, 3, 4, 6, 6], [5, 5, 5, 5, 5, 1], [6, 6, 6, 6, 6, 1], [2, 2, 2, 2, 2, 1], [3, 3, 3, 3, 3, 1]];
  const t = new YatzyTable('TEST', { rolls });
  const a = t.addPlayer('A').player;
  assert.equal(t.phase, 'wait');
  const b = t.addPlayer('B').player;
  assert.equal(t.phase, 'play'); assert.equal(t.turn, a.id);
  assert.equal(t.addPlayer('C').error, 'This Yatzy table already has two players');
  assert.equal(t.act(b, { t: 'roll' }), "It is A's turn");
  assert.equal(t.act(a, { t: 'score', cat: 'chance' }), 'Roll first');
  assert.equal(t.act(a, { t: 'roll' }), null);
  assert.deepEqual(t.dice, [1, 2, 3, 4, 6]); assert.equal(a.bank, 2, 'a 6 on the lucky die banks a bonus roll');
  for (const i of [0, 1, 2, 3]) t.act(a, { t: 'hold', i });
  t.act(a, { t: 'roll' }); assert.deepEqual(t.dice, [1, 2, 3, 4, 5], 'only the free die changed');
  t.act(a, { t: 'roll' }); assert.deepEqual(t.dice, [1, 2, 3, 4, 6]);
  assert.equal(t.used, 3);
  assert.equal(t.act(a, { t: 'roll' }), null, 'a fourth roll spends a banked bonus roll'); assert.equal(a.bank, 1);
  assert.deepEqual(t.dice, [1, 2, 3, 4, 2]);
  assert.equal(t.act(a, { t: 'score', cat: 'small' }), null);
  assert.equal(a.card.small, 30); assert.equal(t.turn, b.id); assert.equal(t.used, 0);
  assert.equal(t.act(a, { t: 'score', cat: 'small' }), "It is B's turn");
  t.act(b, { t: 'roll' }); assert.equal(t.act(b, { t: 'score', cat: 'small' }), null); assert.equal(b.card.small, 0);

  // play the rest out with random dice
  t.fixed = { shift: () => Array.from({ length: 6 }, () => 1 + Math.floor(Math.random() * 6)) };
  for (let guard = 0; t.phase === 'play' && guard < 100; guard++) {
    const p = t.player(t.turn);
    t.act(p, { t: 'roll' });
    assert.equal(t.act(p, { t: 'score', cat: CATS.find((c) => p.card[c] === undefined) }), null);
  }
  assert.equal(t.phase, 'over'); assert.ok(t.winner);
  assert.equal(t.act(a, { t: 'rematch' }), null);
  assert.equal(t.phase, 'play'); assert.equal(t.turn, b.id, 'the other player starts the rematch'); assert.deepEqual(a.card, {});
});

test('yatzy: a second Yatzy is worth 100 extra, and the dice verify from the revealed seed', async () => {
  const t = new YatzyTable('TEST', { rolls: [[4, 4, 4, 4, 4, 1], [4, 4, 4, 4, 4, 1]] });
  const a = t.addPlayer('A').player;
  t.act(a, { t: 'start' });
  t.act(a, { t: 'roll' }); t.act(a, { t: 'score', cat: 'yatzy' });
  t.act(a, { t: 'roll' }); t.act(a, { t: 'score', cat: 'fours' });
  assert.equal(a.extra, 1); assert.equal(totals(a.card, a.extra).total, 50 + 20 + 100);

  const live = new YatzyTable('FAIR');
  const p = live.addPlayer('A').player;
  live.act(p, { t: 'seed', seed: 'hello' }); live.act(p, { t: 'start' });
  for (let i = 0; i < 4; i++) { live.act(p, { t: 'roll' }); live.act(p, { t: 'roll' }); live.act(p, { t: 'score', cat: CATS[i] }); }
  assert.equal(live.act(p, { t: 'reveal' }), null);
  const epoch = live.fair.epochData(1);
  for (const r of epoch.rolls) assert.match(r.out, /^[1-6]{6}$/);
  const crypto = { sha256hex, hmac };
  const v = await verifyEpoch(epoch, crypto, {});
  assert.deepEqual([v.hashOk, v.seedsOk, v.checked, v.bad.length], [true, true, 8, 0]);
});
