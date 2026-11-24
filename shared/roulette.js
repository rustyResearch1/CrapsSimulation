// Pure roulette rules engine. No I/O, no randomness. Runs on the server and in the browser.
// Pockets are strings: '0', '00', '1' .. '36'. Bets are a map of key -> whole-dollar amount.
//
// Keys:
//   n:P            straight up on pocket P                      35:1
//   sp:A-B         split, two adjacent pockets                  17:1
//   st:R           street, row R (1-12) = 3R-2 .. 3R            11:1
//   trio:A-B-C     zero trios, e.g. trio:0-1-2                  11:1
//   co:N           corner whose lowest number is N              8:1
//   first4         0-1-2-3 (single-zero wheel only)             8:1
//   top5           0-00-1-2-3 (double-zero wheel only)          6:1
//   sl:R           six line, rows R and R+1 (R 1-11)            5:1
//   dz:D, col:C    dozen / column (1-3)                         2:1
//   red black even odd low high                                 1:1

export const WHEELS = {
  european: ['0', '32', '15', '19', '4', '21', '2', '25', '17', '34', '6', '27', '13', '36', '11', '30', '8', '23', '10', '5',
    '24', '16', '33', '1', '20', '14', '31', '9', '22', '18', '29', '7', '28', '12', '35', '3', '26'],
  american: ['0', '28', '9', '26', '30', '11', '7', '20', '32', '17', '5', '22', '34', '15', '3', '24', '36', '13', '1', '00',
    '27', '10', '25', '29', '12', '8', '19', '31', '18', '6', '21', '33', '16', '4', '23', '35', '14', '2'],
};
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const colorOf = (p) => (p === '0' || p === '00' ? 'green' : REDS.has(+p) ? 'red' : 'black');
export const isWheel = (w) => w === 'european' || w === 'american';

const ZERO_SPLITS = { european: ['0-1', '0-2', '0-3'], american: ['0-1', '0-00', '0-2', '00-2', '00-3'] };
const ZERO_TRIOS = { european: ['0-1-2', '0-2-3'], american: ['0-1-2', '0-00-2', '00-2-3'] };
const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(String(i)); return out; };
const OUTSIDE = {
  red: () => range(1, 36).filter((p) => REDS.has(+p)),
  black: () => range(1, 36).filter((p) => !REDS.has(+p)),
  even: () => range(1, 36).filter((p) => +p % 2 === 0),
  odd: () => range(1, 36).filter((p) => +p % 2 === 1),
  low: () => range(1, 18),
  high: () => range(19, 36),
};
const int = (s, lo, hi) => (/^\d{1,2}$/.test(s) && +s >= lo && +s <= hi ? +s : null);

/** The pockets a bet covers on this wheel, or null if the bet does not exist on it. */
export function covers(key, wheel) {
  if (typeof key !== 'string' || key.length > 14 || !isWheel(wheel)) return null;
  if (OUTSIDE[key]) return OUTSIDE[key]();
  if (key === 'first4') return wheel === 'european' ? ['0', '1', '2', '3'] : null;
  if (key === 'top5') return wheel === 'american' ? ['0', '00', '1', '2', '3'] : null;
  const i = key.indexOf(':');
  if (i < 0) return null;
  const type = key.slice(0, i), rest = key.slice(i + 1);
  switch (type) {
    case 'n': return WHEELS[wheel].includes(rest) ? [rest] : null;
    case 'sp': {
      if (ZERO_SPLITS[wheel].includes(rest)) return rest.split('-');
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(rest);
      if (!m) return null;
      const a = int(m[1], 1, 36), b = int(m[2], 1, 36);
      if (a === null || b === null) return null;
      const side = b === a + 1 && a % 3 !== 0, below = b === a + 3;
      return side || below ? [String(a), String(b)] : null;
    }
    case 'trio': return ZERO_TRIOS[wheel].includes(rest) ? rest.split('-') : null;
    case 'st': { const r = int(rest, 1, 12); return r === null ? null : range(3 * r - 2, 3 * r); }
    case 'co': { const n = int(rest, 1, 32); return n === null || n % 3 === 0 ? null : [n, n + 1, n + 3, n + 4].map(String); }
    case 'sl': { const r = int(rest, 1, 11); return r === null ? null : range(3 * r - 2, 3 * r + 3); }
    case 'dz': { const d = int(rest, 1, 3); return d === null ? null : range(12 * d - 11, 12 * d); }
    case 'col': { const c = int(rest, 1, 3); return c === null ? null : range(1, 36).filter((p) => (+p - 1) % 3 === c - 1); }
    default: return null;
  }
}

/** Profit per $1 staked. Every bet pays 36/n - 1 except the five-number top line. */
export function payout(key, wheel) {
  const c = covers(key, wheel);
  if (!c) return null;
  return key === 'top5' ? 6 : 36 / c.length - 1;
}

export const isOutside = (key) => !!OUTSIDE[key] || key.startsWith('dz:') || key.startsWith('col:');

export function label(key) {
  const N = { red: 'Red', black: 'Black', even: 'Even', odd: 'Odd', low: '1 to 18', high: '19 to 36', first4: 'First four', top5: 'Top line' };
  if (N[key]) return N[key];
  const [type, rest] = key.split(':');
  if (type === 'n') return `Straight ${rest}`;
  if (type === 'sp') return `Split ${rest}`;
  if (type === 'trio') return `Trio ${rest}`;
  if (type === 'st') return `Street ${3 * rest - 2}-${3 * rest}`;
  if (type === 'co') return `Corner ${rest}-${+rest + 4}`;
  if (type === 'sl') return `Six line ${3 * rest - 2}-${3 * rest + 3}`;
  if (type === 'dz') return ['1st', '2nd', '3rd'][rest - 1] + ' dozen';
  if (type === 'col') return ['1st', '2nd', '3rd'][rest - 1] + ' column';
  return key;
}

/** Can `amt` more go on `key`? Returns an error string, or null. ctx: { wheel, minInside, minOutside, max } */
export function checkPlace(ctx, bets, key, amt) {
  if (!covers(key, ctx.wheel)) return 'That bet is not on this wheel';
  if (!Number.isInteger(amt) || amt <= 0) return 'Bad amount';
  const total = (bets[key] || 0) + amt;
  const min = isOutside(key) ? ctx.minOutside : ctx.minInside;
  if (total < min) return `Minimum on ${isOutside(key) ? 'outside' : 'inside'} bets is $${min}`;
  if (total > ctx.max) return `Table maximum is $${ctx.max}`;
  return null;
}

/**
 * Settle one spin for one player. Every bet is resolved: winners come back with their
 * profit, losers are collected. Returns { returned, net, events }.
 */
export function resolve(wheel, pocket, bets) {
  let returned = 0, net = 0;
  const events = [];
  for (const key of Object.keys(bets)) {
    const amt = bets[key];
    const c = amt ? covers(key, wheel) : null;
    if (!c) continue;
    if (c.includes(pocket)) {
      const profit = amt * payout(key, wheel);
      returned += amt + profit; net += profit;
      events.push({ key, result: 'win', amount: profit });
    } else {
      net -= amt;
      events.push({ key, result: 'lose', amount: amt });
    }
  }
  return { returned, net, events };
}

export const totalOnTable = (bets) => Object.values(bets).reduce((s, v) => s + v, 0);
