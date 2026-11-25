// The House: live telemetry from /api/house, read from the casino's side of the table.
import { S, txt, niceTicks, compact, placeTip, num, usd, susd, pct } from '/charts.js';

// ---------- statistics ----------
function lgamma(x) {   // Lanczos
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x, t = x + 5.5, ser = 1.000000000190015;
  t -= (x + 0.5) * Math.log(t);
  for (const cj of c) ser += cj / ++y;
  return -t + Math.log((2.5066282746310005 * ser) / x);
}
/** Upper regularised incomplete gamma Q(a, x): the chi-square tail is Q(df/2, x/2). */
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) { let sum = 1 / a, term = sum; for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (term < sum * 1e-12) break; } return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, hh = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; hh *= del; if (Math.abs(del - 1) < 1e-12) break; }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * hh;
}
/** Chi-square goodness of fit. Returns null until every cell expects at least 5 observations. */
function chiSquare(observed, expectedShare) {
  const n = observed.reduce((s, v) => s + v, 0);
  if (!n || Math.min(...expectedShare) * n < 5) return { n, need: Math.ceil(5 / Math.min(...expectedShare)) };
  let x = 0;
  observed.forEach((o, i) => { const e = expectedShare[i] * n; x += (o - e) ** 2 / e; });
  const df = observed.length - 1;
  return { n, x, df, p: gammaQ(df / 2, x / 2) };
}
const zOf = (g) => (g.variance > 0 ? (g.hold - g.expected) / Math.sqrt(g.variance) : 0);
const verdict = (p) => (p > 0.05 ? 'consistent with fair' : p > 0.001 ? 'unusual, keep watching' : 'not consistent with fair');

// ---------- charts ----------
function holdChart(d, width) {
  const W = Math.max(300, width), H = 240, m = { l: 50, r: 12, t: 8, b: 26 };
  const pts = d.series, n = pts.at(-1)[0];
  const hi2 = pts.map((p) => p[2] + 2 * Math.sqrt(p[3])), lo2 = pts.map((p) => p[2] - 2 * Math.sqrt(p[3]));
  let lo = Math.min(0, ...lo2, ...pts.map((p) => p[1])), hi = Math.max(0, ...hi2, ...pts.map((p) => p[1]));
  const pad = (hi - lo || 10) * 0.06; lo -= pad; hi += pad;
  const x = (r) => m.l + (r / n) * (W - m.l - m.r), y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const line = (f) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(f(p, i)).toFixed(1)}`).join('');
  const band = line((p, i) => hi2[i]) + pts.map((p, i) => [x(p[0]), y(lo2[i])]).reverse().map(([a, b]) => `L${a.toFixed(1)} ${b.toFixed(1)}`).join('') + 'Z';
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Cumulative house win against expectation' });
  for (const v of niceTicks(lo, hi, 4)) svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'var(--grid)' }), txt(m.l - 6, y(v) + 3.5, compact(v), { 'text-anchor': 'end' }));
  svg.append(txt(m.l, H - 8, 'first bet'), txt(W - m.r, H - 8, `round ${num(n)}`, { 'text-anchor': 'end' }),
    S('path', { d: band, fill: 'var(--s-blue)', opacity: 0.2 }),
    S('path', { d: line((p) => p[2]), fill: 'none', stroke: 'var(--dim)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }),
    S('path', { d: line((p) => p[1]), fill: 'none', stroke: 'var(--s-blue)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  const cross = S('line', { y1: m.t, y2: H - m.b, stroke: 'var(--ink)', opacity: 0 }), dot = S('circle', { r: 4, fill: 'var(--s-blue)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 });
  svg.append(cross, dot);
  const tip = h('div', { class: 'tip' }), box = h('div', { class: 'chart' }, svg, tip);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect(), target = (((ev.clientX - rect.left) * (W / rect.width) - m.l) / (W - m.l - m.r)) * n;
    let i = 0; for (let k = 1; k < pts.length; k++) if (Math.abs(pts[k][0] - target) < Math.abs(pts[i][0] - target)) i = k;
    const p = pts[i], sd = Math.sqrt(p[3]);
    cross.setAttribute('x1', x(p[0])); cross.setAttribute('x2', x(p[0])); cross.setAttribute('opacity', 0.35);
    dot.setAttribute('cx', x(p[0])); dot.setAttribute('cy', y(p[1])); dot.setAttribute('opacity', 1);
    tip.replaceChildren(h('b', null, `After ${num(p[0])} rounds`), h('br'), h('span', null, 'House win  '), h('b', null, susd(p[1])), h('br'), h('span', null, 'Expected  '), susd(p[2]), h('br'),
      h('span', null, 'Normal range  '), `${susd(p[2] - 2 * sd)} to ${susd(p[2] + 2 * sd)}`);
    placeTip(tip, box, (x(p[0]) / W) * rect.width, 4);
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.style.opacity = 0; });
  return box;
}

function diceChart(totals, width) {
  const W = Math.max(300, width), H = 190, m = { l: 10, r: 10, t: 14, b: 24 };
  const n = totals.reduce((s, v) => s + v, 0), share = (t) => (6 - Math.abs(7 - t)) / 36;
  const peak = Math.max(...totals.slice(2).map((v, i) => Math.max(v, share(i + 2) * n))), slot = (W - m.l - m.r) / 11, bw = Math.min(24, slot - 2), base = H - m.b;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Dice totals rolled against expected' });
  svg.append(S('line', { x1: m.l, x2: W - m.r, y1: base, y2: base, stroke: 'var(--grid)' }));
  const tip = h('div', { class: 'tip' }), box = h('div', { class: 'chart' }, svg, tip);
  for (let t = 2; t <= 12; t++) {
    const cx = m.l + (t - 2) * slot + slot / 2, c = totals[t], e = share(t) * n;
    const hgt = c ? Math.max(3, (c / peak) * (base - m.t)) : 0, ey = base - (e / peak) * (base - m.t);
    const bar = S('path', { d: hgt ? `M${cx - bw / 2} ${base}v${-(hgt - 3)}q0 -3 3 -3h${bw - 6}q3 0 3 3v${hgt - 3}z` : '', fill: 'var(--s-blue)' });
    const hit = S('rect', { x: cx - slot / 2, y: m.t, width: slot, height: base - m.t, fill: 'transparent' });
    const show = () => { bar.setAttribute('opacity', 0.75); tip.replaceChildren(h('b', null, `Total ${t}`), h('br'), `${num(c)} rolled (${pct(c / n)})`, h('br'), h('span', null, `expected ${num(e, 1)} (${pct(share(t))})`)); placeTip(tip, box, (cx / W) * svg.getBoundingClientRect().width, 0); };
    hit.addEventListener('pointerenter', show); hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { bar.setAttribute('opacity', 1); tip.style.opacity = 0; });
    svg.append(bar, S('line', { x1: cx - bw / 2 - 3, x2: cx + bw / 2 + 3, y1: ey, y2: ey, stroke: 'var(--ink)', 'stroke-width': 2, 'pointer-events': 'none' }), txt(cx, H - 8, t, { 'text-anchor': 'middle' }), hit);
  }
  return box;
}

// ---------- page ----------
const tile = (k, v, s, cls) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 's' }, s));
const panel = (...kids) => h('div', { class: 'panel' }, ...kids);
let data = null;

function render() {
  const el = $('#out'), d = data;
  if (!d) return;
  const games = Object.entries(d.games), all = { handle: 0, hold: 0, expected: 0, variance: 0, rounds: 0 };
  for (const [, g] of games) { all.handle += g.handle; all.hold += g.hold; all.expected += g.expected; all.variance += g.variance; all.rounds += g.rounds; }
  const live = h('p', { class: 'live' }, h('i'), `Live since ${new Date(d.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · updates every 10 seconds`,
    d.persistent ? '' : ' · storage is not writable, so these figures reset on restart');
  if (!all.handle) {
    el.replaceChildren(live, panel(h('h2', null, 'No bets decided yet'), h('p', { class: 'method', style: 'font-size:13.5px;color:#d8e4dc' },
      'Open a table and play a few rounds. Every roll and spin from then on is counted here: handle, hold, theoretical hold, and whether the dice and wheel are behaving.')));
    return;
  }
  const z = zOf(all), sd = Math.sqrt(all.variance), width = el.clientWidth - 30;
  const tiles = h('div', { class: 'tiles' },
    tile('Handle', usd(all.handle), `total of bets decided over ${num(all.rounds)} rolls, spins and deals`),
    tile('House win', susd(all.hold), `the hold: what players lost, net`, all.hold >= 0 ? 'pos' : 'neg'),
    tile('Hold', pct(all.hold / all.handle, 2), `theory says ${pct(all.expected / all.handle, 2)} for this mix of bets`),
    tile('Expected win', susd(all.expected), `± ${usd(sd)} standard deviation`),
    tile('Luck', `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(2)} SD`, Math.abs(z) < 2 ? `within the normal range; the house ran ${z >= 0 ? 'slightly hot' : 'slightly cold'}` : `outside the usual ±2 SD: ${z > 0 ? 'the house ran hot' : 'the players ran hot'}`),
    tile('Traffic', num((d.tables.craps || 0) + (d.tables.roulette || 0)), `tables opened · ${num(d.seats)} seats taken · ${num(d.rebuys)} rebuys`));

  const chart = panel(h('p', { class: 'ctitle' }, 'House win over time'),
    h('p', { class: 'csub' }, 'Cumulative hold after each round with money at risk, against the theoretical expectation.'),
    h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--s-blue);height:3px' }), 'Actual'), h('span', null, h('i', { style: 'background:var(--dim);height:2px' }), 'Expected'),
      h('span', null, h('i', { style: 'background:var(--s-blue);opacity:.3' }), 'Normal range (±2 SD)')),
    d.series.length > 1 ? holdChart(d, width) : null);

  const head = h('tr', null, ['Bet', 'Decisions', 'Handle', 'House win', 'Hold', 'Theory', 'Luck'].map((t) => h('th', null, t)));
  const row = (name, g, n, strong) => h('tr', strong ? { style: 'font-weight:800' } : null, h('td', null, name), h('td', null, num(n)), h('td', null, usd(g.handle)),
    h('td', { class: g.hold >= 0 ? '' : 'neg' }, susd(g.hold)), h('td', null, g.handle ? pct(g.hold / g.handle, 2) : '–'), h('td', null, g.handle ? pct(g.expected / g.handle, 2) : '–'),
    h('td', null, g.variance > 0 ? `${zOf(g) >= 0 ? '+' : '−'}${Math.abs(zOf(g)).toFixed(2)}` : '–'));
  const table = h('table', { class: 'st wide' }, head);
  for (const [name, g] of games) {
    table.append(h('tr', { class: 'sec' }, h('td', { colspan: 7 }, `${name} · ${num(g.rounds)} ${({ craps: 'rolls', roulette: 'spins', blackjack: 'rounds', baccarat: 'coups' })[name] || 'rounds'}`)));
    for (const [fam, f] of Object.entries(g.families).sort((a, b) => b[1].handle - a[1].handle)) table.append(row(fam, f, f.n));
    table.append(row(`All ${name}`, g, Object.values(g.families).reduce((s, f) => s + f.n, 0), true));
  }
  const byBet = panel(h('h2', null, 'By bet'), h('p', { class: 'csub' }, 'Hold is house win as a share of handle. Theory is the edge these bets carry. Luck is how many standard deviations actual sits from expected.'), h('div', { class: 'scroll' }, table));

  const fair = panel(h('h2', null, 'Are the dice and wheel fair?'));
  const diceN = d.dice.totals.reduce((s, v) => s + v, 0);
  if (diceN) {
    const tot = chiSquare(d.dice.totals.slice(2), Array.from({ length: 11 }, (_, i) => (6 - Math.abs(5 - i)) / 36)), face = chiSquare(d.dice.faces.slice(1), Array(6).fill(1 / 6));
    const line = (label, c) => h('li', null, c.p == null ? `${label}: needs about ${num(c.need)} rolls for a meaningful test (${num(diceN)} so far).`
      : `${label}: chi-square ${c.x.toFixed(1)} on ${c.df} degrees of freedom, p = ${c.p.toFixed(3)} — ${verdict(c.p)}.`);
    fair.append(h('p', { class: 'ctitle' }, `Dice totals over ${num(diceN)} rolls`), h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--s-blue)' }), 'Rolled'), h('span', null, h('i', { style: 'background:var(--ink);height:2px' }), 'Expected')),
      diceChart(d.dice.totals, width), h('ul', { class: 'read' }, line('Totals 2 to 12', tot), line('Individual die faces', face)));
  }
  for (const [wheel, counts] of Object.entries(d.pockets)) {
    const size = wheel === 'american' ? 38 : 37, obs = Object.values(counts), spins = obs.reduce((s, v) => s + v, 0);
    if (!spins) continue;
    const c = chiSquare([...obs, ...Array(size - obs.length).fill(0)], Array(size).fill(1 / size));
    const zeros = (counts['0'] || 0) + (counts['00'] || 0);
    fair.append(h('p', { class: 'ctitle', style: 'margin-top:14px' }, `${wheel === 'american' ? 'Double' : 'Single'}-zero wheel over ${num(spins)} spin${spins === 1 ? '' : 's'}`), h('ul', { class: 'read' },
      h('li', null, c.p == null ? `Needs about ${num(c.need)} spins before each pocket can be tested.` : `All ${size} pockets: chi-square ${c.x.toFixed(1)} on ${c.df} degrees of freedom, p = ${c.p.toFixed(3)} — ${verdict(c.p)}.`),
      h('li', null, `Green came up ${num(zeros)} time${zeros === 1 ? '' : 's'} (${pct(zeros / spins)}); expected ${pct((size - 36) / size)}.`)));
  }
  fair.append(h('p', { class: 'method', style: 'margin-top:10px' }, 'A p-value is the chance a fair game would look at least this lopsided. Small samples swing widely; anything above 0.05 is unremarkable.'));

  const n0 = all.expected > 0 ? (all.variance / all.rounds) / (all.expected / all.rounds) ** 2 : Infinity;
  const read = panel(h('h2', null, 'Reading it as the casino'), h('ul', { class: 'read' },
    h('li', null, `Players have put ${usd(all.handle)} through the tables. At the edges of the bets they chose, the house should be up ${usd(all.expected)}; it is ${all.hold >= 0 ? 'up' : 'down'} ${usd(Math.abs(all.hold))}.`),
    h('li', null, `The gap is ${Math.abs(z).toFixed(2)} standard deviations (one SD is ${usd(sd)} at this volume). ${Math.abs(z) < 2 ? 'That is ordinary luck, not a sign of anything.' : 'That is a rare run; if it persists as volume grows, check the By bet table for where it comes from.'}`),
    h('li', null, Number.isFinite(n0) ? `The edge only shows through with volume. At this bet mix the house needs about ${num(n0)} rounds before its expected win equals one standard deviation of luck; ${num(all.rounds)} have been dealt${all.rounds >= n0 ? ', so the edge is now doing most of the work' : ', so results are still mostly luck'}.` : 'So far players have only made zero-edge bets.'),
    h('li', null, `Blended theoretical hold is ${pct(all.expected / all.handle, 2)}. That depends on what players bet: odds bets add handle with no edge and pull it down, props and the double-zero wheel pull it up.`)));

  const method = panel(h('h2', null, 'Method'), h('p', { class: 'method' },
    'Before every roll or spin the server settles each possible outcome (36 dice pairs, or every pocket) against the bets actually on the table, using the live rules engine. '
    + 'That gives the round\'s exact expected house win and variance, including payout rounding and players who bet the same way and so win or lose together. '
    + 'Handle is the stake of each bet on the round that decides it; hold is what the house kept. Luck is (actual − expected) ÷ √(summed variance). '
    + 'Only totals are stored: no names, accounts or devices. Chips are play money, so this is the casino in a mathematical sense only.'));

  el.replaceChildren(live, tiles, chart, byBet, fair, read, method);
}

async function load() {
  try { const r = await fetch('/api/house', { cache: 'no-store' }); if (r.ok) { data = await r.json(); render(); } } catch {}
}
load();
setInterval(() => { if (!document.hidden) load(); }, 10000);
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
