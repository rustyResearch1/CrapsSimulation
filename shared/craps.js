// Pure craps rules engine. No I/O, no randomness, no clocks.
// Bets are a plain map of key -> whole-dollar amount.
//
// Keys:
//   pass, passOdds, dp, dpOdds          line bets and their odds
//   come, dc                            bets sitting in the Come / Don't Come box
//   come:N, comeOdds:N, dc:N, dcOdds:N  come bets that travelled to a number
//   place:N, buy:N, lay:N               N in 4,5,6,8,9,10
//   field, big6, big8
//   hard:N                              N in 4,6,8,10
//   any7, anyCraps, two, three, eleven, twelve, horn, ce, world
//   hop:A-B                             A <= B, exact dice

export const POINTS = [4, 5, 6, 8, 9, 10];
export const ODDS_MULT = { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 }; // 3-4-5x odds
export const LAY_ODDS_MULT = 6; // lay up to 6x flat (wins the same as max take odds)

const TRUE = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] };
const PLACE = { 4: [9, 5], 10: [9, 5], 5: [7, 5], 9: [7, 5], 6: [7, 6], 8: [7, 6] };
const HARD = { 4: 7, 10: 7, 6: 9, 8: 9 };
const SIMPLE = new Set([
  'pass', 'passOdds', 'dp', 'dpOdds', 'come', 'dc', 'field', 'big6', 'big8',
  'any7', 'anyCraps', 'two', 'three', 'eleven', 'twelve', 'horn', 'ce', 'world',
]);
const NUMBERED = new Set(['come', 'comeOdds', 'dc', 'dcOdds', 'place', 'buy', 'lay', 'hard']);
const ONE_ROLL = new Set(['field', 'any7', 'anyCraps', 'two', 'three', 'eleven', 'twelve', 'horn', 'ce', 'world', 'hop']);
const MIN_TYPES = new Set(['pass', 'dp', 'come', 'dc', 'place', 'buy', 'lay', 'field', 'big6', 'big8']);

export function parseKey(key) {
  if (typeof key !== 'string' || key.length > 16) return null;
  if (SIMPLE.has(key)) return { type: key };
  const [type, rest] = key.split(':');
  if (rest === undefined) return null;
  if (type === 'hop') {
    const m = /^([1-6])-([1-6])$/.exec(rest);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    return a <= b ? { type, a, b } : null;
  }
  if (!NUMBERED.has(type) || !/^\d{1,2}$/.test(rest)) return null;
  const n = +rest;
  if (type === 'hard') return HARD[n] ? { type, n } : null;
  return POINTS.includes(n) ? { type, n } : null;
}

export function isOneRoll(key) {
  const p = parseKey(key);
  return !!p && ONE_ROLL.has(p.type);
}

export function label(key) {
  const p = parseKey(key);
  if (!p) return key;
  const L = {
    pass: 'Pass Line', passOdds: 'Pass Odds', dp: "Don't Pass", dpOdds: "Don't Pass Odds",
    field: 'Field', big6: 'Big 6', big8: 'Big 8', any7: 'Any Seven', anyCraps: 'Any Craps',
    two: 'Aces (2)', three: 'Ace-Deuce (3)', eleven: 'Yo (11)', twelve: 'Boxcars (12)',
    horn: 'Horn', ce: 'C & E', world: 'World',
  };
  if (p.type === 'come') return p.n ? `Come ${p.n}` : 'Come';
  if (p.type === 'dc') return p.n ? `Don't Come ${p.n}` : "Don't Come";
  if (p.type === 'comeOdds') return `Come ${p.n} Odds`;
  if (p.type === 'dcOdds') return `Don't Come ${p.n} Odds`;
  if (p.type === 'place') return `Place ${p.n}`;
  if (p.type === 'buy') return `Buy ${p.n}`;
  if (p.type === 'lay') return `Lay ${p.n}`;
  if (p.type === 'hard') return `Hard ${p.n}`;
  if (p.type === 'hop') return `Hop ${p.a}-${p.b}`;
  return L[p.type] || key;
}

const ratio = (amt, [num, den]) => Math.floor((amt * num) / den);
const vig = (base) => Math.max(1, Math.floor(base * 0.05));

/** Largest odds allowed behind a flat bet. */
export function maxOdds(type, n, flat) {
  if (type === 'passOdds' || type === 'comeOdds') return flat * ODDS_MULT[n];
  return flat * LAY_ODDS_MULT;
}

/**
 * Can `amt` more be added to `key`? Returns an error string, or null if legal.
 * ctx: { point, min, max }
 */
export function checkPlace(ctx, bets, key, amt) {
  const p = parseKey(key);
  if (!p) return 'Unknown bet';
  if (!Number.isInteger(amt) || amt <= 0) return 'Bad amount';
  const { point, min, max } = ctx;
  const on = point !== 0;
  const total = (bets[key] || 0) + amt;

  switch (p.type) {
    case 'pass':
      if (on) return 'Pass Line is only open on the come-out roll';
      break;
    case 'dp':
      if (on) return "Don't Pass is only open on the come-out roll";
      break;
    case 'come':
    case 'dc':
      if (p.n) return 'Bet the Come box - the dice move it to a number';
      if (!on) return 'Come bets open once a point is set';
      break;
    case 'passOdds':
      if (!on) return 'Odds open once a point is set';
      if (!bets.pass) return 'Odds need a Pass Line bet';
      if (total > maxOdds('passOdds', point, bets.pass)) return `Max odds on ${point} is ${ODDS_MULT[point]}x your line bet`;
      return null;
    case 'dpOdds':
      if (!on) return 'Odds open once a point is set';
      if (!bets.dp) return "Laying odds needs a Don't Pass bet";
      if (total > maxOdds('dpOdds', point, bets.dp)) return `Max lay is ${LAY_ODDS_MULT}x your Don't Pass bet`;
      return null;
    case 'comeOdds': {
      const flat = bets[`come:${p.n}`];
      if (!flat) return `Odds need a Come bet on ${p.n}`;
      if (total > maxOdds('comeOdds', p.n, flat)) return `Max odds on ${p.n} is ${ODDS_MULT[p.n]}x your Come bet`;
      return null;
    }
    case 'dcOdds': {
      const flat = bets[`dc:${p.n}`];
      if (!flat) return `Laying odds needs a Don't Come bet on ${p.n}`;
      if (total > maxOdds('dcOdds', p.n, flat)) return `Max lay is ${LAY_ODDS_MULT}x your Don't Come bet`;
      return null;
    }
  }
  if (MIN_TYPES.has(p.type) && total < min) return `Table minimum is $${min}`;
  if (total > max) return `Table maximum is $${max}`;
  return null;
}

/**
 * Take `amt` (or everything, if omitted) off `key`.
 * Returns { error } or { bets, returned } where returned goes back to the bankroll.
 */
export function takeDown(ctx, bets, key, amt) {
  const p = parseKey(key);
  const have = bets[key] || 0;
  if (!p || !have) return { error: 'No bet there' };
  if (p.type === 'pass' && ctx.point !== 0) return { error: 'Pass Line is a contract bet once the point is set' };
  if (p.type === 'come' && p.n) return { error: 'A Come bet on a number is a contract bet' };
  const take = amt === undefined ? have : amt;
  if (!Number.isInteger(take) || take <= 0) return { error: 'Bad amount' };
  const out = { ...bets };
  let returned = Math.min(take, have);
  const left = have - returned;
  if (left) out[key] = left; else delete out[key];
  // Odds can never exceed what the remaining flat bet supports.
  const oddsKey = p.type === 'dp' ? 'dpOdds' : p.type === 'dc' && p.n ? `dcOdds:${p.n}` : p.type === 'pass' ? 'passOdds' : null;
  if (oddsKey && out[oddsKey]) {
    const cap = left * LAY_ODDS_MULT;
    if (out[oddsKey] > cap) {
      returned += out[oddsKey] - cap;
      if (cap) out[oddsKey] = cap; else delete out[oddsKey];
    }
  }
  return { bets: out, returned };
}

/** Roll classification, used for the log and the history strip. */
export function classify(point, total) {
  if (point === 0) {
    if (total === 7 || total === 11) return 'natural';
    if (total === 2 || total === 3 || total === 12) return 'craps';
    return 'point';
  }
  if (total === point) return 'made';
  if (total === 7) return 'out';
  return 'number';
}

export function nextPoint(point, total) {
  if (point === 0) return POINTS.includes(total) ? total : 0;
  return total === point || total === 7 ? 0 : point;
}

/**
 * Resolve one roll against one player's bets.
 * `working` = the player wants place/buy/hardway/come-odds bets live on the come-out.
 * Returns { bets, returned, net, events }.
 *   returned: chips handed back to the bankroll (winnings plus any bet taken down)
 *   net:      profit minus losses for this roll
 */
export function resolve(point, d1, d2, bets, working = false) {
  const t = d1 + d2;
  const hard = d1 === d2;
  const co = point === 0;
  const live = !co || working; // do "off on the come-out" bets act this roll?
  const out = {};
  const events = [];
  let returned = 0;
  let net = 0;

  const stay = (key) => { out[key] = (out[key] || 0) + bets[key]; };
  const win = (key, profit, keep = false) => {
    const amt = bets[key];
    net += profit;
    if (keep) { out[key] = (out[key] || 0) + amt; returned += profit; } else returned += amt + profit;
    events.push({ key, result: 'win', amount: profit });
  };
  const lose = (key) => { net -= bets[key]; events.push({ key, result: 'lose', amount: bets[key] }); };
  const push = (key) => { stay(key); events.push({ key, result: 'push', amount: 0 }); };
  const off = (key) => { returned += bets[key]; events.push({ key, result: 'off', amount: bets[key] }); };
  /** One-roll bet where only part of the stake can win: `back` is the total handed back. */
  const split = (key, back) => {
    const amt = bets[key];
    if (back <= 0) return lose(key);
    returned += back; net += back - amt;
    events.push({ key, result: back > amt ? 'win' : back === amt ? 'push' : 'lose', amount: Math.abs(back - amt) });
  };

  const travelling = [];
  for (const key of Object.keys(bets)) {
    const amt = bets[key];
    if (!amt) continue;
    const p = parseKey(key);
    if (!p) continue;
    const n = p.n;
    switch (p.type) {
      case 'pass':
        if (co) { if (t === 7 || t === 11) win(key, amt, true); else if (t === 2 || t === 3 || t === 12) lose(key); else stay(key); }
        else if (t === point) win(key, amt, true); else if (t === 7) lose(key); else stay(key);
        break;
      case 'passOdds':
        if (co) stay(key);
        else if (t === point) win(key, ratio(amt, TRUE[point])); else if (t === 7) lose(key); else stay(key);
        break;
      case 'dp':
        if (co) { if (t === 2 || t === 3) win(key, amt, true); else if (t === 12) push(key); else if (t === 7 || t === 11) lose(key); else stay(key); }
        else if (t === 7) win(key, amt, true); else if (t === point) lose(key); else stay(key);
        break;
      case 'dpOdds':
        if (co) stay(key);
        else if (t === 7) win(key, ratio(amt, [TRUE[point][1], TRUE[point][0]])); else if (t === point) lose(key); else stay(key);
        break;
      case 'come':
        if (!n) { travelling.push(key); break; }
        if (t === n) win(key, amt); else if (t === 7) lose(key); else stay(key);
        break;
      case 'comeOdds':
        if (t === n) { if (live) win(key, ratio(amt, TRUE[n])); else off(key); }
        else if (t === 7) { if (live) lose(key); else off(key); }
        else stay(key);
        break;
      case 'dc':
        if (!n) { travelling.push(key); break; }
        if (t === 7) win(key, amt); else if (t === n) lose(key); else stay(key);
        break;
      case 'dcOdds':
        if (t === 7) win(key, ratio(amt, [TRUE[n][1], TRUE[n][0]])); else if (t === n) lose(key); else stay(key);
        break;
      case 'place':
        if (!live) stay(key);
        else if (t === n) win(key, ratio(amt, PLACE[n]), true); else if (t === 7) lose(key); else stay(key);
        break;
      case 'buy':
        if (!live) stay(key);
        else if (t === n) win(key, ratio(amt, TRUE[n]) - vig(amt), true); else if (t === 7) lose(key); else stay(key);
        break;
      case 'lay': {
        if (t === 7) { const w = ratio(amt, [TRUE[n][1], TRUE[n][0]]); win(key, w - vig(w), true); }
        else if (t === n) lose(key); else stay(key);
        break;
      }
      case 'big6':
      case 'big8': {
        const target = p.type === 'big6' ? 6 : 8;
        if (t === target) win(key, amt, true); else if (t === 7) lose(key); else stay(key);
        break;
      }
      case 'hard':
        if (!live) stay(key);
        else if (t === n && hard) win(key, amt * HARD[n], true);
        else if (t === n || t === 7) lose(key); else stay(key);
        break;
      case 'field':
        if (t === 2) win(key, amt * 2); else if (t === 12) win(key, amt * 3);
        else if ([3, 4, 9, 10, 11].includes(t)) win(key, amt); else lose(key);
        break;
      case 'any7': if (t === 7) win(key, amt * 4); else lose(key); break;
      case 'anyCraps': if (t === 2 || t === 3 || t === 12) win(key, amt * 7); else lose(key); break;
      case 'two': if (t === 2) win(key, amt * 30); else lose(key); break;
      case 'twelve': if (t === 12) win(key, amt * 30); else lose(key); break;
      case 'three': if (t === 3) win(key, amt * 15); else lose(key); break;
      case 'eleven': if (t === 11) win(key, amt * 15); else lose(key); break;
      case 'horn':
        split(key, t === 2 || t === 12 ? Math.floor((amt / 4) * 31) : t === 3 || t === 11 ? Math.floor((amt / 4) * 16) : 0);
        break;
      case 'ce':
        split(key, t === 2 || t === 3 || t === 12 ? Math.floor((amt / 2) * 8) : t === 11 ? Math.floor((amt / 2) * 16) : 0);
        break;
      case 'world':
        split(key, t === 7 ? Math.floor((amt / 5) * 5) : t === 2 || t === 12 ? Math.floor((amt / 5) * 31) : t === 3 || t === 11 ? Math.floor((amt / 5) * 16) : 0);
        break;
      case 'hop': {
        const lo = Math.min(d1, d2), hi = Math.max(d1, d2);
        if (lo === p.a && hi === p.b) win(key, amt * (p.a === p.b ? 30 : 15)); else lose(key);
        break;
      }
    }
  }

  // Come / Don't Come box bets act last so they can travel onto a number that just cleared.
  for (const key of travelling) {
    const amt = bets[key];
    if (key === 'come') {
      if (t === 7 || t === 11) win(key, amt);
      else if (t === 2 || t === 3 || t === 12) lose(key);
      else { out[`come:${t}`] = (out[`come:${t}`] || 0) + amt; events.push({ key, result: 'move', amount: amt, to: t }); }
    } else {
      if (t === 2 || t === 3) win(key, amt);
      else if (t === 12) push(key);
      else if (t === 7 || t === 11) lose(key);
      else { out[`dc:${t}`] = (out[`dc:${t}`] || 0) + amt; events.push({ key, result: 'move', amount: amt, to: t }); }
    }
  }

  return { bets: out, returned, net, events };
}

export const totalOnTable = (bets) => Object.values(bets).reduce((s, v) => s + v, 0);
