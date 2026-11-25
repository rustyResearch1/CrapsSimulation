# Casino tables + Strategy Lab

Multiplayer Vegas-rules **craps** and **roulette** (single or double zero) with play chips, plus a
**Strategy Lab** that simulates betting strategies. One Node process serves the phone-friendly
clients and a WebSocket; the server owns the dice, the wheel and every bankroll.

## Run

    npm install
    npm start            # http://localhost:3000  (PORT env var to change)
    npm test             # rules engines, house-edge checks, simulator statistics
    PORT=3111 npm start & PORT=3111 node scripts/e2e.mjs   # scripted players over real sockets

Open the page, pick a game, open a table, and share the invite link or 4-letter code.
`/lab` is the Strategy Lab (no table needed).

## Layout

- `shared/` - pure modules used by BOTH the server and the browser, so they can never disagree:
  - `craps.js`, `roulette.js` - rules: bet validation, resolution, payouts. No I/O.
  - `sim.js` - Monte Carlo simulator that plays strategies through those same rules.
- `src/table.js`, `src/roulette-table.js` - one table each: seats (max 8), bankrolls, turn rules.
- `src/server.js` - HTTP + WebSocket transport (SSE + POST fallback), table codes, reconnects.
- `public/index.html` - lobby and craps client. `public/roll3d.js` - 3D dice scene (three.js).
- `public/roulette.html|js` - roulette client and wheel animation.
- `shared/cards.js`, `blackjack.js`, `baccarat.js` - shoe and card-game rules. `src/card-table.js`,
  `blackjack-table.js`, `baccarat-table.js` - the tables. `public/cards.html`, `cardgame.js`,
  `blackjack.js`, `baccarat.js` - the card-table client and dealing animation.
- `public/lab.html|js` - Strategy Lab: strategy builder, charts, statistics.
- `src/stats.js` - house telemetry store (two files in `DATA_DIR`, default `./data`; no player
  identity). `shared/theory.js` - exact per-round expectation and variance. `/house` shows it.
- `public/common.js`, `public/base.css` - helpers, connection and styles shared by all pages.

## Design notes

- Server-authoritative: clients send intents (`bet`, `remove`, `roll`, `spin`...), the server
  validates, draws with `crypto.randomInt`, settles every player, and broadcasts one full snapshot.
- Animations only stage the server's result: dice land with the rolled values on top, and the
  ball's angle is tracked relative to the wheel so it settles in the drawn pocket.
- Reconnect: each seat has a secret token kept in the browser; a dropped phone rejoins its seat.
  Seats are freed after 15 minutes offline; idle tables after 6 hours.
- Provably fair: `src/fair.js` commits to a seed hash, mixes in a seed from each player's device,
  and reveals the seed after each hand (craps) or every 10 spins (roulette). `shared/fair.js` is the
  verifier; players run it in the browser from Menu > Provably fair, or by hand with any SHA-256 tool.
- State is in memory. A restart clears tables.
- The Lab runs entirely in the browser. Its statistics are tested against closed-form values
  (edge, per-spin standard deviation, N0) in `test/roulette-sim.test.js`.

## Bets

Pass / Don't Pass with 3-4-5x odds (lay up to 6x), Come / Don't Come with odds, Place, Buy, Lay,
Field (2 doubles, 12 triples), Big 6/8, Hardways, Any 7, Any Craps, 2, 3, 11, 12, Horn, C&E,
World, and all 21 Hop bets. Not included: Fire Bet / All-Tall-Small side bets, put bets.

Roulette: straight, split, street, trio, corner, first four / top line, six line, dozens, columns,
red/black, even/odd, low/high. No la partage or en prison; no call (racetrack) bets.


## Card games

Blackjack: 6 decks shuffled every hand, dealer stands on all 17s, blackjack pays 3:2, double any two
cards, double after split, split to 4 hands, split aces get one card, insurance 2:1, no surrender.
Baccarat: 8-deck punto banco, Banker pays 0.95:1, Tie 8:1, pairs 11:1. Both deal from a provably
fair shoe (`cards6` / `cards8` in `shared/fair.js`).

## Yatzy

1v1 (or solo) on the 13-box card: 35 bonus at 63, full house 25, straights 30/40, Yatzy 50, +100 for each
extra Yatzy. Three rolls a turn plus banked bonus rolls: one to start, and a 1-in-6 "lucky die" on the
first roll of each turn banks another (max 3). Every roll is six fair values (`yatzy` in `shared/fair.js`).
