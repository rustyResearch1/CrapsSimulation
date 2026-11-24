// One roulette table: seats, bankrolls, and the wheel. Same interface as the craps Table
// (addPlayer, removePlayer, act, clear, snapshot), so the server treats both alike.

import { randomInt, randomBytes } from 'node:crypto';
import { houseRound } from '../shared/theory.js';
import { WHEELS, colorOf, isWheel, checkPlace, resolve, label, totalOnTable } from '../shared/roulette.js';

export const MAX_PLAYERS = 8;
export const SPIN_GAP_MS = 6000; // the wheel animation; no new spin until it has landed
const HISTORY = 30;
const LOG = 40;

export class RouletteTable {
  constructor(code, { wheel = 'european', minInside = 1, minOutside = 5, max = 5000, buyIn = 1000, spinWheel, stats = null } = {}) {
    this.stats = stats;
    this.game = 'roulette';
    this.code = code;
    this.wheel = isWheel(wheel) ? wheel : 'european';
    this.minInside = minInside;
    this.minOutside = minOutside;
    this.max = max;
    this.buyIn = buyIn;
    // Every pocket is equally likely: one unbiased draw from the OS random generator.
    this.spinWheel = spinWheel || (() => WHEELS[this.wheel][randomInt(WHEELS[this.wheel].length)]);
    this.players = [];
    this.n = 0;
    this.history = [];
    this.log = [];
    this.lastSpin = null;
    this.spinAt = 0;
    this.touched = Date.now();
  }

  get ctx() { return { wheel: this.wheel, minInside: this.minInside, minOutside: this.minOutside, max: this.max }; }
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
      name, bank: this.buyIn, bets: {}, connected: true,
      rebuys: 0, lastNet: 0, lastBets: {}, seenAt: Date.now(),
    };
    this.players.push(player);
    this.say(`${name} sat down with $${this.buyIn}`);
    this.stats?.seated();
    this.touched = Date.now();
    return { player };
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    this.say(`${gone.name} left the table`);
  }

  onDisconnect() {}

  act(player, msg) {
    this.touched = Date.now();
    player.seenAt = Date.now();
    switch (msg.t) {
      case 'bet': return this.bet(player, msg.key, msg.amt);
      case 'remove': return this.remove(player, msg.key, msg.amt);
      case 'clear': return this.clear(player);
      case 'repeat': return this.repeat(player);
      case 'spin': return this.spin(player);
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
    return null;
  }

  remove(player, key, amt) {
    const have = typeof key === 'string' ? player.bets[key] || 0 : 0;
    if (!have) return 'No bet there';
    const take = amt === undefined ? have : amt;
    if (!Number.isInteger(take) || take <= 0) return 'Bad amount';
    const back = Math.min(take, have);
    if (have - back) player.bets[key] = have - back; else delete player.bets[key];
    player.bank += back;
    return null;
  }

  clear(player) {
    player.bank += totalOnTable(player.bets);
    player.bets = {};
    return null;
  }

  /** Put the previous spin's bets back up. */
  repeat(player) {
    const keys = Object.keys(player.lastBets);
    if (!keys.length) return 'No bets to repeat';
    let placed = 0;
    for (const key of keys) {
      if (player.bets[key]) continue;
      if (!this.bet(player, key, player.lastBets[key])) placed++;
    }
    return placed ? null : 'Could not repeat those bets';
  }

  rebuy(player) {
    if (player.bank + totalOnTable(player.bets) >= this.buyIn / 2) return `Rebuy opens when you are under $${this.buyIn / 2}`;
    player.bank += this.buyIn;
    player.rebuys++;
    this.stats?.rebuy();
    this.say(`${player.name} bought in for another $${this.buyIn}`);
    return null;
  }

  spin(player) {
    if (Date.now() - this.spinAt < SPIN_GAP_MS) return 'The wheel is still spinning';
    if (!this.players.some((p) => totalOnTable(p.bets) > 0)) return 'Place a bet before spinning';
    const pocket = this.spinWheel();
    const color = colorOf(pocket);
    this.n++;
    this.spinAt = Date.now();

    const house = this.stats ? houseRound('roulette', this.players.map((p) => ({ bets: p.bets })), { wheel: this.wheel }, { pocket }) : null;
    const results = {};
    for (const p of this.players) {
      if (!totalOnTable(p.bets)) { p.lastNet = 0; continue; }
      p.lastBets = { ...p.bets };
      const r = resolve(this.wheel, pocket, p.bets);
      p.bets = {};
      p.bank += r.returned;
      p.lastNet = r.net;
      results[p.id] = {
        net: r.net,
        events: r.events.map((e) => ({ key: e.key, label: label(e.key), result: e.result, amount: e.amount })),
      };
    }
    this.stats?.round('roulette', { wheel: this.wheel, pocket }, house);
    this.say(`${player.name} spun ${pocket} ${color}`);
    this.history.unshift({ pocket, color });
    if (this.history.length > HISTORY) this.history.length = HISTORY;
    this.lastSpin = { n: this.n, pocket, color, by: player.id, results };
    return null;
  }

  snapshot() {
    return {
      game: 'roulette', code: this.code, wheel: this.wheel,
      minInside: this.minInside, minOutside: this.minOutside, max: this.max, buyIn: this.buyIn,
      n: this.n, spinGapMs: SPIN_GAP_MS,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, bank: p.bank, bets: p.bets, connected: p.connected,
        rebuys: p.rebuys, lastNet: p.lastNet, canRepeat: Object.keys(p.lastBets).length > 0,
      })),
      history: this.history, log: this.log, lastSpin: this.lastSpin,
    };
  }
}
