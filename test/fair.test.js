import test from 'node:test';
import assert from 'node:assert/strict';
import { diceFromBytes, pocketFromBytes, verifyEpoch, combine } from '../shared/fair.js';
import { WHEELS } from '../shared/roulette.js';
import { Fair, sha256hex, hmac } from '../src/fair.js';
import { Table } from '../src/table.js';
import { RouletteTable } from '../src/roulette-table.js';

const crypto = { sha256hex, hmac };

test('byte mapping is exactly uniform', () => {
  const faces = Array(7).fill(0);
  for (let b = 0; b < 256; b++) { const d = diceFromBytes([b, b]); if (d) faces[d[0]]++; }
  assert.deepEqual(faces.slice(1), Array(6).fill(42));            // 252 usable byte values, 42 per face
  assert.equal(diceFromBytes([255, 252, 253]), null);
  assert.deepEqual(diceFromBytes([255, 0, 254, 11]), [1, 6]);     // rejected bytes are skipped
  assert.equal(pocketFromBytes([0, 0, 0, 5], WHEELS.european), WHEELS.european[5]);
  assert.equal(pocketFromBytes([255, 255, 255, 255, 0, 0, 0, 37], WHEELS.european), WHEELS.european[0]);   // first word rejected
});

test('a revealed epoch verifies, and any tampering is caught', async () => {
  const f = new Fair('craps');
  const committed = f.hash;
  f.setSeed('a', 'alice-seed'); f.setSeed('b', 'bob-seed');
  const rolls = []; for (let i = 0; i < 25; i++) rolls.push(f.draw());
  assert.equal(f.epochData(1).serverSeed, null);                  // never exposed while live
  assert.equal(f.rotate(), null);
  const e = f.epochData(1);
  assert.equal(e.hash, committed);
  assert.deepEqual(await verifyEpoch(e, crypto, WHEELS), { hashOk: true, seedsOk: true, checked: 25, bad: [] });
  assert.deepEqual(e.combos[e.rolls[0].cs], ['alice-seed', 'bob-seed']);
  assert.equal(e.rolls[0].out, rolls[0].join('-'));

  const changedRoll = structuredClone(e); changedRoll.rolls[3].out = changedRoll.rolls[3].out === '1-1' ? '6-6' : '1-1';
  assert.deepEqual((await verifyEpoch(changedRoll, crypto, WHEELS)).bad, [4]);
  const swappedSeed = { ...e, serverSeed: 'f'.repeat(64) };
  const r = await verifyEpoch(swappedSeed, crypto, WHEELS);
  assert.equal(r.hashOk, false); assert.ok(r.bad.length > 20);
  const fakeSeeds = structuredClone(e); fakeSeeds.combos[e.rolls[0].cs] = ['alice-seed', 'mallory'];
  assert.equal((await verifyEpoch(fakeSeeds, crypto, WHEELS)).seedsOk, false);
});

test('player seeds change the outcome, and are cleared at each new commitment', () => {
  const f = new Fair('european');
  f.setSeed('a', 'one');
  const cs1 = (f.draw(), f.rolls[0].cs);
  f.setSeed('a', 'two');
  f.draw();
  assert.notEqual(f.rolls[1].cs, cs1);
  assert.equal(cs1, sha256hex(combine(['one'])));
  assert.match(f.setSeed('a', 'has spaces'), /letters/);
  f.rotate();
  assert.deepEqual(f.public().seeded, []);
  assert.equal(f.public().past[0].rolls, 2);
  assert.match(f.rotate(), /No rolls/);
});

test('dice are unbiased over many draws', () => {
  const f = new Fair('craps'), totals = Array(13).fill(0), N = 36000;
  for (let i = 0; i < N; i++) { const [a, b] = f.draw(); totals[a + b]++; }
  let x = 0;
  for (let t = 2; t <= 12; t++) { const e = ((6 - Math.abs(7 - t)) / 36) * N; x += (totals[t] - e) ** 2 / e; }
  assert.ok(x < 35, `chi-square ${x.toFixed(1)} on 10 df`);       // p < 0.0001 would be about 35
});

test('tables: craps retires the seed on a seven-out, roulette every 10 spins', async () => {
  const t = new Table('FAIR');
  const a = t.addPlayer('Ann').player;
  assert.equal(t.act(a, { t: 'seed', seed: 'ann-1' }), null);
  assert.match(t.act(a, { t: 'reveal' }), /No rolls/);
  let guard = 0;
  while (t.fair.past.length === 0 && guard++ < 500) {
    if (a.bank < 100) a.bank += 1000;
    if (t.point === 0 && !a.bets.pass) t.act(a, { t: 'bet', key: 'pass', amt: 5 });
    assert.equal(t.act(a, { t: 'roll' }), null);
  }
  const e = t.fair.epochData(1);
  assert.equal(e.rolls.at(-1).out.split('-').reduce((s, v) => s + +v, 0), 7);   // the hand ended on a seven
  assert.equal(e.rolls.length, t.n);
  const v = await verifyEpoch(e, crypto, WHEELS);
  assert.ok(v.hashOk && v.seedsOk && v.bad.length === 0);
  assert.equal(t.snapshot().fair.epoch, 2);
  assert.equal(JSON.stringify(t.snapshot()).includes(t.fair.serverSeed), false);   // the live seed never leaves the server

  const r = new RouletteTable('FAIR', { wheel: 'american' });
  const b = r.addPlayer('Bob').player;
  for (let i = 0; i < 10; i++) { r.spinAt = 0; r.act(b, { t: 'bet', key: 'red', amt: 5 }); assert.equal(r.act(b, { t: 'spin' }), null); }
  assert.equal(r.fair.past.length, 1);
  const rv = await verifyEpoch(r.fair.epochData(1), crypto, WHEELS);
  assert.ok(rv.hashOk && rv.bad.length === 0 && rv.checked === 10);
});
