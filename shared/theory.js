// Casino maths. Two views of the same thing:
//   crapsTheory / rouletteTheory - closed-form edge and variance per $1 for one decision of a bet
//   houseRound                   - exact expectation and variance of a whole round, by enumeration,
//                                  used by the telemetry store. Tests check the two agree.
// Pure, no I/O.
//
// A bet's "decision" is the roll or spin on which it wins or loses. Bets that last several
// rolls are described at the stage they are in: a Pass Line bet on the come-out has
// different odds from the same bet once a point is set, and the stages sum to the familiar
// overall edge (1.41% for Pass).

import { parseKey, resolve as resolveCraps } from './craps.js';
import { covers, payout, WHEELS, resolve as resolveRoulette } from './roulette.js';

const WAYS = { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 };          // dice combinations for each point
const PLACE = { 4: 9 / 5, 10: 9 / 5, 5: 7 / 5, 9: 7 / 5, 6: 7 / 6, 8: 7 / 6 };
const HARD = { 4: 7, 10: 7, 6: 9, 8: 9 };

/** outcomes: [[probability, house result per $1], ...] -> { ev, variance } */
function moments(outcomes) {
  let ev = 0, sq = 0;
  for (const [p, x] of outcomes) { ev += p * x; sq += p * x * x; }
  return { ev, variance: sq - ev * ev };
}
/** Player wins `pays` with probability p, otherwise the house keeps the $1. */
const simple = (p, pays) => moments([[p, -pays], [1 - p, 1]]);

/** point = the point that was on when the dice were thrown (0 on a come-out). */
export function crapsTheory(key, point) {
  const k = parseKey(key);
  if (!k) return null;
  const n = k.n, hit = (m) => WAYS[m] / (WAYS[m] + 6), seven = (m) => 6 / (WAYS[m] + 6);
  switch (k.type) {
    case 'pass': return point === 0 ? simple(8 / 12, 1) : simple(hit(point), 1);
    case 'come': return n ? simple(hit(n), 1) : simple(8 / 12, 1);
    case 'dp': return point === 0 ? simple(3 / 11, 1) : simple(seven(point), 1);   // 12 is a push, not a decision
    case 'dc': return n ? simple(seven(n), 1) : simple(3 / 11, 1);
    case 'passOdds': return simple(hit(point), 6 / WAYS[point]);
    case 'comeOdds': return simple(hit(n), 6 / WAYS[n]);
    case 'dpOdds': return simple(seven(point), WAYS[point] / 6);
    case 'dcOdds': return simple(seven(n), WAYS[n] / 6);
    case 'place': return simple(hit(n), PLACE[n]);
    case 'buy': return simple(hit(n), 6 / WAYS[n] - 0.05);
    case 'lay': return simple(seven(n), (WAYS[n] / 6) * 0.95);
    case 'big6': case 'big8': return simple(5 / 11, 1);
    case 'hard': return simple(1 / (WAYS[n] + 6), HARD[n]);
    case 'field': return moments([[1 / 36, -2], [1 / 36, -3], [14 / 36, -1], [20 / 36, 1]]);
    case 'any7': return simple(6 / 36, 4);
    case 'anyCraps': return simple(4 / 36, 7);
    case 'two': case 'twelve': return simple(1 / 36, 30);
    case 'three': case 'eleven': return simple(2 / 36, 15);
    case 'horn': return moments([[2 / 36, -(31 / 4 - 1)], [4 / 36, -(16 / 4 - 1)], [30 / 36, 1]]);
    case 'ce': return moments([[4 / 36, -(8 / 2 - 1)], [2 / 36, -(16 / 2 - 1)], [30 / 36, 1]]);
    case 'world': return moments([[6 / 36, 0], [2 / 36, -(31 / 5 - 1)], [4 / 36, -(16 / 5 - 1)], [24 / 36, 1]]);
    case 'hop': return k.a === k.b ? simple(1 / 36, 30) : simple(2 / 36, 15);
    default: return null;
  }
}

export function rouletteTheory(key, wheel) {
  const c = covers(key, wheel);
  return c ? simple(c.length / WHEELS[wheel].length, payout(key, wheel)) : null;
}

/** Reporting groups. */
export function crapsFamily(key) {
  const t = key.split(':')[0];
  return { pass: 'Pass Line', dp: "Don't Pass", come: 'Come', dc: "Don't Come", passOdds: 'Odds (take)', comeOdds: 'Odds (take)',
    dpOdds: 'Odds (lay)', dcOdds: 'Odds (lay)', place: 'Place', buy: 'Buy', lay: 'Lay', field: 'Field', hard: 'Hardways',
    big6: 'Big 6 / 8', big8: 'Big 6 / 8', hop: 'Hops' }[t] || 'Props';
}
export function rouletteFamily(key) {
  if (key === 'top5') return 'Top line';
  if (key === 'first4') return 'Corner';
  const t = key.split(':')[0];
  return { n: 'Straight', sp: 'Split', st: 'Street', trio: 'Street', co: 'Corner', sl: 'Six line', dz: 'Dozen / column', col: 'Dozen / column' }[t] || 'Even money';
}

/**
 * The house's side of one roll or spin, with exact theory for that round.
 *
 * Every possible outcome (36 dice pairs, or each pocket) is settled through the real rules
 * engine against the bets actually on the table. That gives the round's expected house win
 * and its variance exactly - including payout rounding, bets that are off, and the fact that
 * players betting the same way win and lose together, which per-bet formulas miss.
 * Summed over rounds, (actual - expected) / sqrt(variance) is a proper z-score.
 *
 *   players: [{ bets, working }]   ctx: { point } or { wheel }   actual: { d1, d2 } or { pocket }
 * Returns { handle, hold, expected, variance, families: { name: { n, handle, hold, expected, variance } } }.
 * Handle counts a stake on the round that decides it.
 */
export function houseRound(game, players, ctx, actual) {
  const roul = game === 'roulette';
  const outcomes = [];
  if (roul) for (const pocket of WHEELS[ctx.wheel]) outcomes.push({ pocket });
  else for (let d1 = 1; d1 <= 6; d1++) for (let d2 = 1; d2 <= 6; d2++) outcomes.push({ d1, d2 });
  const prob = 1 / outcomes.length, family = roul ? rouletteFamily : crapsFamily;
  const fams = {};
  const fam = (name) => fams[name] || (fams[name] = { n: 0, handle: 0, hold: 0, expected: 0, sq: 0 });
  let mean = 0, sq = 0, hold = 0, handle = 0;

  for (const o of outcomes) {
    const real = roul ? o.pocket === actual.pocket : o.d1 === actual.d1 && o.d2 === actual.d2;
    const per = {};
    let total = 0;
    for (const pl of players) {
      const events = roul ? resolveRoulette(ctx.wheel, o.pocket, pl.bets).events : resolveCraps(ctx.point, o.d1, o.d2, pl.bets, pl.working).events;
      for (const e of events) {
        const decided = e.result === 'win' || e.result === 'lose' || (e.result === 'push' && e.key === 'world');
        if (!decided) continue;
        const x = e.result === 'win' ? -e.amount : e.result === 'lose' ? e.amount : 0;
        const name = family(e.key);
        per[name] = (per[name] || 0) + x; total += x;
        if (real) { const f = fam(name), stake = pl.bets[e.key] || 0; f.n++; f.handle += stake; f.hold += x; handle += stake; hold += x; }
      }
    }
    mean += prob * total; sq += prob * total * total;
    for (const name in per) { const f = fam(name); f.expected += prob * per[name]; f.sq += prob * per[name] * per[name]; }
  }
  const families = {};
  for (const [name, f] of Object.entries(fams)) families[name] = { n: f.n, handle: f.handle, hold: f.hold, expected: f.expected, variance: f.sq - f.expected * f.expected };
  return { handle, hold, expected: mean, variance: sq - mean * mean, families };
}
