// House telemetry: what the casino took in, what it kept, and what theory says it should
// have kept. Lightweight on purpose - two files in DATA_DIR, no database:
//   house.json     running totals (rewritten atomically every few seconds when dirty)
//   rounds.ndjson  one line per roll/spin with money at risk: [time, game, handle, hold, expected, variance]
// Nothing here identifies a player: no names, ids or addresses are stored.

import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FLUSH_MS = 5000;
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const SERIES_POINTS = 400;

const blank = () => ({
  version: 1, since: Date.now(), updated: Date.now(),
  tables: { craps: 0, roulette: 0 }, seats: 0, rebuys: 0,
  games: {},                         // game -> { rounds, decided, handle, hold, expected, variance, families: { name -> {n, handle, hold, expected, variance} } }
  dice: { totals: Array(13).fill(0), faces: Array(7).fill(0) },
  pockets: { european: {}, american: {} },
});
const add = (to, r) => { to.handle += r.handle; to.hold += r.hold; to.expected += r.expected; to.variance += r.variance; };

export function createStats(dir) {
  let persistent = true;
  try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, '.probe'), ''); } catch { persistent = false; }   // e.g. a read-only volume
  const totalsFile = join(dir, 'house.json'), logFile = join(dir, 'rounds.ndjson');

  let totals = blank();
  const series = [];                 // per decided round: [game, handle, hold, expected, variance]
  if (persistent) {
    try { totals = { ...blank(), ...JSON.parse(readFileSync(totalsFile, 'utf8')) }; } catch {}
    try {
      for (const line of readFileSync(logFile, 'utf8').split('\n')) {
        if (!line) continue;
        try { const r = JSON.parse(line); series.push([r[1], r[2], r[3], r[4], r[5]]); } catch {}
      }
    } catch {}
  }

  let dirty = false, pending = '';
  function flush() {
    if (!persistent) return;
    try {
      if (pending) {
        if (existsSync(logFile) && statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, logFile + '.1');   // keep one generation
        appendFileSync(logFile, pending); pending = '';
      }
      if (dirty) {
        totals.updated = Date.now();
        writeFileSync(totalsFile + '.tmp', JSON.stringify(totals));
        renameSync(totalsFile + '.tmp', totalsFile);
        dirty = false;
      }
    } catch (e) { console.error('stats flush failed', e.message); }
  }
  setInterval(flush, FLUSH_MS).unref();

  return {
    persistent, dir, flush,
    tableOpened(game) { totals.tables[game] = (totals.tables[game] || 0) + 1; dirty = true; },
    seated() { totals.seats++; dirty = true; },
    rebuy() { totals.rebuys++; dirty = true; },

    /** One roll or spin. outcome: { d1, d2 } or { wheel, pocket }. res: houseRound() for the table. */
    round(game, outcome, res) {
      const g = totals.games[game] || (totals.games[game] = { rounds: 0, decided: 0, handle: 0, hold: 0, expected: 0, variance: 0, families: {} });
      g.rounds++;
      if (game === 'craps') { totals.dice.totals[outcome.d1 + outcome.d2]++; totals.dice.faces[outcome.d1]++; totals.dice.faces[outcome.d2]++; }
      else { const w = totals.pockets[outcome.wheel]; w[outcome.pocket] = (w[outcome.pocket] || 0) + 1; }
      if (res && (res.handle > 0 || res.variance > 0)) {
        g.decided++; add(g, res);
        for (const [name, f] of Object.entries(res.families)) {
          const to = g.families[name] || (g.families[name] = { n: 0, handle: 0, hold: 0, expected: 0, variance: 0 });
          to.n += f.n; add(to, f);
        }
        const row = [game[0], res.handle, res.hold, +res.expected.toFixed(4), +res.variance.toFixed(2)];
        series.push(row);
        pending += JSON.stringify([Date.now(), ...row]) + '\n';
      }
      dirty = true;
    },

    /** Everything the House page needs. The cumulative series is downsampled to a few hundred points. */
    report() {
      const step = Math.max(1, Math.ceil(series.length / SERIES_POINTS));
      const points = [[0, 0, 0, 0]];   // [round, cumulative hold, cumulative expected, cumulative variance]
      let hold = 0, expected = 0, variance = 0;
      series.forEach((r, i) => {
        hold += r[2]; expected += r[3]; variance += r[4];
        if ((i + 1) % step === 0 || i === series.length - 1) points.push([i + 1, hold, +expected.toFixed(2), +variance.toFixed(1)]);
      });
      return { ...totals, now: Date.now(), persistent, series: points };
    },
  };
}
