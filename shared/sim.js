// Strategy simulator. Plays a betting strategy through the same rules engines the live
// tables use, thousands of sessions at a time, and reports the spread of outcomes.
// Pure: no DOM, no I/O. Runs in the browser (Strategy Lab) and in Node (tests).

import * as craps from './craps.js';
import * as roulette from './roulette.js';

export const LIMITS = {
  craps: { min: 5, max: 5000 },
  roulette: { minInside: 1, minOutside: 5, max: 5000 },
};
const LAY = { 4: 2, 10: 2, 5: 1.5, 9: 1.5, 6: 1.2, 8: 1.2 }; // lay this much to win 1
const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

/** Place bets are sized to their payout: 6 and 8 in $6 units, the rest in $5 units. */
export const placeAmount = (n, unit) => Math.max(1, Math.round(unit / 5)) * (n === 6 || n === 8 ? 6 : 5);

/**
 * Craps strategy:
 *   line      'pass' | 'dp' | 'none'     lineAmt   flat bet
 *   odds      0 | 1 | 2 | 345            odds multiple behind line and come bets (345 = table max 3-4-5x)
 *   come      0-3                        how many Come (or Don't Come) bets to keep working
 *   place     [numbers]                  placeUnit  base unit for each placed number
 *   field     amount every roll          hard      amount on each hardway
 * Returns the chips this strategy wants to add before the next roll.
 */
export function crapsWants(s, point, bets) {
  const want = [];
  const dont = s.line === 'dp';
  const oddsFor = (flat, n) => {
    if (!s.odds || !flat) return 0;
    if (!dont) return flat * Math.min(s.odds === 345 ? 9 : s.odds, craps.ODDS_MULT[n]);
    const win = flat * (s.odds === 345 ? craps.ODDS_MULT[n] : s.odds);       // lay enough to win that multiple
    return Math.min(flat * craps.LAY_ODDS_MULT, Math.ceil(win * LAY[n]));
  };
  if (point === 0) {
    if (s.line !== 'none' && !bets[s.line]) want.push([s.line, s.lineAmt]);
  } else {
    if (s.line !== 'none' && bets[s.line] && !bets[dont ? 'dpOdds' : 'passOdds']) {
      const amt = oddsFor(bets[s.line], point);
      if (amt) want.push([dont ? 'dpOdds' : 'passOdds', amt]);
    }
    if (s.come > 0) {
      const box = dont ? 'dc' : 'come';
      let up = bets[box] ? 1 : 0;
      for (const n of craps.POINTS) if (bets[`${box}:${n}`]) up++;
      if (up < s.come && !bets[box]) want.push([box, s.lineAmt]);
    }
  }
  if (s.come > 0 && s.odds) {
    const box = dont ? 'dc' : 'come', oddsKey = dont ? 'dcOdds' : 'comeOdds';
    for (const n of craps.POINTS) {
      const flat = bets[`${box}:${n}`];
      if (flat && !bets[`${oddsKey}:${n}`]) want.push([`${oddsKey}:${n}`, oddsFor(flat, n)]);
    }
  }
  for (const n of s.place || []) if (!bets[`place:${n}`]) want.push([`place:${n}`, placeAmount(n, s.placeUnit)]);
  if (s.field > 0 && !bets.field) want.push(['field', s.field]);
  if (s.hard > 0) for (const n of [4, 6, 8, 10]) if (!bets[`hard:${n}`]) want.push([`hard:${n}`, s.hard]);
  return want;
}

/**
 * Roulette strategy: { wheel, bets: [[key, amount], ...], progression }
 * The whole layout is scaled by a multiplier that the progression moves after each spin:
 *   flat        always 1
 *   martingale  double after a losing spin, back to 1 after a winning one
 *   paroli      double after a win, up to three in a row, then back to 1
 *   dalembert   +1 after a loss, -1 after a win
 *   fibonacci   one step up the sequence after a loss, two steps back after a win
 */
export function nextMultiplier(progression, st, won) {
  switch (progression) {
    case 'martingale': st.m = won ? 1 : st.m * 2; break;
    case 'paroli': st.streak = won ? st.streak + 1 : 0; if (st.streak >= 3) st.streak = 0; st.m = 2 ** st.streak; break;
    case 'dalembert': st.m = Math.max(1, st.m + (won ? -1 : 1)); break;
    case 'fibonacci': st.i = won ? Math.max(0, st.i - 2) : Math.min(FIB.length - 1, st.i + 1); st.m = FIB[st.i]; break;
    default: st.m = 1;
  }
}

/** Reject strategies the tables would not accept, before spending time simulating them. */
export function validate(cfg) {
  if (!(cfg.bankroll >= 1)) return 'Enter a starting bankroll';
  if (cfg.game === 'roulette') {
    const s = cfg.roulette;
    if (!roulette.isWheel(s.wheel)) return 'Pick a wheel';
    if (!s.bets.length) return 'Add at least one bet';
    const ctx = { wheel: s.wheel, ...LIMITS.roulette };
    const seen = {};
    for (const [key, amt] of s.bets) {
      const err = roulette.checkPlace(ctx, seen, key, amt);
      if (err) return `${roulette.covers(key, s.wheel) ? roulette.label(key) : key}: ${err}`;
      seen[key] = (seen[key] || 0) + amt;
    }
    return null;
  }
  const s = cfg.craps;
  const any = s.line !== 'none' || (s.place || []).length || s.field > 0 || s.hard > 0;
  if (!any) return 'Pick at least one bet';
  if (s.line !== 'none' && !(s.lineAmt >= LIMITS.craps.min)) return `Line bets start at $${LIMITS.craps.min}`;
  if (s.line === 'none' && s.come > 0) return 'Come bets need a line bet amount - pick Pass or Don\'t Pass';
  if ((s.place || []).length && !(s.placeUnit >= 5)) return 'Place bets start at $5';
  if (s.field > 0 && s.field < LIMITS.craps.min) return `Field bets start at $${LIMITS.craps.min}`;
  return null;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * createSim(cfg) -> { total, done, step(n), result() }
 * cfg: { game, rounds, trials, bankroll, stopLoss?, winGoal?, rng?, craps?, roulette? }
 * One round is one roll (craps) or one spin (roulette). A session ends early when it is down
 * stopLoss, up winGoal, or cannot afford its next bet. step(n) runs up to n more sessions
 * so a caller can keep its UI responsive; result() summarises the sessions run so far.
 */
export function createSim(cfg) {
  const rng = cfg.rng || Math.random;
  const { rounds, trials, bankroll, game } = cfg;
  const W = rounds + 1;
  const equity = new Float32Array(trials * W);   // equity[t * W + r] = chips in hand + on the table after round r
  const drawdown = new Float32Array(trials);
  const wagered = new Float64Array(trials);
  const busted = new Uint8Array(trials);
  const ended = new Uint8Array(trials);          // 0 ran the distance, 1 hit the win goal, 2 hit the stop-loss
  const played = new Uint32Array(trials);
  const floor = cfg.stopLoss > 0 ? bankroll - cfg.stopLoss : -Infinity;
  const ceiling = cfg.winGoal > 0 ? bankroll + cfg.winGoal : Infinity;
  let done = 0, steps = 0, stepSum = 0, stepSq = 0;   // per-round changes, pooled over every round played

  /** Book one round's result; returns true if the session should stop here. */
  function book(t, base, r, eq, prev) {
    equity[base + r] = eq; played[t] = r;
    const d = eq - prev; steps++; stepSum += d; stepSq += d * d;
    if (eq >= ceiling) ended[t] = 1; else if (eq <= floor) ended[t] = 2; else return false;
    for (let k = r + 1; k <= rounds; k++) equity[base + k] = eq;
    return true;
  }

  function runCraps(t) {
    const s = cfg.craps, ctx = { point: 0, ...LIMITS.craps };
    let bank = bankroll, bets = {}, point = 0, peak = bankroll, dd = 0, action = 0, prev = bankroll;
    const base = t * W;
    equity[base] = bankroll;
    for (let r = 1; r <= rounds; r++) {
      ctx.point = point;
      for (const [key, amt] of crapsWants(s, point, bets)) {
        if (amt > bank || craps.checkPlace(ctx, bets, key, amt)) continue;
        bets[key] = (bets[key] || 0) + amt; bank -= amt;
      }
      const onTable = craps.totalOnTable(bets);
      if (onTable === 0) { busted[t] = 1; for (let k = r; k <= rounds; k++) equity[base + k] = bank; break; }   // cannot afford the next bet
      const d1 = 1 + Math.floor(rng() * 6), d2 = 1 + Math.floor(rng() * 6);
      const res = craps.resolve(point, d1, d2, bets, false);
      // Action = every bet that was decided this roll. A bet that wins and stays up counts again next time.
      for (const e of res.events) if (e.result === 'win' || e.result === 'lose') action += bets[e.key];
      bets = res.bets; bank += res.returned;
      point = craps.nextPoint(point, d1 + d2);
      const eq = bank + craps.totalOnTable(bets);
      if (eq > peak) peak = eq; else if (peak - eq > dd) dd = peak - eq;
      if (book(t, base, r, eq, prev)) break;
      prev = eq;
    }
    drawdown[t] = dd; wagered[t] = action;
  }

  function runRoulette(t) {
    const s = cfg.roulette, wheel = roulette.WHEELS[s.wheel], n = wheel.length;
    const layout = s.bets.reduce((sum, b) => sum + b[1], 0), biggest = Math.max(...s.bets.map((b) => b[1]));
    const cap = Math.max(1, Math.floor(LIMITS.roulette.max / biggest));
    const st = { m: 1, streak: 0, i: 0 };
    let bank = bankroll, peak = bankroll, dd = 0, action = 0;
    const base = t * W;
    equity[base] = bankroll;
    const bets = {};
    for (let r = 1; r <= rounds; r++) {
      let m = Math.min(st.m, cap);
      if (layout * m > bank) { m = 1; st.m = 1; st.streak = 0; st.i = 0; }     // can't cover the step: start the progression over
      if (layout > bank) { busted[t] = 1; for (let k = r; k <= rounds; k++) equity[base + k] = bank; break; }
      for (const [key, amt] of s.bets) bets[key] = (bets[key] || 0) + amt * m;
      action += layout * m;
      const res = roulette.resolve(s.wheel, wheel[Math.floor(rng() * n)], bets);
      for (const key in bets) delete bets[key];
      bank += res.net;
      nextMultiplier(s.progression, st, res.net > 0);
      if (bank > peak) peak = bank; else if (peak - bank > dd) dd = peak - bank;
      if (book(t, base, r, bank, bank - res.net)) break;
    }
    drawdown[t] = dd; wagered[t] = action;
  }

  const run = game === 'roulette' ? runRoulette : runCraps;

  return {
    total: trials,
    get done() { return done; },
    step(count) {
      const end = Math.min(trials, done + count);
      for (; done < end; done++) run(done);
      return done;
    },
    result() {
      const T = done;
      const finals = new Float64Array(T);
      let sum = 0, wins = 0, busts = 0, goals = 0, stops = 0, action = 0, ddSum = 0, roundsSum = 0;
      for (let t = 0; t < T; t++) {
        const net = equity[t * W + rounds] - bankroll;
        finals[t] = net; sum += net;
        if (net > 0) wins++;
        busts += busted[t]; action += wagered[t]; ddSum += drawdown[t]; roundsSum += played[t];
        if (ended[t] === 1) goals++; else if (ended[t] === 2) stops++;
      }
      const mean = sum / T;
      let m2 = 0, m3 = 0, m4 = 0;
      for (let t = 0; t < T; t++) { const d = finals[t] - mean; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
      const variance = T > 1 ? m2 / (T - 1) : 0, sd = Math.sqrt(variance), stderr = sd / Math.sqrt(T);
      const pv = m2 / T;
      const sortedFinals = Float64Array.from(finals).sort(), sortedDd = Float64Array.from(drawdown.subarray(0, T)).sort();
      const col = new Float32Array(T);
      const bands = { p5: [], p25: [], p50: [], p75: [], p95: [] };
      for (let r = 0; r <= rounds; r++) {
        for (let t = 0; t < T; t++) col[t] = equity[t * W + r];
        col.sort();
        bands.p5.push(quantile(col, 0.05)); bands.p25.push(quantile(col, 0.25)); bands.p50.push(quantile(col, 0.5));
        bands.p75.push(quantile(col, 0.75)); bands.p95.push(quantile(col, 0.95));
      }
      const evRound = steps ? stepSum / steps : 0;
      const sdRound = steps ? Math.sqrt(Math.max(0, stepSq / steps - evRound * evRound)) : 0;
      const q = (x) => quantile(sortedFinals, x);
      return {
        trials: T, rounds, bankroll,
        // location
        mean, median: q(0.5), stderr, ci95: [mean - 1.96 * stderr, mean + 1.96 * stderr],
        // spread
        variance, sd, skew: pv ? (m3 / T) / pv ** 1.5 : 0, kurtosis: pv ? (m4 / T) / (pv * pv) - 3 : 0,
        pct: { p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99) },
        p5: q(0.05), p95: q(0.95), best: sortedFinals[T - 1], worst: sortedFinals[0],
        // per round
        evRound, sdRound,
        // rounds until the expected loss is as large as one standard deviation of luck: (sd / ev)^2
        n0: evRound ? (sdRound / evRound) ** 2 : Infinity,
        // outcomes
        winRate: wins / T, bustRate: busts / T, goalRate: goals / T, stopRate: stops / T, avgRounds: roundsSum / T,
        // cost
        avgWagered: action / T, edge: action ? -sum / action : 0,
        // drawdown: the largest peak-to-trough fall within a session
        ddMean: ddSum / T, ddMedian: quantile(sortedDd, 0.5), ddP95: quantile(sortedDd, 0.95), ddWorst: sortedDd[T - 1],
        finals: sortedFinals, bands,
      };
    },
  };
}

/** Run a whole simulation in one go (tests, small jobs). */
export function simulate(cfg) {
  const sim = createSim(cfg);
  sim.step(cfg.trials);
  return sim.result();
}

export const CRAPS_PRESETS = [
  { id: 'pass-odds', name: 'Pass Line + full odds', note: 'Line bet, then max 3-4-5x true odds once the point is on. Lowest edge at the table.',
    s: { line: 'pass', lineAmt: 10, odds: 345, come: 0, place: [], placeUnit: 10, field: 0, hard: 0 } },
  { id: 'pass', name: 'Pass Line only', note: 'The plain line bet, no odds.',
    s: { line: 'pass', lineAmt: 10, odds: 0, come: 0, place: [], placeUnit: 10, field: 0, hard: 0 } },
  { id: 'molly', name: 'Three Point Molly', note: 'Pass Line plus two Come bets, all with odds. Three numbers working.',
    s: { line: 'pass', lineAmt: 10, odds: 2, come: 2, place: [], placeUnit: 10, field: 0, hard: 0 } },
  { id: 'dont', name: "Don't Pass + lay odds", note: 'Betting with the house: wins on seven-outs.',
    s: { line: 'dp', lineAmt: 10, odds: 2, come: 0, place: [], placeUnit: 10, field: 0, hard: 0 } },
  { id: 'place68', name: 'Place 6 and 8', note: 'No line bet. The two most-rolled numbers besides 7.',
    s: { line: 'none', lineAmt: 10, odds: 0, come: 0, place: [6, 8], placeUnit: 10, field: 0, hard: 0 } },
  { id: 'inside', name: 'Pass + place inside', note: 'Pass Line with odds, plus 5, 6, 8 and 9 placed.',
    s: { line: 'pass', lineAmt: 10, odds: 1, come: 0, place: [5, 6, 8, 9], placeUnit: 10, field: 0, hard: 0 } },
  { id: 'iron', name: 'Iron Cross', note: 'Field plus 5, 6 and 8 placed: something wins on every roll except 7.',
    s: { line: 'none', lineAmt: 10, odds: 0, come: 0, place: [5, 6, 8], placeUnit: 10, field: 10, hard: 0 } },
  { id: 'field', name: 'Field every roll', note: 'One-roll bet on 2, 3, 4, 9, 10, 11, 12.',
    s: { line: 'none', lineAmt: 10, odds: 0, come: 0, place: [], placeUnit: 10, field: 10, hard: 0 } },
];

export const ROULETTE_PRESETS = [
  { id: 'red', name: 'Red, flat', note: 'Same even-money bet every spin.', s: { bets: [['red', 10]], progression: 'flat' } },
  { id: 'red-cols', name: 'Red + two columns', note: 'Red with the 1st and 2nd columns: covers most of the board each spin.',
    s: { bets: [['red', 10], ['col:1', 10], ['col:2', 10]], progression: 'flat' } },
  { id: 'martingale', name: 'Martingale on red', note: 'Double after every loss, reset after a win.', s: { bets: [['red', 5]], progression: 'martingale' } },
  { id: 'dalembert', name: "D'Alembert on red", note: 'One unit up after a loss, one down after a win.', s: { bets: [['red', 5]], progression: 'dalembert' } },
  { id: 'fib', name: 'Fibonacci on red', note: 'Climb the Fibonacci sequence on losses.', s: { bets: [['red', 5]], progression: 'fibonacci' } },
  { id: 'paroli', name: 'Paroli on red', note: 'Double after wins, bank it after three in a row.', s: { bets: [['red', 5]], progression: 'paroli' } },
  { id: 'dozens', name: 'Two dozens', note: 'Covers 24 numbers; wins about two spins in three.', s: { bets: [['dz:1', 10], ['dz:2', 10]], progression: 'flat' } },
  { id: 'bond', name: 'James Bond', note: '$14 on 19-36, $5 on the 13-18 six line, $1 on zero.', s: { bets: [['high', 14], ['sl:5', 5], ['n:0', 1]], progression: 'flat' } },
  { id: 'number', name: 'One number', note: 'Straight up on 17 every spin. 35 to 1.', s: { bets: [['n:17', 5]], progression: 'flat' } },
];
