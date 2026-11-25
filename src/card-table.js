// Shared plumbing for the card tables: seats, bankrolls, the log, the fair shoe.
import { randomBytes } from 'node:crypto';
import { Fair } from './fair.js';

export const MAX_PLAYERS = 8;
const LOG = 40;

export class CardTable {
  constructor(game, code, { decks, min = 5, max = 5000, buyIn = 1000, stats = null, cards = null, shoe = 'hand' } = {}) {
    this.game = game; this.code = code; this.min = min; this.max = max; this.buyIn = buyIn; this.stats = stats;
    // Tests may inject a fixed list of cards; live tables deal from a committed, verifiable shoe.
    this.fair = cards ? null : new Fair('cards' + decks);
    this.fixed = cards;
    // 'hand': a fresh shuffle every round. 'shoe': one shuffle is dealt hand after hand until the cut card comes out.
    this.mode = shoe === 'shoe' ? 'shoe' : 'hand';
    this.decks = decks; this.cut = Math.floor(decks * 52 * 0.75); this.live = null; this.dealt = 0; this.shoeNo = 0;
    this.players = []; this.log = []; this.n = 0; this.seq = 0; this.touched = Date.now();
  }
  player(id) { return this.players.find((p) => p.id === id) || null; }
  say(text) { this.log.unshift(text); if (this.log.length > LOG) this.log.length = LOG; }
  openShoe() {
    if (this.fixed) { const list = this.fixed; return { next: () => list.shift(), close() {} }; }
    if (this.mode === 'hand') return this.fair.openRound();
    if (!this.live) {                       // shuffle: the whole shoe order is fixed by the seed committed before this point
      this.live = this.fair.openRound(); this.dealt = 0; this.shoeNo++;
      this.say(`Shuffle: new ${this.decks}-deck shoe`);
    }
    const t = this;
    return {
      next() { if (++t.dealt === t.cut + 1) t.say('The cut card is out: last hand of this shoe'); return t.live.next(); },
      // Once the cut card is out the shoe is finished after the round, and its seed is revealed straight away.
      close() { if (t.dealt >= t.cut) { t.live.close(); t.live = null; t.fair.rotate(); } },
    };
  }
  /** Retire the seed every few rounds so it can be revealed and checked. A shoe is revealed when it is finished instead. */
  maybeRotate(every) { if (this.mode === 'hand' && this.fair && !this.fair.roundOpen && this.fair.rolls.length >= every) this.fair.rotate(); }

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
    if (msg.t === 'reveal') return !this.fair ? null : this.live ? 'This seed is revealed when the shoe is shuffled' : this.fair.rotate();
    return undefined;
  }
  base() {
    return { game: this.game, code: this.code, min: this.min, max: this.max, buyIn: this.buyIn, n: this.n, now: Date.now(), log: this.log, fair: this.fair ? this.fair.public() : null,
      shoe: { mode: this.mode, decks: this.decks, total: this.decks * 52, left: this.decks * 52 - (this.mode === 'shoe' && this.live ? this.dealt : 0), cutAt: this.decks * 52 - this.cut, no: this.shoeNo, last: !!this.live && this.dealt >= this.cut } };
  }
}
