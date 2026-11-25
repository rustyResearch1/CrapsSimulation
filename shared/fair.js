// Provably fair outcomes: the pure half, shared by the server and the browser verifier.
//
// Scheme (commit - contribute - reveal):
//   1. The server picks a secret serverSeed and publishes commitment = SHA-256(serverSeed).
//   2. After seeing the commitment, each player's device sends a seed of its own.
//      clientHash = SHA-256(all player seeds, sorted, joined with "|").
//   3. Roll number `nonce` is drawn from
//        HMAC-SHA256(key = serverSeed, message = "clientHash:nonce:0") followed by "...:nonce:1"
//      and turned into dice or a pocket by the functions below.
//      Card games deal each round from a freshly shuffled shoe: blocks ":0", ":1", ":2"... are read
//      four bytes at a time to pick each card from those remaining (see cards.js).
//   4. When the seed is retired the server reveals it. Anyone can check that it hashes to the
//      commitment and recompute every roll.
// The server cannot change its seed after committing, and cannot have chosen it to suit seeds
// it had not yet seen. Hashes and seeds are plain text (hex), so any tool can reproduce them.

import { cardsFromBytes } from './cards.js';

/** Canonical form of the players' seeds before hashing. */
export const combine = (seeds) => [...seeds].sort().join('|');
export const message = (clientHash, nonce, block) => `${clientHash}:${nonce}:${block}`;
export const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Two dice from a byte stream. A byte is used only if below 252 (= 42 x 6), so each face is exactly equally likely. */
export function diceFromBytes(bytes) {
  const dice = [];
  for (const b of bytes) {
    if (b >= 252) continue;
    dice.push((b % 6) + 1);
    if (dice.length === 2) return dice;
  }
  return null;
}

/** A pocket from a byte stream: 4 bytes at a time as an unsigned integer, rejected above the largest multiple of the wheel size. */
export function pocketFromBytes(bytes, wheelOrder) {
  const n = wheelOrder.length, limit = Math.floor(4294967296 / n) * n;
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const v = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    if (v < limit) return wheelOrder[v % n];
  }
  return null;
}

/** kind: 'craps' | 'european' | 'american'. Returns the outcome as recorded in the roll log ("3-4" or "17"). */
export function outcomeFromBytes(kind, bytes, wheels) {
  if (kind === 'craps') { const d = diceFromBytes(bytes); return d && `${d[0]}-${d[1]}`; }
  return pocketFromBytes(bytes, wheels[kind]);
}

/**
 * Check a revealed epoch. `crypto` supplies { sha256hex(text), hmac(keyText, text) -> Uint8Array }, sync or async,
 * so the same code runs on Node and on WebCrypto.
 * epoch: { kind, hash, serverSeed, rolls: [{ n, cs, out }], combos: { clientHash: [seeds] } }
 * Returns { hashOk, checked, bad: [nonces], seedsOk }.
 */
export async function verifyEpoch(epoch, crypto, wheels) {
  const hashOk = (await crypto.sha256hex(epoch.serverSeed)) === epoch.hash;
  let seedsOk = true;
  for (const [cs, seeds] of Object.entries(epoch.combos)) {
    if ((await crypto.sha256hex(combine(seeds))) !== cs) seedsOk = false;
  }
  const bad = [];
  const cat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  for (const r of epoch.rolls) {
    if (!epoch.combos[r.cs]) { bad.push(r.n); continue; }
    const blocks = [];
    const more = async () => blocks.push(await crypto.hmac(epoch.serverSeed, message(r.cs, r.n, blocks.length)));
    if (epoch.kind.startsWith('cards')) {
      // the roll log holds the cards dealt that round, two characters each
      const decks = Number(epoch.kind.slice(5)), want = r.out.length / 2;
      let cards = [];
      while (cards.length < want && blocks.length < 400) { await more(); cards = cardsFromBytes(cat(blocks), decks, want); }
      if (cards.join('') !== r.out) bad.push(r.n);
    } else {
      await more(); await more();
      if (outcomeFromBytes(epoch.kind, cat(blocks), wheels) !== r.out) bad.push(r.n);
    }
  }
  return { hashOk, seedsOk, checked: epoch.rolls.length, bad };
}
