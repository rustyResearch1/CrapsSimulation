// Provably fair: the player's side. Sends this device's seed after each new commitment and
// lets the player verify revealed seeds in the browser. Uses h, store, toast from common.js.
'use strict';

const Fair = (() => {
  const seen = store.get('fair.seen') || {};      // "CODE:epoch" -> { hash first seen, seeds this device sent }
  const results = {};                             // "CODE:epoch" -> verification result
  let sentFor = null;
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const randomSeed = () => hex(crypto.getRandomValues(new Uint8Array(12)));
  const enc = new TextEncoder();
  const webCrypto = {
    sha256hex: async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text))),
    hmac: async (key, text) => {
      const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
    },
  };
  function remember() {
    const keys = Object.keys(seen);
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete seen[k];
    store.set('fair.seen', seen);
  }
  function sendSeed(state, send) {
    const key = state.code + ':' + state.fair.epoch, custom = (store.get('fair.custom') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
    // Always fresh randomness, chosen after the commitment was shown; a personal word is added in front if set.
    const seed = (custom ? custom + '-' : '') + randomSeed();
    seen[key].seeds.push(seed); remember();
    send({ t: 'seed', seed });
  }

  /** Call on every table snapshot. */
  function onState(state, send) {
    const f = state.fair;
    if (!f) return;
    const key = state.code + ':' + f.epoch;
    if (!seen[key]) { seen[key] = { hash: f.hash, seeds: [] }; remember(); }
    if (sentFor !== key) { sentFor = key; sendSeed(state, send); }
  }

  async function verify(state, id, rerender) {
    const key = state.code + ':' + id;
    results[key] = { busy: true }; rerender();
    try {
      const [{ verifyEpoch }, { WHEELS }, res] = await Promise.all([import('/shared/fair.js'), import('/shared/roulette.js'), fetch(`/api/fair?code=${state.code}&epoch=${id}`, { cache: 'no-store' })]);
      if (!res.ok) throw new Error('That seed is no longer kept by the server');
      const epoch = await res.json();
      const v = await verifyEpoch(epoch, webCrypto, WHEELS);
      const mine = seen[key], mySeeds = new Set(mine ? mine.seeds : []);
      results[key] = { ...v, epoch,
        sawHash: mine ? mine.hash === epoch.hash : null,     // same commitment this device was shown before the rolls?
        withMine: epoch.rolls.filter((r) => (epoch.combos[r.cs] || []).some((s) => mySeeds.has(s))).length };
    } catch (e) { results[key] = { error: e.message || 'Could not verify' }; }
    rerender();
  }

  const mono = 'font-family:ui-monospace,Menlo,monospace;font-size:11.5px;word-break:break-all;color:#d8e4dc;background:#0c1814;border:1px solid #233b31;border-radius:8px;padding:8px;margin:4px 0 0';
  function resultNode(r) {
    if (!r) return null;
    if (r.busy) return h('div', { class: 'csub', style: 'margin:6px 0 0' }, 'Checking…');
    if (r.error) return h('div', { class: 'neg', style: 'font-size:13px;margin:6px 0 0' }, r.error);
    const ok = r.hashOk && r.seedsOk && r.bad.length === 0 && r.sawHash !== false;
    const lines = [
      r.hashOk ? 'The revealed seed matches the commitment.' : 'FAILED: the revealed seed does not match the commitment.',
      r.sawHash === true ? 'It is the same commitment this device was shown before any result.' : r.sawHash === false ? 'FAILED: this device was shown a different commitment before any result.' : 'This device joined after that seed was committed, so it did not see the commitment first.',
      r.bad.length ? `FAILED: ${r.bad.length} of ${r.checked} results do not recompute (number ${r.bad.slice(0, 5).join(', ')}).` : r.checked === 1 ? 'The 1 result recomputes exactly from the seed.' : `All ${r.checked} results recompute exactly from the seed.`,
      r.seedsOk ? `Your seed was mixed into ${r.withMine} of ${r.checked}.` : 'FAILED: the player seeds do not match their hash.',
    ];
    return h('div', { style: 'margin:8px 0 0' },
      h('div', { class: ok ? 'pos' : 'neg', style: 'font-weight:800;font-size:14px' }, ok ? 'Verified' : 'Verification failed'),
      h('ul', { class: 'read', style: 'margin-top:4px' }, lines.map((t) => h('li', { style: 'font-size:13px;margin:3px 0' }, t))),
      h('div', { class: 'csub', style: 'margin:6px 0 0' }, 'Revealed server seed'), h('div', { style: mono }, r.epoch.serverSeed));
  }

  /** The sheet body. `rerender` redraws the sheet after an async step. */
  function sheet(state, myId, send, rerender) {
    const f = state.fair, unit = state.shoe && state.shoe.mode === 'shoe' ? 'shoe' : ({ roulette: 'spin', blackjack: 'hand', baccarat: 'coup' })[state.game] || 'roll';
    const g = h('div', { class: 'guide' });
    if (!f) { g.append(h('p', null, 'This table is not using verifiable dice.')); return g; }
    const mineIn = f.seeded.includes(myId);
    const input = h('input', { class: 'in', maxlength: 30, placeholder: 'optional, e.g. lucky7', value: store.get('fair.custom') || '',
      style: 'width:100%;padding:10px 11px;border-radius:9px;border:1px solid #33503f;background:#0c1814;color:var(--ink);font-size:16px' });
    g.append(
      h('p', null, `Every ${unit} comes from a secret server seed that was locked in before you bet, mixed with a seed from each player's device. When the seed is retired it is revealed, and you can recompute every ${unit} yourself.`),
      h('h3', null, 'Current seed'),
      h('p', null, `Commitment: the SHA-256 hash of the hidden seed. ${f.rolls} ${unit}${f.rolls === 1 ? '' : 's'} so far.`),
      h('div', { style: mono }, f.hash),
      h('p', null, mineIn ? `Your device's seed is mixed in, along with ${f.seeded.length - 1} other player${f.seeded.length === 2 ? '' : 's'}.` : 'Your device has not sent a seed for this one yet.'),
      h('button', { class: 'btn ghost', type: 'button', disabled: !f.rolls, style: 'margin-top:6px;opacity:' + (f.rolls ? 1 : 0.5),
        on: { click: () => send({ t: 'reveal' }) } }, f.rolls ? 'Reveal this seed and start a new one' : `Reveal opens after the first ${unit}`),
      h('h3', null, 'Revealed seeds'));
    if (!f.past.length) g.append(h('p', null, state.shoe && state.shoe.mode === 'shoe' ? 'None yet. The seed is revealed each time the shoe is shuffled.' : state.game === 'roulette' ? 'None yet. A seed is retired every 10 spins.' : state.game === 'blackjack' ? 'None yet. A seed is retired every 8 hands.' : state.game === 'baccarat' ? 'None yet. A seed is retired every 10 coups.' : state.game === 'yatzy' ? 'None yet. A seed is retired every few turns and at the end of the game.' : 'None yet. A seed is retired at the end of each shooter\'s hand.'));
    for (const e of f.past) {
      const key = state.code + ':' + e.id;
      g.append(h('div', { style: 'border-top:1px solid #20362d;padding:10px 0' },
        h('div', { style: 'display:flex;align-items:center;gap:8px' },
          h('b', { style: 'flex:1;font-size:14px' }, `Seed ${e.id} · ${e.rolls} ${unit}${e.rolls === 1 ? '' : 's'}`),
          h('button', { class: 'hbtn', type: 'button', on: { click: () => verify(state, e.id, rerender) } }, results[key] && !results[key].busy ? 'Check again' : 'Verify')),
        resultNode(results[key])));
    }
    g.append(
      h('h3', null, 'Your seed'),
      h('p', null, 'Your device sends fresh random characters after each new commitment. Add a word of your own in front if you like.'),
      h('div', { style: 'display:flex;gap:8px' }, input,
        h('button', { class: 'hbtn', type: 'button', on: { click: () => { store.set('fair.custom', input.value.trim()); sendSeed(state, send); toast('Seed sent'); } } }, 'Use')),
      h('h3', null, 'Check it without trusting this page'),
      h('ul', null,
        h('li', null, 'SHA-256 of the revealed seed (as text) must equal the commitment.'),
        h('li', null, 'Client hash = SHA-256 of all player seeds, sorted and joined with "|".'),
        h('li', null, `Each ${unit} = HMAC-SHA256(key: server seed, message: "clientHash:number:0"), then ":1" appended the same way.`),
        h('li', null, state.game === 'roulette' ? 'Read 4 bytes at a time as a number; skip any at or above the largest multiple of the wheel size; pocket = wheel order[number mod size].'
          : 'Read byte by byte; skip any byte of 252 or more; each die = (byte mod 6) + 1.')),
      h('p', null, 'What this proves: the server could not change or pick the outcome after bets were placed. It relies on the seats at your table being real players, which you can see. Long-run fairness of the dice is tested separately on the House page.'));
    return g;
  }

  return { onState, sheet };
})();
