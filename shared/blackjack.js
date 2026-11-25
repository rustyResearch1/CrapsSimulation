// Pure blackjack rules. No I/O, no randomness.
// House rules: 6 decks, dealer stands on all 17s, blackjack pays 3:2, double on any two cards,
// double after split, split to 4 hands, split aces get one card each, insurance pays 2:1,
// dealer peeks for blackjack. No surrender.
export const DECKS = 6;
export const MAX_HANDS = 4;

export const cardValue = (c) => (c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : +c[0]);

/** Best total and whether an ace is still counted as 11. */
export function value(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardValue(c); if (c[0] === 'A') aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBust = (cards) => value(cards).total > 21;
/** A natural: 21 on the first two cards of a hand that did not come from a split. */
export const isBlackjack = (hand) => hand.cards.length === 2 && !hand.split && value(hand.cards).total === 21;
export const dealerHits = (cards) => value(cards).total < 17;
export const canSplit = (hand, handCount) => hand.cards.length === 2 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) && handCount < MAX_HANDS;
export const canDouble = (hand) => hand.cards.length === 2 && !hand.splitAces;

/** Settle one finished hand against the dealer's final cards. profit is what the player wins on top of the bet (negative = lost). */
export function settleHand(hand, dealerCards) {
  const p = value(hand.cards).total, d = value(dealerCards).total;
  const dealerBj = dealerCards.length === 2 && d === 21;
  if (p > 21) return { result: 'bust', profit: -hand.bet };
  if (isBlackjack(hand)) return dealerBj ? { result: 'push', profit: 0 } : { result: 'blackjack', profit: Math.floor(hand.bet * 1.5) };
  if (dealerBj) return { result: 'lose', profit: -hand.bet };
  if (d > 21 || p > d) return { result: 'win', profit: hand.bet };
  if (p === d) return { result: 'push', profit: 0 };
  return { result: 'lose', profit: -hand.bet };
}

/** Textbook basic strategy for these rules: 'H' hit, 'S' stand, 'D' double (else hit), 'Ds' double (else stand), 'P' split. */
export function basicStrategy(hand, dealerUp, handCount = 1) {
  const up = cardValue(dealerUp), { total, soft } = value(hand.cards), two = hand.cards.length === 2;
  const dbl = (alt) => (two && canDouble(hand) ? 'D' : alt);
  if (canSplit(hand, handCount)) {
    const v = cardValue(hand.cards[0]);
    if (v === 11 || v === 8) return 'P';
    if (v === 9 && ![7, 10, 11].includes(up)) return 'P';
    if (v === 7 && up <= 7) return 'P';
    if (v === 6 && up <= 6) return 'P';
    if (v === 4 && (up === 5 || up === 6)) return 'P';
    if ((v === 2 || v === 3) && up <= 7) return 'P';
  }
  if (soft) {
    if (total >= 20) return 'S';
    if (total === 19) return 'S';
    if (total === 18) return up <= 6 && up >= 3 ? dbl('S') : up <= 8 ? 'S' : 'H';
    if (total === 17) return up >= 3 && up <= 6 ? dbl('H') : 'H';
    if (total >= 15) return up >= 4 && up <= 6 ? dbl('H') : 'H';
    return up >= 5 && up <= 6 ? dbl('H') : 'H';
  }
  if (total >= 17) return 'S';
  if (total >= 13) return up <= 6 ? 'S' : 'H';
  if (total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
  if (total === 11) return up === 11 ? 'H' : dbl('H');
  if (total === 10) return up <= 9 ? dbl('H') : 'H';
  if (total === 9) return up >= 3 && up <= 6 ? dbl('H') : 'H';
  return 'H';
}
