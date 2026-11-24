// One craps table: seats, bankrolls, the shooter, and the hand in progress.
// Transport-agnostic - the server feeds it actions and broadcasts snapshot().

import { randomInt, randomBytes } from 'node:crypto';
import {
  POINTS, checkPlace, takeDown, resolve, classify, nextPoint, isOneRoll, label, totalOnTable, parseKey,
} from './engine.js';

export const MAX_PLAYERS = 8;
export const SHOOTER_IDLE_MS = 20_000; // after this, anyone may roll for a stalled shooter
const HISTORY = 24;
const LOG = 40;

const CALLS = {
  2: 'Aces! Craps two', 3: 'Ace-deuce, craps three', 11: 'Yo-leven!', 12: 'Boxcars! Craps twelve',
};

export class Table {
  constructor(code, { min = 5, max = 5000, buyIn = 1000, rollDice } = {}) {
    this.code = code;
    this.min = min;
    this.max = max;
    this.buyIn = buyIn;
    this.rollDice = rollDice || (() => [randomInt(1, 7), randomInt(1, 7)]);
    this.players = [];
    this.point = 0;
    this.shooterId = null;
    this.n = 0;            // roll counter
    this.handRolls = 0;    // rolls by the current shooter
    this.history = [];
    this.log = [];
    this.lastRoll = null;
    this.shooterAt = Date.now(); // last time the shooter acted / got the dice
    this.touched = Date.now();
  }

  get ctx() { return { point: this.point, min: this.min, max: this.max }; }
  get shooter() { return this.players.find((p) => p.id === this.shooterId) || null; }
  player(id) { return this.players.find((p) => p.id === id) || null; }

  say(text) {
    this.log.unshift(text);
    if (this.log.length > LOG) this.log.length = LOG;
  }

  addPlayer(rawName) {
    if (this.players.length >= MAX_PLAYERS) return { error: `Table is full (${MAX_PLAYERS} players)` };
    let name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${name.replace(/ \d+$/, '')} ${i}`;
    const player = {
      id: randomBytes(6).toString('hex'),
      token: randomBytes(16).toString('hex'),
      name, bank: this.buyIn, bets: {}, working: false, connected: true,
      rebuys: 0, lastNet: 0, lastOneRoll: {}, seenAt: Date.now(),
    };
    this.players.push(player);
    if (!this.shooter) this.giveDice(player);
    this.say(`${name} sat down with $${this.buyIn}`);
    this.touched = Date.now();
    return { player };
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    this.say(`${gone.name} left the table`);
    if (this.shooterId === id) {
      const next = this.players.length ? this.pickNext(i - 1) : null;
      if (next) this.giveDice(next); else this.shooterId = null;
    }
  }

  /** Next connected player after seat index `from` (wraps); falls back to anyone seated. */
  pickNext(from) {
    const n = this.players.length;
    if (!n) return null;
    for (let k = 1; k <= n; k++) {
      const p = this.players[(((from + k) % n) + n) % n];
      if (p.connected) return p;
    }
    return this.players[(((from + 1) % n) + n) % n];
  }

  giveDice(player) {
    this.shooterId = player.id;
    this.handRolls = 0;
    this.shooterAt = Date.now();
  }

  passDice() {
    const i = this.players.findIndex((p) => p.id === this.shooterId);
    const next = this.pickNext(i);
    if (next && next.id !== this.shooterId) {
      this.giveDice(next);
      this.say(`${next.name} has the dice`);
    }
  }

  /** Handle one action from a seated player. Returns an error string or null. */
  act(player, msg) {
    this.touched = Date.now();
    player.seenAt = Date.now();
    switch (msg.t) {
      case 'bet': return this.bet(player, msg.key, msg.amt);
      case 'remove': return this.remove(player, msg.key, msg.amt);
      case 'clear': return this.clear(player);
      case 'repeat': return this.repeat(player);
      case 'roll': return this.roll(player);
      case 'pass': return this.pass(player);
      case 'working': player.working = !!msg.on; return null;
      case 'rebuy': return this.rebuy(player);
      default: return 'Unknown action';
    }
  }

  bet(player, key, amt) {
    if (amt > player.bank) return 'Not enough chips';
    const err = checkPlace(this.ctx, player.bets, key, amt);
    if (err) return err;
    player.bets[key] = (player.bets[key] || 0) + amt;
    player.bank -= amt;
    if (player.id === this.shooterId) this.shooterAt = Date.now();
    return null;
  }

  remove(player, key, amt) {
    const r = takeDown(this.ctx, player.bets, key, amt);
    if (r.error) return r.error;
    player.bets = r.bets;
    player.bank += r.returned;
    return null;
  }

  clear(player) {
    for (const key of Object.keys(player.bets)) {
      const r = takeDown(this.ctx, player.bets, key);
      if (!r.error) { player.bets = r.bets; player.bank += r.returned; }
    }
    return null;
  }

  /** Re-place last roll's one-roll bets (field, props, hops). */
  repeat(player) {
    const keys = Object.keys(player.lastOneRoll);
    if (!keys.length) return 'No one-roll bets to repeat';
    let placed = 0;
    for (const key of keys) {
      if (player.bets[key]) continue;
      if (!this.bet(player, key, player.lastOneRoll[key])) placed++;
    }
    return placed ? null : 'Could not repeat those bets';
  }

  rebuy(player) {
    if (player.bank + totalOnTable(player.bets) >= this.buyIn / 2) return `Rebuy opens when you are under $${this.buyIn / 2}`;
    player.bank += this.buyIn;
    player.rebuys++;
    this.say(`${player.name} bought in for another $${this.buyIn}`);
    return null;
  }

  pass(player) {
    const stalled = this.shooterStalled();
    if (player.id !== this.shooterId && !stalled) return 'Only the shooter can pass the dice';
    if (this.point !== 0) return 'The dice cannot change hands while a point is on';
    if (this.players.length < 2) return 'Nobody to pass to';
    this.passDice();
    return null;
  }

  shooterStalled(now = Date.now()) {
    const s = this.shooter;
    return !s || !s.connected || now - this.shooterAt > SHOOTER_IDLE_MS;
  }

  roll(player) {
    const shooter = this.shooter;
    if (!shooter) return 'No shooter';
    const isShooter = player.id === shooter.id;
    if (!isShooter && !this.shooterStalled()) return `${shooter.name} has the dice`;
    if (isShooter && this.point === 0 && !(shooter.bets.pass || shooter.bets.dp)) {
      return "The shooter needs a Pass Line or Don't Pass bet to come out";
    }

    const [d1, d2] = this.rollDice();
    const total = d1 + d2;
    const before = this.point;
    const kind = classify(before, total);
    this.n++;
    this.handRolls++;

    const results = {};
    for (const p of this.players) {
      p.lastOneRoll = {};
      for (const [k, v] of Object.entries(p.bets)) if (isOneRoll(k)) p.lastOneRoll[k] = v;
      const r = resolve(before, d1, d2, p.bets, p.working);
      p.bets = r.bets;
      p.bank += r.returned;
      p.lastNet = r.net;
      if (r.events.length) {
        results[p.id] = {
          net: r.net,
          events: r.events.map((e) => ({ key: e.key, label: label(e.key), result: e.result, amount: e.amount, to: e.to })),
        };
      }
    }

    this.point = nextPoint(before, total);
    const dice = `${d1}-${d2}`;
    const hardWay = d1 === d2 && POINTS.includes(total) ? ' the hard way' : '';
    let call;
    if (kind === 'natural') call = total === 7 ? 'Seven, front line winner!' : 'Yo-leven, front line winner!';
    else if (kind === 'craps') call = `${CALLS[total]} - line away`;
    else if (kind === 'point') call = `The point is ${total}${hardWay}`;
    else if (kind === 'made') call = `${total}${hardWay} - winner! Point made`;
    else if (kind === 'out') call = 'Seven out, line away';
    else call = CALLS[total] || `${total}${hardWay}`;
    this.say(`${shooter.name} rolled ${dice}: ${call}`);

    this.history.unshift({ d1, d2, total, kind });
    if (this.history.length > HISTORY) this.history.length = HISTORY;
    this.lastRoll = { n: this.n, d1, d2, total, kind, call, by: player.id, shooter: shooter.id, results };

    this.shooterAt = Date.now();
    if (kind === 'out') {
      this.say(`${shooter.name} threw ${this.handRolls} roll${this.handRolls === 1 ? '' : 's'}`);
      this.passDice();
    }
    return null;
  }

  snapshot() {
    return {
      code: this.code, min: this.min, max: this.max, buyIn: this.buyIn,
      point: this.point, n: this.n, shooterId: this.shooterId,
      shooterAt: this.shooterAt, now: Date.now(), idleMs: SHOOTER_IDLE_MS,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, bank: p.bank, bets: p.bets, working: p.working,
        connected: p.connected, rebuys: p.rebuys, lastNet: p.lastNet,
        canRepeat: Object.keys(p.lastOneRoll).length > 0,
      })),
      history: this.history, log: this.log, lastRoll: this.lastRoll,
    };
  }
}

export { parseKey };
