// One baccarat table. Everyone bets on the same coup; anyone seated can deal.
import { CardTable } from './card-table.js';
import { DECKS, playOut, outcome, resolve, checkPlace, label, BETS, PROB, EDGE } from '../shared/baccarat.js';

export const DEAL_GAP_MS = 4100;   // the longest dealing animation (six cards); no new coup until the cards are down
const CARD_MS = 720;
const sum = (bets) => Object.values(bets).reduce((s, v) => s + v, 0);

export class BaccaratTable extends CardTable {
  constructor(code, opts = {}) {
    super('baccarat', code, { decks: DECKS, ...opts });
    this.history = []; this.last = null; this.dealAt = 0; this.gap = 0;
  }
  newSeat() { return { bets: {}, lastBets: {} }; }
  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    this.fair?.dropPlayer(id);
    this.say(`${gone.name} left the table`);
  }
  clear(player) { player.bank += sum(player.bets); player.bets = {}; return null; }

  act(player, msg) {
    this.touched = Date.now(); player.seenAt = Date.now();
    const c = this.common(player, msg);
    if (c !== undefined) return c;
    switch (msg.t) {
      case 'bet': {
        if (msg.amt > player.bank) return 'Not enough chips';
        const err = checkPlace({ min: this.min, max: this.max }, player.bets, msg.key, msg.amt);
        if (err) return err;
        player.bets[msg.key] = (player.bets[msg.key] || 0) + msg.amt; player.bank -= msg.amt;
        return null;
      }
      case 'remove': {
        const have = typeof msg.key === 'string' ? player.bets[msg.key] || 0 : 0;
        if (!have) return 'No bet there';
        const take = msg.amt === undefined ? have : msg.amt;
        if (!Number.isInteger(take) || take <= 0) return 'Bad amount';
        const back = Math.min(take, have);
        if (have - back) player.bets[msg.key] = have - back; else delete player.bets[msg.key];
        player.bank += back;
        return null;
      }
      case 'clear': return this.clear(player);
      case 'repeat': {
        let placed = 0;
        for (const [key, amt] of Object.entries(player.lastBets)) {
          if (player.bets[key] || amt > player.bank || checkPlace({ min: this.min, max: this.max }, player.bets, key, amt)) continue;
          player.bets[key] = amt; player.bank -= amt; placed++;
        }
        return placed ? null : 'No bets to repeat';
      }
      case 'deal': return this.deal(player);
      case 'rebuy': return this.rebuy(player, sum(player.bets));
      default: return 'Unknown action';
    }
  }

  deal(by) {
    if (Date.now() - this.dealAt < this.gap) return 'The cards are still being dealt';
    if (!this.players.some((p) => sum(p.bets) > 0)) return 'Place a bet before dealing';
    const shoe = this.openShoe();
    const { player, banker } = playOut(() => shoe.next());
    shoe.close();
    const o = outcome(player, banker);
    this.n++; this.dealAt = Date.now(); this.gap = (player.length + banker.length - 1) * CARD_MS + 500;

    const results = {}, fam = {};
    const main = { player: 0, banker: 0, tie: 0 };          // house result on the main bets, by winner
    let handle = 0, hold = 0, expected = 0, variance = 0;
    for (const p of this.players) {
      if (!sum(p.bets)) { p.lastNet = 0; continue; }
      p.lastBets = { ...p.bets };
      const r = resolve(p.bets, o);
      for (const [key, amt] of Object.entries(p.bets)) {
        const f = fam[label(key)] || (fam[label(key)] = { n: 0, handle: 0, hold: 0, expected: 0, variance: 0 });
        const e = r.events.find((x) => x.key === key), x = e.result === 'win' ? -e.amount : e.result === 'lose' ? amt : 0;
        f.n++; f.handle += amt; f.hold += x; f.expected += amt * EDGE[key];
        handle += amt; hold += x; expected += amt * EDGE[key];
        if (key === 'ppair' || key === 'bpair') { const v = amt * amt * (PROB.pair * 121 + (1 - PROB.pair) - EDGE[key] ** 2); f.variance += v; variance += v; }
        else for (const w of ['player', 'banker', 'tie']) main[w] += resolve({ [key]: amt }, { winner: w }).net * -1;
      }
      p.bets = {}; p.bank += r.returned; p.lastNet = r.net;
      results[p.id] = { net: r.net, events: r.events.map((e) => ({ key: e.key, label: label(e.key), result: e.result, amount: e.amount })) };
    }
    // Main bets ride on one three-way outcome, so their variance is taken together.
    const mean = PROB.player * main.player + PROB.banker * main.banker + PROB.tie * main.tie;
    variance += PROB.player * main.player ** 2 + PROB.banker * main.banker ** 2 + PROB.tie * main.tie ** 2 - mean * mean;
    this.stats?.round('baccarat', {}, { handle, hold, expected, variance, families: fam });

    const said = o.winner === 'tie' ? `Tie, ${o.pTotal} all` : `${o.winner === 'player' ? 'Player' : 'Banker'} wins, ${Math.max(o.pTotal, o.bTotal)} over ${Math.min(o.pTotal, o.bTotal)}`;
    this.say(`${by.name} dealt: ${said}`);
    this.history.unshift(o.winner[0].toUpperCase()); if (this.history.length > 60) this.history.length = 60;
    this.last = { n: this.n, player, banker, ...o, call: said, results };
    this.maybeRotate(10);
    return null;
  }

  snapshot() {
    return { ...this.base(), dealGapMs: DEAL_GAP_MS, history: this.history, last: this.last,
      players: this.players.map((p) => ({ id: p.id, name: p.name, bank: p.bank, bets: p.bets, connected: p.connected, rebuys: p.rebuys, lastNet: p.lastNet, canRepeat: Object.keys(p.lastBets).length > 0 })) };
  }
}
export { BETS };
