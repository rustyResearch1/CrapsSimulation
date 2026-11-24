# Craps Table

Multiplayer Vegas-rules craps with play chips. One Node process serves the phone-friendly
client and a WebSocket; the server owns the dice and every bankroll.

## Run

    npm install
    npm start            # http://localhost:3000  (PORT env var to change)
    npm test             # rules engine: unit tests + house-edge checks
    PORT=3111 npm start & PORT=3111 node scripts/e2e.mjs   # 8 scripted players over real sockets

Open the page, pick a name, open a table, and share the invite link or 4-letter code.

## Layout

- `src/engine.js` - pure rules: bet validation, take-downs, roll resolution, payouts. No I/O.
- `src/table.js`  - one table: seats (max 8), bankrolls, shooter rotation, the hand in progress.
- `src/server.js` - HTTP + WebSocket transport, table codes, reconnects, cleanup.
- `public/index.html` - the whole client (no build step).

## Design notes

- Server-authoritative: clients send intents (`bet`, `remove`, `roll`...), the server validates,
  rolls with `crypto.randomInt`, settles every player, and broadcasts one full snapshot.
  State is a few KB for 8 players, so snapshots beat diffing.
- Reconnect: each seat has a secret token kept in the browser; a dropped phone rejoins its seat.
  Seats are freed after 15 minutes offline; idle tables after 6 hours.
- State is in memory. A restart clears tables - fine for a game night, swap in Redis if you
  ever want tables to survive deploys or run more than one instance.

## Bets

Pass / Don't Pass with 3-4-5x odds (lay up to 6x), Come / Don't Come with odds, Place, Buy, Lay,
Field (2 doubles, 12 triples), Big 6/8, Hardways, Any 7, Any Craps, 2, 3, 11, 12, Horn, C&E,
World, and all 21 Hop bets. Not included: Fire Bet / All-Tall-Small side bets, put bets.
