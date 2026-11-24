import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crapsTheory, rouletteTheory, houseRound } from '../shared/theory.js';
import * as craps from '../shared/craps.js';
import * as roulette from '../shared/roulette.js';
import { crapsWants, CRAPS_PRESETS } from '../shared/sim.js';
import { createStats } from '../src/stats.js';
import { Table } from '../src/table.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const WAYS = { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 };

test('theory: stage-wise Pass Line adds up to 1.414%, Don\'t Pass to 1.364% of bets made', () => {
  let pass = (12 / 36) * crapsTheory('pass', 0).ev, dp = (11 / 36) * crapsTheory('dp', 0).ev;
  for (const n of [4, 5, 6, 8, 9, 10]) { pass += (WAYS[n] / 36) * crapsTheory('pass', n).ev; dp += (WAYS[n] / 36) * crapsTheory('dp', n).ev; }
  near(pass * 100, 1.4141, 0.0005, 'pass');
  near(dp * 100, 1.3636, 0.0005, 'dp');
});

test('theory: published edges, and zero edge on odds', () => {
  const pct = (k, p = 6) => crapsTheory(k, p).ev * 100;
  near(pct('passOdds', 4), 0, 1e-9, 'odds'); near(pct('dcOdds:9'), 0, 1e-9, 'lay odds');
  near(pct('place:6'), 1.515, 0.001, 'place 6'); near(pct('place:5'), 4.0, 0.001, 'place 5'); near(pct('place:4'), 6.667, 0.001, 'place 4');
  near(pct('field'), 2.778, 0.001, 'field'); near(pct('hard:6'), 9.091, 0.001, 'hard 6'); near(pct('hard:4'), 11.111, 0.001, 'hard 4');
  near(pct('any7'), 16.667, 0.001, 'any 7'); near(pct('horn'), 12.5, 0.001, 'horn'); near(pct('world'), 13.333, 0.001, 'world');
  near(pct('ce'), 11.111, 0.001, 'c&e'); near(pct('buy:4'), 1.667, 0.001, 'buy 4'); near(pct('hop:3-3'), 13.889, 0.001, 'hop pair');
  near(rouletteTheory('red', 'european').ev * 100, 2.7027, 0.001, 'red'); near(rouletteTheory('top5', 'american').ev * 100, 7.8947, 0.001, 'top5');
  near(rouletteTheory('n:17', 'european').variance, 34.08, 0.01, 'straight-up variance');
  near(rouletteTheory('red', 'european').variance, 0.99927, 0.0001, 'even-money variance');
});

test('houseRound: exact per-round expectation agrees with the closed forms', () => {
  // expected per roll = stake x edge per decision x chance the roll decides the bet
  const one = (bets, point) => houseRound('craps', [{ bets, working: false }], { point }, { d1: 1, d2: 2 });
  near(one({ 'place:6': 12 }, 4).expected, 12 * crapsTheory('place:6', 4).ev * (11 / 36), 1e-9, 'place 6');
  near(one({ field: 5 }, 4).expected, 5 * crapsTheory('field', 4).ev, 1e-9, 'field');
  near(one({ field: 5 }, 4).variance, 25 * crapsTheory('field', 4).variance, 1e-9, 'field variance');
  near(one({ pass: 10 }, 0).expected, 10 * crapsTheory('pass', 0).ev * (12 / 36), 1e-9, 'pass come-out');
  near(one({ pass: 10, passOdds: 50 }, 6).expected, 10 * crapsTheory('pass', 6).ev * (11 / 36), 1e-9, 'odds add nothing');
  assert.equal(one({ 'place:6': 12 }, 0).expected, 0);             // off on the come-out
  const r = houseRound('roulette', [{ bets: { red: 10, 'n:17': 2 } }], { wheel: 'european' }, { pocket: '17' });
  near(r.expected, 12 / 37, 1e-9, 'roulette expected');
  assert.equal(r.hold, 10 - 70); assert.equal(r.handle, 12);
  near(r.families.Straight.variance, 4 * rouletteTheory('n:17', 'european').variance, 1e-9, 'straight variance');
});

test('houseRound: players betting the same way are counted as one correlated risk', () => {
  const solo = houseRound('roulette', [{ bets: { red: 10 } }], { wheel: 'european' }, { pocket: '1' });
  const crowd = houseRound('roulette', Array(8).fill({ bets: { red: 10 } }), { wheel: 'european' }, { pocket: '1' });
  near(crowd.variance, 64 * solo.variance, 1e-6, 'eight on red');           // 8x the stake, not 8 independent bets
  const hedge = houseRound('roulette', [{ bets: { red: 10 } }, { bets: { black: 10 } }], { wheel: 'european' }, { pocket: '1' });
  assert.ok(hedge.variance < solo.variance / 5, 'red against black nearly cancels');
  assert.equal(hedge.hold, 0);
});

test('telemetry: actual hold stays within the theoretical band (8 herding craps players, 60k rolls)', () => {
  const rng = seeded(21), s = { ...CRAPS_PRESETS.find((p) => p.id === 'molly').s, place: [4, 5, 6, 8, 9, 10], placeUnit: 30, field: 10, hard: 5 };
  const players = Array.from({ length: 8 }, () => ({ bets: {}, working: false }));
  let point = 0, hold = 0, expected = 0, variance = 0, handle = 0;
  for (let i = 0; i < 60000; i++) {
    for (const pl of players) {
      for (const [k, a] of crapsWants(s, point, pl.bets)) if (!craps.checkPlace({ point, min: 5, max: 5000 }, pl.bets, k, a)) pl.bets[k] = (pl.bets[k] || 0) + a;
      for (const k of ['any7', 'horn', 'world', 'ce', 'hop:2-5', 'two']) pl.bets[k] = 20;
    }
    const d1 = 1 + Math.floor(rng() * 6), d2 = 1 + Math.floor(rng() * 6);
    const r = houseRound('craps', players, { point }, { d1, d2 });
    hold += r.hold; expected += r.expected; variance += r.variance; handle += r.handle;
    for (const pl of players) pl.bets = craps.resolve(point, d1, d2, pl.bets, false).bets;
    point = craps.nextPoint(point, d1 + d2);
  }
  const z = (hold - expected) / Math.sqrt(variance);
  assert.ok(Math.abs(z) < 3.5, `z = ${z.toFixed(2)} (hold ${hold}, expected ${expected.toFixed(0)}, handle ${handle})`);
  near(expected / handle, hold / handle, 0.01, 'hold % near theory');
});

test('telemetry: roulette hold within band on both wheels', () => {
  for (const wheel of ['european', 'american']) {
    const rng = seeded(wheel.length), bets = { red: 10, 'n:17': 3, 'sp:8-11': 4, 'co:1': 4, 'sl:5': 6, 'dz:2': 10, 'col:3': 10, 'st:2': 3 };
    if (wheel === 'american') bets.top5 = 5; else bets.first4 = 4;
    let hold = 0, expected = 0, variance = 0, handle = 0;
    for (let i = 0; i < 40000; i++) {
      const r = houseRound('roulette', [{ bets }, { bets }], { wheel }, { pocket: roulette.WHEELS[wheel][Math.floor(rng() * roulette.WHEELS[wheel].length)] });
      hold += r.hold; expected += r.expected; variance += r.variance; handle += r.handle;
    }
    assert.ok(Math.abs((hold - expected) / Math.sqrt(variance)) < 3.5, `${wheel} z`);
    near(expected / handle, wheel === 'american' ? 0.055024 : 0.027027, 0.0005, `${wheel} blended edge`);
  }
});

test('stats store: records table play, survives a restart, stores no player identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-'));
  const stats = createStats(dir);
  const dice = [[3, 4], [1, 1], [2, 2], [3, 4]];
  const t = new Table('TEST', { stats, rollDice: () => dice.shift() });
  stats.tableOpened('craps');
  const a = t.addPlayer('Secret Name').player;
  for (let i = 0; i < 4; i++) { if (t.point === 0 && !a.bets.pass) t.act(a, { t: 'bet', key: 'pass', amt: 10 }); t.act(a, { t: 'bet', key: 'field', amt: 5 }); t.act(a, { t: 'roll' }); }
  const r = stats.report(), g = r.games.craps;
  assert.equal(g.rounds, 4);
  assert.equal(g.hold, 1000 - a.bank - Object.values(a.bets).reduce((s, v) => s + v, 0));   // house win is exactly the player's loss
  assert.equal(r.dice.totals[7], 2); assert.equal(r.dice.faces[1], 2);
  assert.equal(r.tables.craps, 1); assert.equal(r.seats, 1);
  assert.equal(r.series.at(-1)[1], g.hold);
  assert.ok(g.families['Pass Line'].n === 3 && g.families.Field.n === 4);
  stats.flush();
  const again = createStats(dir).report();
  assert.equal(again.games.craps.hold, g.hold);
  assert.equal(again.series.at(-1)[1], g.hold);
  assert.ok(!readFileSync(join(dir, 'house.json'), 'utf8').includes('Secret') && !readFileSync(join(dir, 'rounds.ndjson'), 'utf8').includes('Secret'));
});
