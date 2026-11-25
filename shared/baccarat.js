// Pure baccarat (punto banco) rules, 8 decks. No I/O, no randomness.
export const DECKS = 8;
export const point = (c) => (c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 0 : +c[0]);
export const total = (cards) => cards.reduce((s, c) => s + point(c), 0) % 10;

/** Deal a full coup. draw() returns the next card. The drawing rules are fixed: nobody makes a choice. */
export function playOut(draw) {
  const player = [draw()], banker = [draw()];
  player.push(draw()); banker.push(draw());
  const p = total(player), b = total(banker);
  if (p >= 8 || b >= 8) return { player, banker };               // a natural ends the coup
  let third = null;
  if (p <= 5) { player.push(draw()); third = point(player[2]); }
  if (third === null) { if (b <= 5) banker.push(draw()); }
  else if (b <= 2 || (b === 3 && third !== 8) || (b === 4 && third >= 2 && third <= 7) || (b === 5 && third >= 4 && third <= 7) || (b === 6 && (third === 6 || third === 7))) banker.push(draw());
  return { player, banker };
}

export function outcome(player, banker) {
  const p = total(player), b = total(banker);
  return { winner: p > b ? 'player' : b > p ? 'banker' : 'tie', pTotal: p, bTotal: b, pPair: player[0][0] === player[1][0], bPair: banker[0][0] === banker[1][0] };
}

/** pays = profit per $1. Banker wins pay 19:20 (the 5% commission). */
export const BETS = {
  player: { name: 'Player', pays: 1 }, banker: { name: 'Banker', pays: 0.95 }, tie: { name: 'Tie', pays: 8 },
  ppair: { name: 'Player pair', pays: 11 }, bpair: { name: 'Banker pair', pays: 11 },
};
export const label = (key) => (BETS[key] ? BETS[key].name : key);

export function checkPlace(ctx, bets, key, amt) {
  if (!BETS[key]) return 'Unknown bet';
  if (!Number.isInteger(amt) || amt <= 0) return 'Bad amount';
  const sum = (bets[key] || 0) + amt, side = key === 'tie' || key === 'ppair' || key === 'bpair';
  if (sum < (side ? 1 : ctx.min)) return `Table minimum is $${ctx.min}`;
  if (sum > ctx.max) return `Table maximum is $${ctx.max}`;
  return null;
}

/** Settle one player's bets. A tie returns Player and Banker bets. */
export function resolve(bets, o) {
  let returned = 0, net = 0;
  const events = [];
  const win = (key, profit) => { returned += bets[key] + profit; net += profit; events.push({ key, result: 'win', amount: profit }); };
  const lose = (key) => { net -= bets[key]; events.push({ key, result: 'lose', amount: bets[key] }); };
  for (const key of Object.keys(bets)) {
    const amt = bets[key];
    if (!amt || !BETS[key]) continue;
    if (key === 'player' || key === 'banker') {
      if (o.winner === 'tie') { returned += amt; events.push({ key, result: 'push', amount: 0 }); }
      else if (o.winner === key) win(key, Math.floor(amt * BETS[key].pays)); else lose(key);
    } else if (key === 'tie') { if (o.winner === 'tie') win(key, amt * 8); else lose(key); }
    else if (key === 'ppair') { if (o.pPair) win(key, amt * 11); else lose(key); }
    else if (key === 'bpair') { if (o.bPair) win(key, amt * 11); else lose(key); }
  }
  return { returned, net, events };
}

/** Published 8-deck probabilities, used for the House page's theoretical hold. */
export const PROB = { banker: 0.458597, player: 0.446247, tie: 0.095156, pair: 0.074699 };
export const EDGE = { banker: 0.010579, player: 0.012351, tie: 0.143596, ppair: 0.103614, bpair: 0.103614 };
