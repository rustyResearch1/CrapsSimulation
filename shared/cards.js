// Playing cards. A card is two characters: rank (A23456789TJQK) then suit (S H D C).
export const RANKS = 'A23456789TJQK';
export const SUITS = 'SHDC';

/** A new shoe in a fixed, documented order: deck by deck, suits S H D C, ranks A to K. */
export function freshShoe(decks) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) shoe.push(r + s);
  return shoe;
}

/**
 * Deal up to `count` cards from a fresh shoe using a byte stream, without replacement.
 * Four bytes at a time are read as an unsigned number; a number at or above the largest
 * multiple of the cards remaining is skipped, so every remaining card is equally likely.
 * The result for the first k cards never depends on later bytes.
 */
export function cardsFromBytes(bytes, decks, count) {
  const shoe = freshShoe(decks), out = [];
  for (let i = 0; i + 4 <= bytes.length && out.length < count; i += 4) {
    const v = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const n = shoe.length, limit = Math.floor(4294967296 / n) * n;
    if (v >= limit) continue;
    out.push(shoe.splice(v % n, 1)[0]);
  }
  return out;
}
