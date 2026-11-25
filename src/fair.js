// Provably fair outcomes: the server half. One instance per table.
// See shared/fair.js for the scheme; this file holds the secret seed and the roll log.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { combine, message, outcomeFromBytes, SEED_RE } from '../shared/fair.js';
import { WHEELS } from '../shared/roulette.js';
import { cardsFromBytes } from '../shared/cards.js';

const KEEP_EPOCHS = 20;
export const sha256hex = (text) => createHash('sha256').update(text).digest('hex');
export const hmac = (key, text) => new Uint8Array(createHmac('sha256', key).update(text).digest());

export class Fair {
  /** kind: 'craps' | 'yatzy' (five dice and a lucky die per roll) | 'european' | 'american' | 'cards6' | 'cards8' (a shoe of that many decks, reshuffled every round) */
  constructor(kind) {
    this.kind = kind;
    this.past = [];
    this.seeds = new Map();   // playerId -> seed sent since the current commitment
    this.id = 0;
    this.commit();
  }

  commit() {
    this.id++;
    this.serverSeed = randomBytes(32).toString('hex');
    this.hash = sha256hex(this.serverSeed);
    this.rolls = [];
    this.combos = {};
    this.seeds.clear();       // players contribute again, after they have seen the new commitment
  }

  /** A player's device contributes its seed. Returns an error string or null. */
  setSeed(playerId, seed) {
    if (typeof seed !== 'string' || !SEED_RE.test(seed)) return 'Seeds are 1-64 letters, digits, - or _';
    this.seeds.set(playerId, seed);
    return null;
  }
  dropPlayer(playerId) { this.seeds.delete(playerId); }

  /** Draw the next outcome: [d1, d2] for craps, a pocket string for roulette. */
  draw() {
    const seeds = [...this.seeds.values()].sort();
    const cs = sha256hex(combine(seeds));
    this.combos[cs] = seeds;
    const n = this.rolls.length + 1;
    const a = hmac(this.serverSeed, message(cs, n, 0)), b = hmac(this.serverSeed, message(cs, n, 1));
    const bytes = new Uint8Array(64); bytes.set(a); bytes.set(b, 32);
    const out = outcomeFromBytes(this.kind, bytes, WHEELS);
    if (out === null) throw new Error('fair: byte stream exhausted');   // chance below 1e-100
    this.rolls.push({ n, cs, out });
    return this.kind === 'craps' ? out.split('-').map(Number) : this.kind === 'yatzy' ? [...out].map(Number) : out;
  }

  /**
   * Card games: open a round and deal from it. Returns { next() -> card, close() }.
   * Each round is a freshly shuffled shoe; the cards dealt are appended to the roll log as they come out.
   */
  openRound() {
    const seeds = [...this.seeds.values()].sort(), cs = sha256hex(combine(seeds)), seed = this.serverSeed;
    this.combos[cs] = seeds;
    const decks = Number(this.kind.slice(5)), roll = { n: this.rolls.length + 1, cs, out: '', open: true };
    this.rolls.push(roll);
    const blocks = [];
    let dealt = 0;
    return {
      next() {
        for (;;) {
          const bytes = new Uint8Array(blocks.length * 32);
          blocks.forEach((b, i) => bytes.set(b, i * 32));
          const cards = cardsFromBytes(bytes, decks, dealt + 1);
          if (cards.length > dealt) { roll.out += cards[dealt]; return cards[dealt++]; }
          blocks.push(hmac(seed, message(cs, roll.n, blocks.length)));
        }
      },
      close() { delete roll.open; },
    };
  }
  get roundOpen() { return this.rolls.some((r) => r.open); }

  /** Reveal the current seed and commit to a new one. */
  rotate() {
    if (!this.rolls.length) return 'No rolls on this seed yet';
    if (this.roundOpen) return 'The seed can be revealed between rounds';
    this.past.unshift({ id: this.id, kind: this.kind, hash: this.hash, serverSeed: this.serverSeed, rolls: this.rolls, combos: this.combos });
    if (this.past.length > KEEP_EPOCHS) this.past.length = KEEP_EPOCHS;
    this.commit();
    return null;
  }

  /** Small summary that rides on every table snapshot. */
  public() {
    return {
      epoch: this.id, hash: this.hash, rolls: this.rolls.length, seeded: [...this.seeds.keys()],
      past: this.past.slice(0, 8).map((e) => ({ id: e.id, hash: e.hash, rolls: e.rolls.length })),
    };
  }

  /** Full roll log for one epoch. The seed is included only once it has been retired. */
  epochData(id) {
    // A round still being played keeps its cards hidden: the log would give away the dealer's hole card.
    if (id === this.id) return { id: this.id, kind: this.kind, hash: this.hash, serverSeed: null, rolls: this.rolls.filter((r) => !r.open), combos: this.combos };
    return this.past.find((e) => e.id === id) || null;
  }
}
