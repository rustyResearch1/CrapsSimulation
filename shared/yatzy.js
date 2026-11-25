// Pure Yatzy rules (the 13-box card). No I/O, no randomness.
export const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER = ['three', 'four', 'full', 'small', 'large', 'chance', 'yatzy'];
export const CATS = [...UPPER, ...LOWER];
export const NAMES = { ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  three: '3 of a kind', four: '4 of a kind', full: 'Full house', small: 'Small straight', large: 'Large straight', chance: 'Chance', yatzy: 'Yatzy' };
export const HINT = { ones: 'sum of 1s', twos: 'sum of 2s', threes: 'sum of 3s', fours: 'sum of 4s', fives: 'sum of 5s', sixes: 'sum of 6s',
  three: 'sum of all', four: 'sum of all', full: '25', small: '30', large: '40', chance: 'sum of all', yatzy: '50' };
export const ROLLS = 3, BONUS_AT = 63, BONUS = 35, EXTRA_YATZY = 100, START_BANK = 1, MAX_BANK = 3;

const counts = (dice) => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const d of dice) c[d]++; return c; };
const sum = (dice) => dice.reduce((s, d) => s + d, 0);
export const isYatzy = (dice) => dice.length === 5 && dice.every((d) => d === dice[0]);

/** Points the five dice are worth in a box. */
export function score(cat, dice) {
  const c = counts(dice), up = UPPER.indexOf(cat), most = Math.max(...c);
  if (up >= 0) return c[up + 1] * (up + 1);
  const run = (len) => { let r = 0; for (let v = 1; v <= 6; v++) { r = c[v] ? r + 1 : 0; if (r >= len) return true; } return false; };
  switch (cat) {
    case 'three': return most >= 3 ? sum(dice) : 0;
    case 'four': return most >= 4 ? sum(dice) : 0;
    case 'full': return c.includes(3) && c.includes(2) ? 25 : 0;
    case 'small': return run(4) ? 30 : 0;
    case 'large': return run(5) ? 40 : 0;
    case 'chance': return sum(dice);
    case 'yatzy': return most === 5 ? 50 : 0;
    default: return 0;
  }
}

/** card: { box: points } for the boxes filled so far. extra: bonus Yatzys rolled after the first was scored. */
export function totals(card, extra = 0) {
  const upper = UPPER.reduce((s, k) => s + (card[k] || 0), 0), lower = LOWER.reduce((s, k) => s + (card[k] || 0), 0);
  const bonus = upper >= BONUS_AT ? BONUS : 0;
  return { upper, bonus, lower, extra: extra * EXTRA_YATZY, total: upper + bonus + lower + extra * EXTRA_YATZY, filled: CATS.filter((k) => card[k] !== undefined).length };
}
