import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, checkPlace, takeDown, nextPoint, parseKey } from '../src/engine.js';
import { Table } from '../src/table.js';

const ctx = (point) => ({ point, min: 5, max: 5000 });

test('pass line: come-out and point', () => {
  assert.equal(resolve(0, 3, 4, { pass: 10 }).net, 10);
  assert.equal(resolve(0, 5, 6, { pass: 10 }).net, 10);
  assert.equal(resolve(0, 1, 1, { pass: 10 }).net, -10);
  assert.deepEqual(resolve(0, 2, 2, { pass: 10 }).bets, { pass: 10 });
  const made = resolve(6, 3, 3, { pass: 10, passOdds: 50 });
  assert.equal(made.net, 10 + 60);
  assert.equal(made.returned, 10 + 50 + 60);
  assert.deepEqual(made.bets, { pass: 10 });
  assert.equal(resolve(6, 3, 4, { pass: 10, passOdds: 50 }).net, -60);
});

test("don't pass: bar 12, lay odds", () => {
  assert.equal(resolve(0, 6, 6, { dp: 10 }).net, 0);
  assert.deepEqual(resolve(0, 6, 6, { dp: 10 }).bets, { dp: 10 });
  assert.equal(resolve(0, 1, 2, { dp: 10 }).net, 10);
  assert.equal(resolve(0, 3, 4, { dp: 10 }).net, -10);
  assert.equal(resolve(4, 3, 4, { dp: 10, dpOdds: 60 }).net, 10 + 30);
  assert.equal(resolve(4, 2, 2, { dp: 10, dpOdds: 60 }).net, -70);
});

test('come bets travel, win with odds, and odds are off on the come-out', () => {
  const moved = resolve(6, 4, 5, { come: 10 });
  assert.deepEqual(moved.bets, { 'come:9': 10 });
  assert.equal(moved.net, 0);
  assert.equal(resolve(6, 4, 5, { 'come:9': 10, 'comeOdds:9': 40 }).net, 10 + 60);
  // come-out seven: flat loses, odds come back
  const co7 = resolve(0, 3, 4, { 'come:9': 10, 'comeOdds:9': 40 });
  assert.equal(co7.net, -10);
  assert.equal(co7.returned, 40);
  assert.equal(resolve(0, 3, 4, { 'come:9': 10, 'comeOdds:9': 40 }, true).net, -50);
  // a winning come number frees the spot for the bet in the box
  const both = resolve(6, 4, 5, { come: 10, 'come:9': 10 });
  assert.deepEqual(both.bets, { 'come:9': 10 });
  assert.equal(both.net, 10);
});

test("don't come", () => {
  assert.deepEqual(resolve(6, 2, 2, { dc: 10 }).bets, { 'dc:4': 10 });
  assert.equal(resolve(6, 3, 4, { 'dc:4': 10, 'dcOdds:4': 20 }).net, 20);
  assert.equal(resolve(6, 6, 6, { dc: 10 }).net, 0);
  assert.equal(resolve(6, 5, 6, { dc: 10 }).net, -10);
});

test('place, buy, lay payouts', () => {
  assert.equal(resolve(4, 3, 3, { 'place:6': 12 }).net, 14);
  assert.equal(resolve(6, 1, 4, { 'place:5': 10 }).net, 14);
  assert.equal(resolve(6, 1, 3, { 'place:4': 10 }).net, 18);
  assert.equal(resolve(6, 1, 3, { 'buy:4': 20 }).net, 40 - 1);
  assert.equal(resolve(6, 3, 4, { 'lay:4': 40 }).net, 20 - 1);
  assert.equal(resolve(6, 3, 4, { 'place:6': 12, 'buy:4': 20 }).net, -32);
  // off on the come-out unless working
  assert.equal(resolve(0, 3, 4, { 'place:6': 12 }).net, 0);
  assert.equal(resolve(0, 3, 4, { 'place:6': 12 }, true).net, -12);
});

test('field, hardways, props', () => {
  assert.equal(resolve(6, 1, 1, { field: 5 }).net, 10);
  assert.equal(resolve(6, 6, 6, { field: 5 }).net, 15);
  assert.equal(resolve(6, 4, 5, { field: 5 }).net, 5);
  assert.equal(resolve(6, 3, 4, { field: 5 }).net, -5);
  assert.equal(resolve(6, 4, 4, { 'hard:8': 5 }).net, 45);
  assert.equal(resolve(6, 2, 2, { 'hard:4': 5 }).net, 35);
  assert.equal(resolve(6, 3, 5, { 'hard:8': 5 }).net, -5);
  assert.equal(resolve(6, 3, 4, { any7: 5 }).net, 20);
  assert.equal(resolve(6, 1, 2, { anyCraps: 5 }).net, 35);
  assert.equal(resolve(6, 1, 1, { two: 1 }).net, 30);
  assert.equal(resolve(6, 5, 6, { eleven: 1 }).net, 15);
  assert.equal(resolve(6, 6, 6, { horn: 4 }).net, 27);
  assert.equal(resolve(6, 1, 2, { horn: 4 }).net, 12);
  assert.equal(resolve(6, 1, 2, { ce: 2 }).net, 6);
  assert.equal(resolve(6, 5, 6, { ce: 2 }).net, 14);
  assert.equal(resolve(6, 3, 4, { world: 5 }).net, 0);
  assert.equal(resolve(6, 2, 4, { 'hop:2-4': 1 }).net, 15);
  assert.equal(resolve(6, 3, 3, { 'hop:3-3': 1 }).net, 30);
  assert.equal(resolve(6, 3, 3, { 'hop:2-4': 1 }).net, -1);
});

test('placement rules', () => {
  assert.equal(checkPlace(ctx(0), {}, 'pass', 10), null);
  assert.match(checkPlace(ctx(6), {}, 'pass', 10), /come-out/);
  assert.match(checkPlace(ctx(0), {}, 'come', 10), /point/);
  assert.match(checkPlace(ctx(0), {}, 'pass', 1), /minimum/);
  assert.equal(checkPlace(ctx(6), { pass: 10 }, 'passOdds', 50), null);
  assert.match(checkPlace(ctx(6), { pass: 10 }, 'passOdds', 51), /Max odds/);
  assert.match(checkPlace(ctx(4), { pass: 10 }, 'passOdds', 31), /Max odds/);
  assert.match(checkPlace(ctx(6), {}, 'come:6', 10), /Come box/);
  assert.equal(checkPlace(ctx(6), {}, 'bogus', 10), 'Unknown bet');
  assert.equal(parseKey('hop:4-2'), null);
  assert.equal(parseKey('hard:5'), null);
  assert.equal(parseKey('place:7'), null);
});

test('take-down rules', () => {
  assert.match(takeDown(ctx(6), { pass: 10 }, 'pass').error, /contract/);
  assert.equal(takeDown(ctx(0), { pass: 10 }, 'pass').returned, 10);
  assert.match(takeDown(ctx(6), { 'come:5': 10 }, 'come:5').error, /contract/);
  const r = takeDown(ctx(6), { dp: 10, dpOdds: 60 }, 'dp');
  assert.equal(r.returned, 70);
  assert.deepEqual(r.bets, {});
  assert.equal(takeDown(ctx(6), { 'place:6': 12 }, 'place:6', 6).bets['place:6'], 6);
});

test('point cycle', () => {
  assert.equal(nextPoint(0, 7), 0);
  assert.equal(nextPoint(0, 8), 8);
  assert.equal(nextPoint(8, 8), 0);
  assert.equal(nextPoint(8, 7), 0);
  assert.equal(nextPoint(8, 5), 8);
});

test('table: shooter rules, rotation, chip conservation', () => {
  const dice = [[2, 2], [3, 4], [3, 4]];
  const t = new Table('TEST', { rollDice: () => dice.shift() });
  const a = t.addPlayer('Ann').player;
  const b = t.addPlayer('Bob').player;
  assert.equal(t.shooterId, a.id);
  assert.match(t.act(b, { t: 'roll' }), /has the dice/);
  assert.match(t.act(a, { t: 'roll' }), /Pass Line or Don't Pass/);
  assert.equal(t.act(a, { t: 'bet', key: 'pass', amt: 10 }), null);
  assert.equal(t.act(b, { t: 'bet', key: 'dp', amt: 10 }), null);
  assert.equal(t.act(a, { t: 'roll' }), null);            // point 4
  assert.equal(t.point, 4);
  assert.match(t.act(a, { t: 'pass' }), /point is on/);
  assert.equal(t.act(a, { t: 'bet', key: 'passOdds', amt: 30 }), null);
  assert.equal(t.act(b, { t: 'bet', key: 'field', amt: 5 }), null);
  assert.equal(t.act(a, { t: 'roll' }), null);            // seven out
  assert.equal(t.point, 0);
  assert.equal(t.shooterId, b.id);
  assert.equal(a.bank, 1000 - 40);
  assert.equal(b.bank, 1000 - 10 + 10 - 5);               // dp stays up, won 10, field lost
  assert.deepEqual(b.bets, { dp: 10 });
  assert.equal(b.lastOneRoll.field, 5);
  assert.equal(t.act(b, { t: 'repeat' }), null);
  assert.equal(b.bets.field, 5);
  assert.match(t.act(a, { t: 'bet', key: 'pass', amt: 5000 }), /Not enough/);
});

// House edge must match the published numbers.
// Line bets span many rolls, so they are simulated; every other bet resolves
// independently per roll, so its edge is computed exactly over the 36 outcomes.
function simulatedEdge(key, amt, rolls = 3_000_000) {
  let a = 0x9e3779b9;
  const rnd = () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return 1 + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 6);
  };
  let point = 0, bets = {}, wagered = 0, net = 0;
  for (let i = 0; i < rolls; i++) {
    if (!bets[key] && !checkPlace({ point, min: 1, max: 1e9 }, bets, key, amt)) bets[key] = amt;
    const d1 = rnd(), d2 = rnd();
    const r = resolve(point, d1, d2, bets, true);
    for (const e of r.events) if (e.key === key) wagered += amt;
    net += r.net;
    bets = r.bets;
    point = nextPoint(point, d1 + d2);
  }
  return (-net / wagered) * 100;
}

function exactEdge(key, amt) {
  let wagered = 0, net = 0;
  for (let d1 = 1; d1 <= 6; d1++) for (let d2 = 1; d2 <= 6; d2++) {
    const r = resolve(5, d1, d2, { [key]: amt }, true); // point 5 is neutral for every bet tested here
    if (r.events.length) { wagered += amt; net += r.net; }
  }
  return (-net / wagered) * 100;
}

for (const [key, amt, want] of [['pass', 10, 1.41], ['dp', 10, 1.36]]) {
  test(`house edge (simulated): ${key} ~ ${want}%`, () => {
    const got = simulatedEdge(key, amt);
    assert.ok(Math.abs(got - want) < 0.25, `${key}: simulated ${got.toFixed(2)}%, expected ${want}%`);
  });
}

const EXACT = [
  ['field', 5, 2.78], ['place:6', 6, 1.52], ['place:8', 6, 1.52], ['place:9', 5, 4.0], ['place:4', 5, 6.67],
  ['big6', 5, 9.09], ['hard:6', 5, 9.09], ['hard:8', 5, 9.09], ['hard:4', 5, 11.11], ['hard:10', 5, 11.11],
  ['any7', 5, 16.67], ['anyCraps', 5, 11.11], ['two', 5, 13.89], ['twelve', 5, 13.89], ['three', 5, 11.11],
  ['eleven', 5, 11.11], ['horn', 4, 12.5], ['ce', 2, 11.11], ['world', 5, 13.33], ['hop:2-4', 1, 11.11],
  ['hop:3-3', 1, 13.89], ['buy:4', 20, 1.67], ['buy:10', 20, 1.67], ['lay:4', 40, 1.67], ['lay:6', 120, 2.27],
];
for (const [key, amt, want] of EXACT) {
  test(`house edge (exact): ${key} = ${want}%`, () => {
    const got = exactEdge(key, amt);
    assert.ok(Math.abs(got - want) < 0.01, `${key}: computed ${got.toFixed(3)}%, expected ${want}%`);
  });
}
