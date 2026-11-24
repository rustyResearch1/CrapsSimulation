// End-to-end check: real server, real WebSockets, 8 scripted players, plus phone screenshots.
// Usage: node scripts/e2e.mjs   (server must be running on PORT, default 3111)
import WebSocket from 'ws';

const PORT = process.env.PORT || 3111;
const URL = `ws://localhost:${PORT}/ws`;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, state: null, id: null, token: null, errors: [], fatal: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'joined') Object.assign(c, { id: m.id, token: m.token, code: m.code });
    if (m.t === 'state') c.state = m.state;
    if (m.t === 'error') { c.errors.push(m.msg); if (m.fatal) c.fatal = m.msg; }
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const host = client('Host');
await host.open;
host.send({ t: 'create', name: 'Host' });
await tick();
assert(host.code && host.state.players.length === 1, 'table created');

const others = [];
for (let i = 2; i <= 8; i++) {
  const c = client('P' + i); await c.open;
  c.send({ t: 'join', code: host.code, name: 'P' + i });
  others.push(c);
}
await tick(120);
assert(host.state.players.length === 8, '8 players seated');

const ninth = client('Late'); await ninth.open;
ninth.send({ t: 'join', code: host.code, name: 'Late' });
await tick();
assert(/full/.test(ninth.fatal || ''), 'ninth player refused');

const all = [host, ...others];
const chipsInPlay = () => host.state.players.reduce((s, p) => s + p.bank + Object.values(p.bets).reduce((a, b) => a + b, 0), 0);

// Non-shooter cannot roll; shooter cannot roll without a line bet.
others[0].send({ t: 'roll' }); host.send({ t: 'roll' });
await tick();
assert(others[0].errors.some((e) => /has the dice/.test(e)), 'non-shooter blocked');
assert(host.errors.some((e) => /Pass Line or Don't Pass/.test(e)), 'shooter needs a line bet');
assert(host.state.n === 0, 'no roll happened');

// Play 300 rolls with everyone betting; whoever holds the dice shoots.
let rolls = 0, sevenOuts = 0, handoffs = new Set();
while (rolls < 300) {
  const st = host.state;
  for (const c of all) {
    const me = st.players.find((p) => p.id === c.id);
    if (me.bank < 200) { c.send({ t: 'rebuy' }); }
    if (st.point === 0) {
      if (!me.bets.pass && !me.bets.dp) c.send({ t: 'bet', key: rolls % 3 ? 'pass' : 'dp', amt: 10 });
    } else {
      if (me.bets.pass && !me.bets.passOdds) c.send({ t: 'bet', key: 'passOdds', amt: 20 });
      if (!me.bets.come) c.send({ t: 'bet', key: 'come', amt: 10 });
      if (!me.bets['place:6']) c.send({ t: 'bet', key: 'place:6', amt: 12 });
      c.send({ t: 'bet', key: 'field', amt: 5 });
      c.send({ t: 'bet', key: 'hard:8', amt: 1 });
      c.send({ t: 'bet', key: 'hop:2-5', amt: 1 });
    }
  }
  await tick(25);
  const shooter = all.find((c) => c.id === host.state.shooterId);
  handoffs.add(shooter.id);
  const before = host.state.n;
  shooter.send({ t: 'roll' });
  await tick(25);
  if (host.state.n === before + 1) { rolls++; if (host.state.lastRoll.kind === 'out') sevenOuts++; }
  else { // shooter was broke on the come-out line bet; top up and retry
    shooter.send({ t: 'rebuy' }); shooter.send({ t: 'bet', key: 'pass', amt: 10 }); await tick(25);
  }
}
const s = host.state;
const expected = s.players.reduce((a, p) => a + s.buyIn * (1 + p.rebuys), 0);
const netSum = s.players.reduce((a, p) => a + p.bank + Object.values(p.bets).reduce((x, y) => x + y, 0) - s.buyIn * (1 + p.rebuys), 0);
assert(all.every((c) => JSON.stringify(c.state) && c.state.n === s.n), 'all clients converge on the same roll');
assert(sevenOuts > 5 && handoffs.size === 8, `dice rotated through all 8 shooters (${handoffs.size}) over ${sevenOuts} seven-outs`);
assert(s.players.every((p) => p.bank >= 0 && Number.isInteger(p.bank)), 'bankrolls are non-negative integers');
console.log(`300 rolls, ${sevenOuts} seven-outs, ${handoffs.size} shooters, table net ${netSum} on ${expected} bought in, chips in play ${chipsInPlay()}`);

// Reconnect: drop a socket, come back with the token, keep seat and chips.
const victim = others[3];
const bankBefore = s.players.find((p) => p.id === victim.id).bank;
victim.ws.close(); await tick(80);
assert(host.state.players.find((p) => p.id === victim.id).connected === false, 'disconnect is visible');
const back = client('P5'); await back.open;
back.send({ t: 'join', code: host.code, id: victim.id, token: victim.token, name: 'P5' });
await tick(80);
assert(back.id === victim.id && host.state.players.length === 8, 'same seat after reconnect');
assert(host.state.players.find((p) => p.id === victim.id).bank === bankBefore, 'bankroll survived reconnect');

// A forged token must not steal a seat (and the table is full, so it is refused).
const thief = client('Thief'); await thief.open;
thief.send({ t: 'join', code: host.code, id: host.id, token: 'nope', name: 'Thief' });
await tick();
assert(thief.fatal && host.state.players.length === 8, 'forged token rejected');

// Garbage in: must not crash the server.
host.ws.send('not json'); host.send({ t: 'bet', key: 'place:7', amt: 5 }); host.send({ t: 'bet', key: 'pass', amt: -5 });
host.send({ t: 'bet', key: 'pass', amt: 1.5 }); host.send({ t: 'bet', key: { a: 1 }, amt: 5 }); host.send({ t: 'remove', key: 'nope' });
await tick();
host.send({ t: 'ping' }); await tick();
assert(host.ws.readyState === 1, 'server survived malformed input');

// Roulette: a second kind of table on the same server.
const r1 = client('Rita'); await r1.open;
r1.send({ t: 'create', name: 'Rita', game: 'roulette', wheel: 'american' });
await tick();
assert(r1.state.game === 'roulette' && r1.state.wheel === 'american', 'roulette table created');
const r2 = client('Raj'); await r2.open;
r2.send({ t: 'join', code: r1.code, name: 'Raj' });
await tick();
r1.send({ t: 'spin' }); await tick();
assert(r1.errors.some((e) => /Place a bet/.test(e)), 'no spin without a bet');
r1.send({ t: 'bet', key: 'red', amt: 10 }); r1.send({ t: 'bet', key: 'sp:0-00', amt: 5 }); r1.send({ t: 'bet', key: 'first4', amt: 5 });
r2.send({ t: 'bet', key: 'black', amt: 10 }); r2.send({ t: 'bet', key: 'n:17', amt: 1 });
await tick();
assert(r1.errors.some((e) => /not on this wheel/.test(e)), 'single-zero bet refused on a double-zero wheel');
r2.send({ t: 'spin' }); await tick();
const sp = r1.state.lastSpin;
assert(sp && sp.n === 1 && r2.state.lastSpin.pocket === sp.pocket, 'both players see the same pocket');
const [pa, pb] = r1.state.players;
assert(Object.keys(pa.bets).length === 0 && pa.bank === 1000 + sp.results[pa.id].net && pb.bank === 1000 + sp.results[pb.id].net, 'spin settled every bet');
if (sp.color !== 'green') assert((sp.results[pa.id].net === 5) !== (sp.results[pb.id].net >= 9), 'red and black cannot both win');
r1.send({ t: 'spin' }); await tick();
assert(r1.errors.some((e) => /still spinning|Place a bet/.test(e)) && r1.state.n === 1, 'no second spin while the wheel is turning');

console.log('E2E OK');
process.exit(0);
