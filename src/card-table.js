// Shared plumbing for the card tables: seats, bankrolls, the log, the fair shoe.
import { randomBytes } from 'node:crypto';
import { Fair } from './fair.js';

export const MAX_PLAYERS = 8;
const LOG = 40;

export class CardTable {
  constructor(game, code, { decks, min = 5, max = 5000, buyIn = 1000, stats = null, cards = null } = {}) {
    this.game = game; this.code = code; this.min = min; this.max = max; this.buyIn = buyIn; this.stats = stats;
    // Tests may inject a fixed list of cards; live tables deal from a committed, verifiable shoe.
    this.fair = cards ? null : new Fair('cards' + decks);
    this.fixed = cards;
    this.players = []; this.log = []; this.n = 0; this.seq = 0; this.touched = Date.now();
  }
  player(id) { return this.players.find((p) => p.id === id) || null; }
  say(text) { this.log.unshift(text); if (this.log.length > LOG) this.log.length = LOG; }
  openShoe() {
    if (this.fixed) { const list = this.fixed; return { next: () => list.shift(), close() {} }; }
    return this.fair.openRound();
  }
  /** Retire the seed every few rounds so it can be revealed and checked. */
  maybeRotate(every) { if (this.fair && !this.fair.roundOpen && this.fair.rolls.length >= every) this.fair.rotate(); }

  addPlayer(rawName) {
    if (this.players.length >= MAX_PLAYERS) return { error: `Table is full (${MAX_PLAYERS} players)` };
    let name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${name.replace(/ \d+$/, '')} ${i}`;
    const player = { id: randomBytes(6).toString('hex'), token: randomBytes(16).toString('hex'), name, bank: this.buyIn, connected: true, rebuys: 0, lastNet: 0, seenAt: Date.now(), ...this.newSeat() };
    this.players.push(player);
    this.say(`${name} sat down with $${this.buyIn}`);
    this.stats?.seated();
    this.touched = Date.now();
    return { player };
  }
  onDisconnect() {}
  rebuy(player, onTable) {
    if (player.bank + onTable >= this.buyIn / 2) return `Rebuy opens when you are under $${this.buyIn / 2}`;
    player.bank += this.buyIn; player.rebuys++;
    this.stats?.rebuy();
    this.say(`${player.name} bought in for another $${this.buyIn}`);
    return null;
  }
  common(player, msg) {
    if (msg.t === 'seed') return this.fair ? this.fair.setSeed(player.id, msg.seed) : null;
    if (msg.t === 'reveal') return this.fair ? this.fair.rotate() : null;
    return undefined;
  }
  base() {
    return { game: this.game, code: this.code, min: this.min, max: this.max, buyIn: this.buyIn, n: this.n, now: Date.now(), log: this.log, fair: this.fair ? this.fair.public() : null };
  }
}
