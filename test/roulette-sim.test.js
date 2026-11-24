import test from 'node:test';
import assert from 'node:assert/strict';
import { WHEELS, covers, payout, resolve, checkPlace, colorOf } from '../shared/roulette.js';
import { RouletteTable } from '../src/roulette-table.js';
import { simulate, validate, crapsWants, nextMultiplier, CRAPS_PRESETS, ROULETTE_PRESETS } from '../shared/sim.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} (+/- ${tol})`);
function seeded(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('wheels: 37 and 38 distinct pockets, 18 red and 18 black', () => {
  assert.equal(new Set(WHEELS.european).size, 37);
  assert.equal(new Set(WHEELS.american).size, 38);
  for (const w of ['european', 'american']) {
    assert.equal(WHEELS[w].filter((p) => colorOf(p) === 'red').length, 18);
    assert.equal(WHEELS[w].filter((p) => colorOf(p) === 'black').length, 18);
  }
  assert.ok(!WHEELS.european.includes('00'));
});

test('bet coverage', () => {
  assert.deepEqual(covers('sp:1-2', 'european'), ['1', '2']);
  assert.deepEqual(covers('sp:1-4', 'european'), ['1', '4']);
  assert.equal(covers('sp:3-4', 'european'), null);          // 3 and 4 are not neighbours on the layout
  assert.equal(covers('sp:1-5', 'european'), null);
  assert.deepEqual(covers('st:1', 'american'), ['1', '2', '3']);
  assert.deepEqual(covers('co:1', 'american'), ['1', '2', '4', '5']);
  assert.equal(covers('co:3', 'american'), null);
  assert.deepEqual(covers('sl:5', 'european'), ['13', '14', '15', '16', '17', '18']);
  assert.equal(covers('col:1', 'european').length, 12);
  assert.ok(covers('col:3', 'european').includes('36'));
  assert.equal(covers('n:00', 'european'), null);
  assert.deepEqual(covers('n:00', 'american'), ['00']);
  assert.equal(covers('top5', 'european'), null);
  assert.equal(covers('first4', 'american'), null);
  assert.equal(covers('sp:0-00', 'european'), null);
  assert.deepEqual(covers('trio:00-2-3', 'american'), ['00', '2', '3']);
  assert.equal(covers('nope', 'european'), null);
  assert.equal(covers('n:37', 'european'), null);
});

test('payouts and settlement', () => {
  assert.equal(payout('n:17', 'european'), 35);
  assert.equal(payout('sp:17-18', 'european'), 17);
  assert.equal(payout('st:6', 'european'), 11);
  assert.equal(payout('co:17', 'european'), 8);
  assert.equal(payout('sl:5', 'european'), 5);
  assert.equal(payout('dz:2', 'european'), 2);
  assert.equal(payout('red', 'european'), 1);
  assert.equal(payout('top5', 'american'), 6);
  const r = resolve('european', '17', { 'n:17': 5, red: 10, 'dz:2': 10, 'col:2': 10 });
  assert.equal(r.net, 175 - 10 + 20 + 20);            // 17 is black, 2nd dozen, 2nd column
  assert.equal(r.returned, 5 + 175 + 30 + 30);
  assert.equal(resolve('american', '00', { red: 10, 'n:00': 1 }).net, 25);
  assert.equal(resolve('european', '0', { red: 10, even: 10, low: 10 }).net, -30);
});

// Exact house edge: every bet over every pocket.
function edge(key, wheel) {
  let net = 0;
  for (const p of WHEELS[wheel]) net += resolve(wheel, p, { [key]: 1 }).net;
  return (-net / WHEELS[wheel].length) * 100;
}
test('house edge: 2.70% single zero, 5.26% double zero, 7.89% top line', () => {
  for (const key of ['n:17', 'n:0', 'sp:0-2', 'sp:8-11', 'st:4', 'trio:0-1-2', 'co:20', 'first4', 'sl:3', 'dz:1', 'col:3', 'red', 'black', 'even', 'odd', 'low', 'high']) {
    near(edge(key, 'european'), 2.7027, 0.001, `european ${key}`);
  }
  for (const key of ['n:17', 'n:00', 'sp:0-00', 'st:4', 'trio:0-00-2', 'co:20', 'sl:3', 'dz:1', 'col:3', 'red', 'odd', 'high']) {
    near(edge(key, 'american'), 5.2632, 0.001, `american ${key}`);
  }
  near(edge('top5', 'american'), 7.8947, 0.001, 'top5');
});

test('placement limits', () => {
  const ctx = { wheel: 'european', minInside: 1, minOutside: 5, max: 5000 };
  assert.equal(checkPlace(ctx, {}, 'n:17', 1), null);
  assert.match(checkPlace(ctx, {}, 'red', 1), /Minimum/);
  assert.match(checkPlace(ctx, { red: 5000 }, 'red', 5), /maximum/);
  assert.match(checkPlace(ctx, {}, 'n:00', 5), /not on this wheel/);
  assert.equal(checkPlace(ctx, {}, 'red', 2.5), 'Bad amount');
});

test('roulette table: spin, settle, rebet', () => {
  const t = new RouletteTable('TEST', { wheel: 'american', spinWheel: () => '7' });
  const a = t.addPlayer('Ann').player, b = t.addPlayer('Bob').player;
  assert.match(t.act(a, { t: 'spin' }), /Place a bet/);
  assert.equal(t.act(a, { t: 'bet', key: 'red', amt: 10 }), null);
  assert.equal(t.act(a, { t: 'bet', key: 'n:7', amt: 2 }), null);
  assert.equal(t.act(b, { t: 'bet', key: 'black', amt: 25 }), null);
  assert.equal(t.act(b, { t: 'remove', key: 'black', amt: 5 }), null);
  assert.equal(t.act(b, { t: 'spin' }), null);
  assert.equal(a.bank, 1000 + 10 + 70);
  assert.equal(b.bank, 980);
  assert.deepEqual(a.bets, {});
  assert.match(t.act(a, { t: 'spin' }), /still spinning|Place a bet/);
  assert.equal(t.act(a, { t: 'repeat' }), null);
  assert.deepEqual(a.bets, { red: 10, 'n:7': 2 });
  assert.equal(t.snapshot().lastSpin.pocket, '7');
  assert.equal(t.snapshot().game, 'roulette');
});

test('progressions', () => {
  const st = { m: 1, streak: 0, i: 0 };
  nextMultiplier('martingale', st, false); nextMultiplier('martingale', st, false); assert.equal(st.m, 4);
  nextMultiplier('martingale', st, true); assert.equal(st.m, 1);
  nextMultiplier('dalembert', st, false); nextMultiplier('dalembert', st, false); assert.equal(st.m, 3);
  nextMultiplier('dalembert', st, true); assert.equal(st.m, 2);
  const f = { m: 1, streak: 0, i: 0 };
  for (let k = 0; k < 4; k++) nextMultiplier('fibonacci', f, false); assert.equal(f.m, 5);
  nextMultiplier('fibonacci', f, true); assert.equal(f.m, 2);
  const p = { m: 1, streak: 0, i: 0 };
  nextMultiplier('paroli', p, true); nextMultiplier('paroli', p, true); assert.equal(p.m, 4);
  nextMultiplier('paroli', p, true); assert.equal(p.m, 1);
});

test('craps strategy: pass line, then odds once the point is on', () => {
  const s = CRAPS_PRESETS.find((p) => p.id === 'pass-odds').s;
  assert.deepEqual(crapsWants(s, 0, {}), [['pass', 10]]);
  assert.deepEqual(crapsWants(s, 6, { pass: 10 }), [['passOdds', 50]]);
  assert.deepEqual(crapsWants(s, 4, { pass: 10 }), [['passOdds', 30]]);
  assert.deepEqual(crapsWants(s, 4, { pass: 10, passOdds: 30 }), []);
  const molly = CRAPS_PRESETS.find((p) => p.id === 'molly').s;
  assert.deepEqual(crapsWants(molly, 6, { pass: 10, passOdds: 20, 'come:5': 10 }), [['come', 10], ['comeOdds:5', 20]]);
  const iron = CRAPS_PRESETS.find((p) => p.id === 'iron').s;
  assert.deepEqual(crapsWants(iron, 0, {}), [['place:5', 10], ['place:6', 12], ['place:8', 12], ['field', 10]]);
});

test('every preset is a legal strategy', () => {
  for (const p of CRAPS_PRESETS) assert.equal(validate({ game: 'craps', bankroll: 1000, craps: p.s }), null, p.id);
  for (const w of ['european', 'american']) {
    for (const p of ROULETTE_PRESETS) assert.equal(validate({ game: 'roulette', bankroll: 1000, roulette: { ...p.s, wheel: w } }), null, p.id);
  }
  assert.match(validate({ game: 'roulette', bankroll: 1000, roulette: { wheel: 'european', bets: [['n:00', 5]], progression: 'flat' } }), /not on this wheel/);
  assert.match(validate({ game: 'craps', bankroll: 1000, craps: { line: 'none', place: [], field: 0, hard: 0 } }), /at least one/);
});

test('simulator: flat red loses the house edge, on both wheels', () => {
  const base = { game: 'roulette', rounds: 100, trials: 20000, bankroll: 100000 };
  const eu = simulate({ ...base, rng: seeded(1), roulette: { wheel: 'european', bets: [['red', 10]], progression: 'flat' } });
  near(eu.mean, -1000 * 0.027027, 6, 'european mean');           // 100 spins x $10 x 2.70%
  near(eu.edge * 100, 2.70, 0.6, 'european edge');
  assert.equal(eu.avgWagered, 1000);
  assert.equal(eu.bustRate, 0);
  const us = simulate({ ...base, rng: seeded(2), roulette: { wheel: 'american', bets: [['red', 10]], progression: 'flat' } });
  near(us.mean, -1000 * 0.052632, 6, 'american mean');
});

test('simulator: red + two columns matches its exact expectation', () => {
  const r = simulate({ game: 'roulette', rounds: 50, trials: 20000, bankroll: 100000, rng: seeded(3),
    roulette: { wheel: 'european', bets: [['red', 10], ['col:1', 10], ['col:2', 10]], progression: 'flat' } });
  near(r.mean, -50 * 30 * 0.027027, 8, 'mean');
});

test('simulator: craps pass line realises ~1.41%, and odds add no edge', () => {
  const base = { game: 'craps', rounds: 200, trials: 20000, bankroll: 1e6 };
  const pass = simulate({ ...base, rng: seeded(4), craps: CRAPS_PRESETS.find((p) => p.id === 'pass').s });
  near(pass.edge * 100, 1.41, 0.45, 'pass edge');
  const odds = simulate({ ...base, rng: seeded(5), craps: CRAPS_PRESETS.find((p) => p.id === 'pass-odds').s });
  near(odds.mean, pass.mean, 14, 'odds leave the expected loss unchanged');
  assert.ok(odds.sd > pass.sd * 2.5, 'odds widen the swings');
  assert.ok(odds.ddMean > pass.ddMean, 'and deepen drawdowns');
});

test('simulator: martingale wins often, busts sometimes, and still loses on average', () => {
  const r = simulate({ game: 'roulette', rounds: 20, trials: 20000, bankroll: 500, rng: seeded(6),
    roulette: { wheel: 'european', bets: [['red', 5]], progression: 'martingale' } });
  assert.ok(r.winRate > 0.7, `win rate ${r.winRate}`);
  assert.ok(r.mean < 0, `mean ${r.mean}`);
  assert.ok(r.ddP95 > 100, `p95 drawdown ${r.ddP95}`);
  assert.ok(r.worst >= -500, 'never loses more than the bankroll');
});

test('simulator: deterministic for a given seed, and summaries are consistent', () => {
  const cfg = () => ({ game: 'craps', rounds: 50, trials: 2000, bankroll: 500, rng: seeded(9), craps: CRAPS_PRESETS.find((p) => p.id === 'iron').s });
  const a = simulate(cfg()), b = simulate(cfg());
  assert.equal(a.mean, b.mean);
  assert.equal(a.bands.p50.length, 51);
  assert.equal(a.bands.p50[0], 500);
  assert.ok(a.p5 <= a.median && a.median <= a.p95);
  assert.ok(a.ddMedian <= a.ddP95 && a.ddP95 <= a.ddWorst);
  assert.ok(a.worst >= -500);
});

test('simulator: spread statistics match theory for a flat even-money bet', () => {
  const r = simulate({ game: 'roulette', rounds: 100, trials: 40000, bankroll: 100000, rng: seeded(11),
    roulette: { wheel: 'european', bets: [['red', 10]], progression: 'flat' } });
  // one $10 spin: variance = 100 * (1 - (1/37)^2); 100 independent spins add up
  const perSpin = 10 * Math.sqrt(1 - (1 / 37) ** 2);
  near(r.sdRound, perSpin, 0.05, 'sd per round');
  near(r.sd, perSpin * 10, 1.5, 'sd per session');
  near(r.variance, perSpin * perSpin * 100, 300, 'variance');
  near(r.evRound, -10 / 37, 0.02, 'ev per round');
  assert.ok(r.ci95[0] < -1000 / 37 && -1000 / 37 < r.ci95[1], 'true mean sits inside the 95% interval');
  near(r.n0, 37 * 37 - 1, 250, 'N0');
  assert.equal(r.avgRounds, 100);
});

test('simulator: stop-loss and win goal end sessions early without changing the edge', () => {
  const r = simulate({ game: 'roulette', rounds: 200, trials: 20000, bankroll: 1000, stopLoss: 100, winGoal: 100, rng: seeded(12),
    roulette: { wheel: 'european', bets: [['red', 10]], progression: 'flat' } });
  assert.ok(r.goalRate > 0.2 && r.stopRate > 0.2, `goal ${r.goalRate} stop ${r.stopRate}`);
  assert.ok(r.stopRate > r.goalRate, 'the stop is hit more often than the goal');
  assert.ok(r.worst >= -100 && r.best <= 100);
  assert.ok(r.avgRounds < 200);
  near(r.edge * 100, 2.70, 0.9, 'edge per dollar bet is unchanged');
});
