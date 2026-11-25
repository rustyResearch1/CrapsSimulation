// One Yatzy table: a 1v1 match (or solo practice). No chips: the score card is the game.
// Every roll draws six values from the fair stream: five dice and a "lucky die".
// Only the dice that are not held take their new value. A 6 on the lucky die on the first
// roll of a turn banks a bonus roll.
import { randomBytes } from 'node:crypto';
import { Fair } from './fair.js';
import { CATS, NAMES, ROLLS, START_BANK, MAX_BANK, score, totals, isYatzy } from '../shared/yatzy.js';

export const MAX_PLAYERS = 2;
const LOG = 40;

export class YatzyTable {
  constructor(code, { stats = null, rolls = null } = {}) {
    this.game = 'yatzy'; this.code = code; this.stats = stats;
    this.fair = rolls ? null : new Fair('yatzy');
    this.fixed = rolls;                    // tests may inject rolls: arrays of six values
    this.players = []; this.log = []; this.touched = Date.now();
    this.phase = 'wait'; this.games = 0; this.seq = 0; this.turn = null; this.winner = null; this.last = null; this.scored = null;
    this.resetTurn();
  }
  player(id) { return this.players.find((p) => p.id === id) || null; }
  say(text) { this.log.unshift(text); if (this.log.length > LOG) this.log.length = LOG; }
  resetTurn() { this.dice = [0, 0, 0, 0, 0]; this.held = [false, false, false, false, false]; this.used = 0; }
  draw() { return this.fixed ? this.fixed.shift() : this.fair.draw(); }

  addPlayer(rawName) {
    if (this.players.length >= MAX_PLAYERS) return { error: 'This Yatzy table already has two players' };
    let name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name} 2`.slice(0, 14);
    const player = { id: randomBytes(6).toString('hex'), token: randomBytes(16).toString('hex'), name, connected: true, seenAt: Date.now(), card: {}, extra: 0, bank: START_BANK, wins: 0 };
    this.players.push(player);
    this.say(`${name} sat down`);
    this.stats?.seated();
    this.touched = Date.now();
    if (this.players.length === 2) this.newGame();          // a second player always starts a fresh 1v1
    return { player };
  }
  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    this.fair?.dropPlayer(id);
    this.say(`${gone.name} left the table`);
    this.phase = 'wait'; this.turn = null; this.winner = null; this.resetTurn();
  }
  clear() { return null; }
  onDisconnect() {}

  newGame() {
    for (const p of this.players) { p.card = {}; p.extra = 0; p.bank = START_BANK; }
    this.phase = 'play'; this.winner = null; this.scored = null; this.last = null;
    this.turn = this.players[this.games % this.players.length].id;
    this.games++;
    this.resetTurn();
    this.say(this.players.length === 2 ? `New game: ${this.player(this.turn).name} rolls first` : 'Solo practice game');
  }

  act(player, msg) {
    this.touched = Date.now(); player.seenAt = Date.now();
    if (msg.t === 'seed') return this.fair ? this.fair.setSeed(player.id, msg.seed) : null;
    if (msg.t === 'reveal') return this.fair ? this.fair.rotate() : null;
    if (msg.t === 'start' || msg.t === 'rematch') {
      if (this.phase === 'play') return 'A game is in progress';
      this.newGame();
      return null;
    }
    if (this.phase !== 'play') return 'No game in progress';
    if (player.id !== this.turn) return `It is ${this.player(this.turn).name}'s turn`;
    switch (msg.t) {
      case 'hold': {
        if (!this.used) return 'Roll first';
        if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i > 4) return 'Bad die';
        this.held[msg.i] = !this.held[msg.i];
        return null;
      }
      case 'roll': {
        const bonus = this.used >= ROLLS;
        if (bonus && !player.bank) return 'No rolls left: pick a box to score';
        if (this.used && this.held.every(Boolean)) return 'Release a die to roll again';
        const out = this.draw(), idx = [];
        for (let i = 0; i < 5; i++) if (!this.used || !this.held[i]) { this.dice[i] = out[i]; idx.push(i); }
        if (!this.used) this.held = [false, false, false, false, false];
        if (bonus) player.bank--;
        const lucky = !this.used && out[5] === 6 && player.bank < MAX_BANK;
        if (lucky) { player.bank++; this.say(`${player.name} got a lucky bonus roll`); }
        this.used++;
        this.last = { seq: ++this.seq, by: player.id, idx, lucky, bonus };
        return null;
      }
      case 'score': {
        if (!this.used) return 'Roll first';
        if (!CATS.includes(msg.cat)) return 'Unknown box';
        if (player.card[msg.cat] !== undefined) return 'That box is already filled';
        const pts = score(msg.cat, this.dice);
        const again = isYatzy(this.dice) && player.card.yatzy === 50 && msg.cat !== 'yatzy';   // a second Yatzy: +100
        if (again) player.extra++;
        player.card[msg.cat] = pts;
        this.scored = { seq: ++this.seq, by: player.id, cat: msg.cat, pts, again };
        this.say(`${player.name}: ${pts} in ${NAMES[msg.cat]}${again ? ' + 100 Yatzy bonus' : ''}`);
        this.next();
        return null;
      }
      default: return 'Unknown action';
    }
  }

  next() {
    this.resetTurn();
    if (this.players.every((p) => totals(p.card).filled === CATS.length)) {
      const t = this.players.map((p) => totals(p.card, p.extra).total), best = Math.max(...t);
      const top = this.players.filter((_, i) => t[i] === best);
      this.winner = top.length === 1 ? top[0].id : 'tie';
      if (top.length === 1 && this.players.length === 2) top[0].wins++;
      this.phase = 'over'; this.turn = null;
      this.say(this.players.length === 1 ? `Final score ${best}` : top.length === 1 ? `${top[0].name} wins ${Math.max(...t)} to ${Math.min(...t)}` : `Tie game at ${best}`);
      if (this.fair && this.fair.rolls.length) this.fair.rotate();
      return;
    }
    const i = this.players.findIndex((p) => p.id === this.turn);
    this.turn = this.players[(i + 1) % this.players.length].id;
    if (this.fair && this.fair.rolls.length >= 16) this.fair.rotate();   // retire the seed every few turns so it can be checked mid-game
  }

  snapshot() {
    return {
      game: this.game, code: this.code, now: Date.now(), log: this.log, fair: this.fair ? this.fair.public() : null,
      phase: this.phase, turn: this.turn, dice: this.dice, held: this.held, used: this.used, rolls: ROLLS, winner: this.winner, games: this.games,
      last: this.last, scored: this.scored,
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, card: p.card, extra: p.extra, bank: p.bank, wins: p.wins })),
    };
  }
}
