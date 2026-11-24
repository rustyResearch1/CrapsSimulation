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
- `public/lab.html|js` - Strategy Lab: strategy builder, charts, statistics.
- `public/common.js`, `public/base.css` - helpers, connection and styles shared by all pages.

## Design notes

- Server-authoritative: clients send intents (`bet`, `remove`, `roll`, `spin`...), the server
  validates, draws with `crypto.randomInt`, settles every player, and broadcasts one full snapshot.
- Animations only stage the server's result: dice land with the rolled values on top, and the
  ball's angle is tracked relative to the wheel so it settles in the drawn pocket.
- Reconnect: each seat has a secret token kept in the browser; a dropped phone rejoins its seat.
  Seats are freed after 15 minutes offline; idle tables after 6 hours.
- State is in memory. A restart clears tables.
- The Lab runs entirely in the browser. Its statistics are tested against closed-form values
  (edge, per-spin standard deviation, N0) in `test/roulette-sim.test.js`.

## Bets

Pass / Don't Pass with 3-4-5x odds (lay up to 6x), Come / Don't Come with odds, Place, Buy, Lay,
Field (2 doubles, 12 triples), Big 6/8, Hardways, Any 7, Any Craps, 2, 3, 11, 12, Horn, C&E,
World, and all 21 Hop bets. Not included: Fire Bet / All-Tall-Small side bets, put bets.

Roulette: straight, split, street, trio, corner, first four / top line, six line, dozens, columns,
red/black, even/odd, low/high. No la partage or en prison; no call (racetrack) bets.
